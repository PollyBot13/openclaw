import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sanitizeForLog } from "../../packages/terminal-core/src/ansi.js";
import {
  listAgentIds,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
} from "../agents/agent-scope-config.js";
import { formatCliCommand } from "../cli/command-format.js";
import { quoteCliArg, quotePowerShellArg } from "../cli/quote-cli-arg.js";
import { createConfigIO } from "../config/io.js";
import { resolveConfiguredAgentDatabaseCandidatePaths } from "../config/sessions/targets.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import {
  reconstructAgentDeletionJournal,
  resolveAgentDeletionRecoveryHolds,
} from "../state/agent-deletion-journal-recovery.js";
import { readAgentDeletionRecoveryHolds } from "../state/agent-deletion-journal-recovery.kernel.js";
import {
  readAgentDatabaseDeletionSnapshot,
  readAgentDeletionJournalStatusInDatabase,
} from "../state/agent-deletion-journal.read.js";
import type { HeldAgentDatabase } from "../state/agent-deletion-journal.types.js";
import { readRegisteredAgentDatabaseRows } from "../state/openclaw-agent-db-registry.read.js";
import { createOpenClawAgentDatabasePathMatcher } from "../state/openclaw-agent-db.paths.js";
import { getOpenClawDatabaseMaintenanceScope } from "../state/openclaw-state-db-async-lifecycle.js";
import { prepareStateDatabaseInitialization } from "../state/openclaw-state-db-initialization.js";
import { tableExists } from "../state/openclaw-state-db-schema-helpers.js";
import type { DB } from "../state/openclaw-state-db.generated.js";
import { runOpenClawStateWriteTransaction } from "../state/openclaw-state-db.js";
import { resolveOpenClawStateSqlitePath } from "../state/openclaw-state-db.paths.js";
import { isReservedSystemAgentId } from "../system-agent/agent-id.js";
import { inspectDoctorRecoveryArtifact } from "./doctor-agent-recovery-inspection.js";
import type { DoctorDatabasePreflight } from "./doctor-database-preflight.js";
import { backupDoctorSqliteDatabases } from "./doctor-migration-backup.js";

function heldGeneration(held: readonly HeldAgentDatabase[]): string {
  return JSON.stringify(
    held
      .map((entry) => [entry.agentId, entry.path])
      .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
}

/** Doctor alone reconstructs lost deletion history and records the stores it cannot verify. */
export async function repairDoctorAgentDeletionJournal(params: {
  preflight: DoctorDatabasePreflight;
  shouldRepair: boolean;
  env: NodeJS.ProcessEnv;
}): Promise<{ changes: string[]; warnings: string[] }> {
  const discovery = params.preflight.agentDatabaseMigrationDiscovery?.discovery;
  const changes: string[] = [];
  if (!discovery) {
    return { changes, warnings: [] };
  }
  if (
    discovery.deletionJournal.status === "unavailable" &&
    discovery.deletionJournal.cause === "unreadable"
  ) {
    return {
      changes,
      warnings: [
        sanitizeForLog(
          `${resolveOpenClawStateSqlitePath(params.env)}: ${discovery.deletionJournal.reason}. Stores remain held; restore verified deletion history, then rerun openclaw doctor --fix.`,
        ),
        ...[...discovery.retainedTargets, ...discovery.unverifiedTargets].map(
          ({ agentId, path: pathname }) =>
            sanitizeForLog(
              `Held agent ${agentId} database ${pathname}; deletion history needs repair.`,
            ),
        ),
      ],
    };
  }
  const missing = discovery.deletionJournal.status === "unavailable";
  const prepared = params.preflight.agentDatabaseMigrationDiscovery!;
  const configIO = createConfigIO({
    env: params.env,
    observe: false,
    pluginValidation: "core-only",
  });
  const ownership = await configIO.readConfigFileSnapshot();
  const configPaths = [ownership.path, ...(ownership.includedPaths ?? [])];
  const readConfigInput = (pathname: string) => {
    try {
      return fs.readFileSync(pathname);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  };
  const configInputs = configPaths.map(readConfigInput);
  const refreshedOwnership = await configIO.readConfigFileSnapshot();
  const configCurrent =
    ownership.valid &&
    ownership.hash === params.preflight.agentDatabaseRecoveryConfigHash &&
    refreshedOwnership.valid &&
    refreshedOwnership.hash === ownership.hash &&
    configPaths.every((pathname, index) => {
      const current = readConfigInput(pathname);
      const previous = configInputs[index];
      return current === undefined ? previous === undefined : previous?.equals(current) === true;
    });
  const assertConfigCurrent = () => {
    if (
      !configCurrent ||
      !samePath.isCurrent() ||
      !configPaths.every((pathname, index) => {
        const current = readConfigInput(pathname);
        const previous = configInputs[index];
        return current === undefined ? previous === undefined : previous?.equals(current) === true;
      })
    ) {
      throw new Error("Agent recovery configuration changed; rerun openclaw doctor --fix.");
    }
  };
  const configured = resolveConfiguredAgentDatabaseCandidatePaths(ownership.sourceConfig, {
    env: params.env,
  });
  const samePath = createOpenClawAgentDatabasePathMatcher();
  const explicitlyClaimed = (agentId: string, pathname: string) => {
    const configClaims = [
      ...configured,
      ...prepared.configuredAgentDatabaseTargets.map((entry) => entry.path),
    ];
    const registryClaims = prepared.registeredAgentDatabases;
    const journal = discovery.deletionJournal;
    const known =
      journal.status === "present"
        ? journal
        : journal.status === "unavailable"
          ? journal.known
          : undefined;
    if (
      known?.entries.some(
        (entry) =>
          entry.agentId === agentId ||
          entry.databasePaths.some((entryPath) => samePath(entryPath, pathname)),
      )
    ) {
      return true;
    }
    return (
      configClaims.some((claim) => samePath(claim, pathname)) ||
      registryClaims.some(
        (claim) =>
          samePath(claim.path, pathname) &&
          (!isReservedSystemAgentId(agentId) || claim.agentId !== agentId),
      )
    );
  };
  const proposed = (
    await Promise.all(
      discovery.unverifiedTargets.map(async ({ agentId, path: pathname }) => {
        if (!configCurrent || explicitlyClaimed(agentId, pathname)) {
          return undefined;
        }
        const inspection = await inspectDoctorRecoveryArtifact(agentId, pathname, params.env);
        return inspection ? { agentId, path: pathname, ...inspection } : undefined;
      }),
    )
  ).filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  const excluded = new Set(
    proposed
      .filter((entry) => entry.kind === "coordination")
      .map((entry) => JSON.stringify([entry.agentId, entry.path])),
  );
  if (
    missing &&
    discovery.unverifiedTargets.length === 0 &&
    discovery.failures.length === 0 &&
    prepareStateDatabaseInitialization(resolveOpenClawStateSqlitePath(params.env), params.env)
      .kind === "fresh"
  ) {
    return { changes, warnings: [] };
  }
  let held = discovery.unverifiedTargets
    .filter(
      ({ agentId, path: pathname }) =>
        !missing || !excluded.has(JSON.stringify([agentId, pathname])),
    )
    .map(({ agentId, path: pathname }) => ({ agentId, path: pathname }));
  if (missing && discovery.failures.length > 0) {
    return {
      changes,
      warnings: [
        "Agent deletion journal missing; stores remain held because their recovery inventory is incomplete. Repair the listed paths, then rerun openclaw doctor --fix.",
        ...discovery.failures.map(({ path: pathname, reason }) =>
          sanitizeForLog(`${pathname}: ${reason}`),
        ),
      ],
    };
  }
  if (missing && (!configCurrent || params.preflight.agentDatabaseRecoveryConfigValid !== true)) {
    return {
      changes,
      warnings: [
        "Agent deletion journal missing; stores remain held because the ownership configuration could not be verified. Repair the configuration, then rerun openclaw doctor --fix.",
      ],
    };
  }
  if (missing && params.shouldRepair) {
    if (params.preflight.pendingMigrations?.some((entry) => entry.kind === "state")) {
      const { prepareLegacyStateDatabaseSchema } =
        await import("../infra/state-migrations.doctor.js");
      const { throwIfDoctorStateMigrationRefused } =
        await import("../infra/state-migrations.messages.js");
      throwIfDoctorStateMigrationRefused([await prepareLegacyStateDatabaseSchema(params.env)]);
    }
    held = runOpenClawStateWriteTransaction(
      (database) => {
        assertConfigCurrent();
        const registry = readRegisteredAgentDatabaseRows(database.db, database.path, false);
        const safe = proposed.filter(
          (entry) =>
            entry.kind === "coordination" &&
            entry.current() &&
            !registry.some((claim) => samePath(claim.path, entry.path)) &&
            readAgentDeletionJournalStatusInDatabase(database.db, entry.agentId) === "absent",
        );
        const safePairs = new Set(safe.map((entry) => JSON.stringify([entry.agentId, entry.path])));
        const currentHeld = discovery.unverifiedTargets
          .filter(
            ({ agentId, path: pathname }) => !safePairs.has(JSON.stringify([agentId, pathname])),
          )
          .map(({ agentId, path: pathname }) => ({ agentId, path: pathname }));
        const wasMissing = !tableExists(database.db, "agent_deletion_journal");
        const remaining = reconstructAgentDeletionJournal(database, currentHeld);
        if (wasMissing) {
          changes.push(
            "Reconstructed the missing agent deletion journal and recorded a Doctor receipt listing held stores.",
          );
        }
        assertConfigCurrent();
        return remaining;
      },
      { env: params.env },
    );
  }
  if (
    params.shouldRepair &&
    proposed.length > 0 &&
    params.preflight.agentDatabaseRecoveryConfigValid === true
  ) {
    const statePath = resolveOpenClawStateSqlitePath(params.env);
    const eligible = proposed.filter(
      (entry) =>
        entry.current() &&
        held.some(
          (target) => target.agentId === entry.agentId && samePath(target.path, entry.path),
        ),
    );
    if (eligible.length > 0) {
      const latest = readAgentDatabaseDeletionSnapshot(params.env)?.retainedDeletions;
      const latestHolds =
        latest?.status === "present"
          ? latest.held
          : latest?.status === "unavailable"
            ? (latest.known?.held ?? [])
            : [];
      if (
        !eligible.some((entry) =>
          latestHolds.some(
            (target) => target.agentId === entry.agentId && samePath(target.path, entry.path),
          ),
        )
      ) {
        throw new Error(
          "Agent recovery receipt changed before backup; rerun openclaw doctor --fix.",
        );
      }
      const receiptGeneration = heldGeneration(latestHolds);
      const maintenance = getOpenClawDatabaseMaintenanceScope();
      const assertCurrent = () => {
        maintenance?.assertAdmission();
        assertConfigCurrent();
        if (eligible.some((entry) => !entry.current())) {
          throw new Error("Agent recovery ownership facts changed; rerun openclaw doctor --fix.");
        }
      };
      assertCurrent();
      const backups = await backupDoctorSqliteDatabases({
        env: params.env,
        pendingDatabasePaths: [statePath],
        databasePaths: [statePath],
        authority: { assertCurrent },
        repair: {
          key: `agent-deletion-journal-recovery:${randomUUID()}`,
          validate: (database) => {
            const backedUpHolds = readAgentDeletionRecoveryHolds({ db: database, path: statePath });
            if (heldGeneration(backedUpHolds) !== receiptGeneration) {
              throw new Error("Recovery backup does not match the held receipt generation.");
            }
          },
        },
      });
      changes.push(...backups.changes);
      assertCurrent();
      const resolved = runOpenClawStateWriteTransaction(
        (database) => {
          assertCurrent();
          const currentHolds = readAgentDeletionRecoveryHolds(database);
          if (heldGeneration(currentHolds) !== receiptGeneration) {
            throw new Error(
              "Agent recovery receipt changed after backup; rerun openclaw doctor --fix.",
            );
          }
          const registry = readRegisteredAgentDatabaseRows(database.db, database.path, false);
          const deletions = executeSqliteQuerySync(
            database.db,
            getNodeSqliteKysely<Pick<DB, "agent_deletion_journal">>(database.db)
              .selectFrom("agent_deletion_journal")
              .select(["agent_id", "agent_dir", "database_paths_json"]),
          ).rows;
          const released: Array<{ agentId: string; path: string }> = [];
          for (const entry of eligible) {
            if (
              !entry.current() ||
              !currentHolds.some(
                (target) => target.agentId === entry.agentId && samePath(target.path, entry.path),
              ) ||
              readAgentDeletionJournalStatusInDatabase(database.db, entry.agentId) !== "absent" ||
              deletions.some((row) => {
                if (
                  typeof row.agent_dir !== "string" ||
                  samePath(path.join(row.agent_dir, "openclaw-agent.sqlite"), entry.path) ||
                  typeof row.database_paths_json !== "string"
                ) {
                  return true;
                }
                try {
                  const paths: unknown = JSON.parse(row.database_paths_json);
                  return (
                    !Array.isArray(paths) ||
                    paths.some((value) => typeof value !== "string" || samePath(value, entry.path))
                  );
                } catch {
                  return true;
                }
              }) ||
              registry.some(
                (target) =>
                  samePath(target.path, entry.path) &&
                  (entry.kind !== "system" || target.agentId !== entry.agentId),
              ) ||
              currentHolds.some(
                (target) => target.agentId !== entry.agentId && samePath(target.path, entry.path),
              )
            ) {
              continue;
            }
            if (resolveAgentDeletionRecoveryHolds(database, entry.agentId, [entry.path]) > 0) {
              released.push({ agentId: entry.agentId, path: entry.path });
            }
          }
          assertCurrent();
          return released;
        },
        { env: params.env },
      );
      if (resolved.length > 0) {
        changes.push(
          `Verified and released ${resolved.length} Doctor recovery hold${resolved.length === 1 ? "" : "s"}.`,
        );
        held = held.filter(
          (target) =>
            !resolved.some(
              (entry) => entry.agentId === target.agentId && samePath(entry.path, target.path),
            ),
        );
      }
      if (backups.warnings.length > 0) {
        return { changes, warnings: backups.warnings };
      }
    }
  }
  if (held.length === 0 && (!missing || params.shouldRepair)) {
    return { changes, warnings: [] };
  }
  const snapshot = await createConfigIO({
    env: params.env,
    observe: false,
    pluginValidation: "core-only",
  }).readConfigFileSnapshot();
  const quote = process.platform === "win32" ? quotePowerShellArg : quoteCliArg;
  const warnings = [
    `Agent deletion journal ${missing && !params.shouldRepair ? "missing" : "reconstructed"}; ${held.length} store${held.length === 1 ? "" : "s"} held back.`,
    ...held.map((target) => {
      if (isReservedSystemAgentId(target.agentId)) {
        return sanitizeForLog(
          `${target.path}: reserved system-agent store remains held; verify its canonical path and stored agent owner, then run ${formatCliCommand("openclaw doctor --fix", params.env)}. If Doctor still holds it, restore a verified state backup and inspect deletion/ownership conflicts.`,
        );
      }
      const workspace = resolveAgentWorkspaceDir(snapshot.sourceConfig, target.agentId, params.env);
      const agentDir = listAgentIds(snapshot.sourceConfig).includes(target.agentId)
        ? resolveAgentDir(snapshot.sourceConfig, target.agentId, params.env)
        : path.dirname(target.path);
      const restore = formatCliCommand(
        `openclaw agents add ${quote(target.agentId)} --workspace ${quote(workspace)} --agent-dir ${quote(agentDir)} --non-interactive`,
        params.env,
      );
      return sanitizeForLog(
        `${target.path}: ${path.basename(target.path) === "openclaw-agent.sqlite" ? "verify the workspace" : "restore the original session.store configuration for this database and verify the workspace"}, then run ${restore} to restore; use openclaw agents delete to confirm deletion instead.`,
      );
    }),
    ...(missing && !params.shouldRepair
      ? [
          `Run ${formatCliCommand("openclaw doctor --fix", params.env)} to reconstruct the journal without activating held stores.`,
        ]
      : []),
  ];
  return { changes, warnings };
}
