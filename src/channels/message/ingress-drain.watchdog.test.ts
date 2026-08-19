import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";
import type { ChannelIngressDispatchLifecycle } from "./ingress-drain-lifecycle.js";
import { createChannelIngressDrain, isIngressAdoptionLostError } from "./ingress-drain.js";
import {
  createTestIngressQueue,
  type IngressDrainTestPayload as Payload,
  withTempState,
} from "./ingress-drain.test-helpers.js";

describe("channel ingress drain watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    closeOpenClawStateDatabaseForTest();
  });

  it("releases pre-adoption stalls for retry and fences late adoption", async () => {
    await withTempState(async (stateDir) => {
      let clock = 10_000;
      const queue = createTestIngressQueue(stateDir, { now: () => clock });
      await queue.enqueue("evt-stall", { text: "x" }, { laneKey: "l1" });
      let stalledLifecycle: ChannelIngressDispatchLifecycle | undefined;

      const drain = createChannelIngressDrain<Payload>({
        queue,
        now: () => clock,
        adoptionStallTimeoutMs: 5_000,
        dispatchClaimedEvent: async (_event, lifecycle) => {
          stalledLifecycle = lifecycle;
          // Never adopt, never return -- stall until watchdog.
          await new Promise(() => {});
        },
      });

      await drain.drainOnce();
      clock += 5_000;
      await vi.advanceTimersByTimeAsync(5_000);
      await drain.waitForIdle();

      expect(await queue.listClaims()).toEqual([]);
      expect(await queue.listFailed?.({ limit: "all" })).toEqual([]);
      expect(await queue.listPending({ limit: "all" })).toMatchObject([
        {
          id: "evt-stall",
          attempts: 1,
          lastError: expect.stringContaining("handler-timeout"),
        },
      ]);
      const lateAdoption = stalledLifecycle?.onAdopted();
      expect(lateAdoption).toBeDefined();
      const lateAdoptError = await lateAdoption?.catch((error: unknown) => error);
      expect(isIngressAdoptionLostError(lateAdoptError) && lateAdoptError.code).toBe("guillotined");
      drain.dispose();
    });
  });

  it("releases deferred stalls for retry", async () => {
    await withTempState(async (stateDir) => {
      let clock = 30_000;
      const queue = createTestIngressQueue(stateDir, { now: () => clock });
      await queue.enqueue("evt-def-stall", { text: "x" }, { laneKey: "l1" });

      const drain = createChannelIngressDrain<Payload>({
        queue,
        now: () => clock,
        adoptionStallTimeoutMs: 5_000,
        dispatchClaimedEvent: async (_event, lifecycle) => {
          lifecycle.onDeferred();
          // Stay deferred without adoption -- watchdog must still fire.
          await new Promise(() => {});
        },
      });

      await drain.drainOnce();
      expect(await queue.listClaims()).toHaveLength(1);
      clock += 5_000;
      await vi.advanceTimersByTimeAsync(5_000);
      await drain.waitForIdle();

      expect(await queue.listClaims()).toEqual([]);
      expect(await queue.listFailed?.({ limit: "all" })).toEqual([]);
      expect(await queue.listPending({ limit: "all" })).toMatchObject([
        {
          id: "evt-def-stall",
          attempts: 1,
          lastError: expect.stringContaining("handler-timeout"),
        },
      ]);
      drain.dispose();
    });
  });

  it("does not kill healthy long turns after adoption", async () => {
    await withTempState(async (stateDir) => {
      let clock = 20_000;
      const queue = createTestIngressQueue(stateDir, { now: () => clock });
      await queue.enqueue("evt-long", { text: "x" }, { laneKey: "l1" });

      let settleResolve!: () => void;
      const settleGate = new Promise<void>((resolve) => {
        settleResolve = resolve;
      });

      const drain = createChannelIngressDrain<Payload>({
        queue,
        now: () => clock,
        adoptionStallTimeoutMs: 1_000,
        dispatchClaimedEvent: async (_event, lifecycle) => {
          await lifecycle.onAdopted();
          await settleGate;
        },
      });

      await drain.drainOnce();
      await vi.waitFor(async () => {
        expect(await queue.listClaims()).toEqual([]);
      });
      clock += 60_000;
      await vi.advanceTimersByTimeAsync(60_000);
      const status = await queue.enqueue("evt-long", { text: "x" });
      expect(status.kind).toBe("completed");
      settleResolve();
      await drain.waitForIdle();
      drain.dispose();
    });
  });
});
