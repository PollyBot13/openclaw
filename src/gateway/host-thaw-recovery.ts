import { TICK_INTERVAL_MS } from "./server-constants.js";

// A real host freeze loses at least 45s beyond the expected maintenance cadence;
// shorter gaps are ordinary event-loop load and must not churn channel sockets.
const HOST_THAW_MIN_FROZEN_MS = 45_000;

type HostThawDeps = {
  nowMs: () => number;
  getSuspendLifecycleEvidence: () => { isHeld: boolean; resumeGeneration: number };
  restartChannels: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  refreshPresence: () => void;
  resetEventLoopHealth: () => void;
  isAdmissionClosed: () => boolean;
  logger: { info: (message: string) => void; error: (message: string) => void };
};

export function createHostThawRecovery(deps: HostThawDeps): { tick: () => Promise<void> } {
  let lastTickAtMs = deps.nowMs();
  let lastResumeGeneration = deps.getSuspendLifecycleEvidence().resumeGeneration;
  let pendingRecovery: { frozenMs: number; restartChannels: boolean } | undefined;
  let activeRecovery: Promise<void> | undefined;

  const runStep = async (label: string, step: () => void | Promise<void>) => {
    try {
      await step();
    } catch (error) {
      deps.logger.error(`host thaw ${label} failed: ${String(error)}`);
    }
  };

  const recover = async (frozenMs: number, restartChannels: boolean) => {
    deps.logger.info(
      restartChannels
        ? `host thaw detected: process was frozen ~${Math.round(frozenMs)}ms; restarting channels and refreshing health`
        : `host timing gap detected: process was frozen ~${Math.round(frozenMs)}ms; refreshing health without restarting channels`,
    );
    const recoverySteps: ReadonlyArray<readonly [string, () => void | Promise<void>]> = [
      ["event-loop reset", deps.resetEventLoopHealth],
      ...(restartChannels ? [["channel restart", deps.restartChannels] as const] : []),
      ["health refresh", deps.refreshHealth],
      ["presence refresh", deps.refreshPresence],
    ];
    for (const [label, step] of recoverySteps) {
      if (deps.isAdmissionClosed()) {
        // Every recovery step is idempotent, so a partially completed thaw is
        // deliberately replayed from the start after admission reopens.
        pendingRecovery = {
          frozenMs: Math.max(pendingRecovery?.frozenMs ?? 0, frozenMs),
          restartChannels: pendingRecovery?.restartChannels === true || restartChannels,
        };
        deps.logger.info("host thaw recovery deferred: gateway suspension began mid-recovery");
        return;
      }
      await runStep(label, step);
    }
  };

  return {
    tick: async () => {
      const nowMs = deps.nowMs();
      const gapMs = nowMs - lastTickAtMs;
      lastTickAtMs = nowMs;
      const suspendEvidence = deps.getSuspendLifecycleEvidence();
      const resumedSinceLastTick = suspendEvidence.resumeGeneration !== lastResumeGeneration;
      lastResumeGeneration = suspendEvidence.resumeGeneration;
      const hasExplicitWakeEvidence = suspendEvidence.isHeld || resumedSinceLastTick;
      if (gapMs >= TICK_INTERVAL_MS + HOST_THAW_MIN_FROZEN_MS) {
        pendingRecovery = {
          frozenMs: Math.max(pendingRecovery?.frozenMs ?? 0, gapMs - TICK_INTERVAL_MS),
          restartChannels: pendingRecovery?.restartChannels === true || hasExplicitWakeEvidence,
        };
      } else if (pendingRecovery && hasExplicitWakeEvidence) {
        pendingRecovery.restartChannels = true;
      }
      // Suspension/restart owns the closed period. Recovery must wait rather than
      // waking channels while the controller deliberately keeps the gateway quiet.
      if (!pendingRecovery || deps.isAdmissionClosed() || activeRecovery) {
        return;
      }
      const recovery = pendingRecovery;
      pendingRecovery = undefined;
      activeRecovery = recover(recovery.frozenMs, recovery.restartChannels);
      try {
        await activeRecovery;
      } finally {
        activeRecovery = undefined;
      }
    },
  };
}
