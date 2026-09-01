import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { unregisterOpenClawAgentDatabase } from "../state/openclaw-agent-db-registry.js";
import {
  closeOpenClawAgentDatabasesForTest,
  openOpenClawAgentDatabase,
} from "../state/openclaw-agent-db.js";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import { collectRetainedUnconfiguredAgentDatabaseWarnings } from "./doctor-unconfigured-agent-databases.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function configWithAgents(...agentIds: string[]): OpenClawConfig {
  return {
    agents: {
      list: agentIds.map((id, index) => ({ id, default: index === 0 })),
    },
  };
}

afterEach(() => {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabaseForTest();
});

describe("unconfigured agent database diagnostics", () => {
  it("reports a present unconfigured database without changing it", () => {
    const stateDir = fs.realpathSync.native(tempDirs.make("doctor-unconfigured-agent-database-"));
    const env = { OPENCLAW_STATE_DIR: stateDir };
    const databasePath = openOpenClawAgentDatabase({ agentId: "phantom", env }).path;
    closeOpenClawAgentDatabasesForTest();
    closeOpenClawStateDatabaseForTest();
    const before = fs.statSync(databasePath);

    expect(
      collectRetainedUnconfiguredAgentDatabaseWarnings({
        cfg: configWithAgents("main"),
        env,
      }),
    ).toEqual([
      `- Retained unconfigured agent database "phantom" at ${databasePath}. Doctor will not remove it automatically because it may contain retired or manually managed agent state.`,
    ]);

    const after = fs.statSync(databasePath);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("does not warn for a configured database", () => {
    const stateDir = fs.realpathSync.native(tempDirs.make("doctor-configured-agent-database-"));
    const env = { OPENCLAW_STATE_DIR: stateDir };
    openOpenClawAgentDatabase({ agentId: "main", env });
    closeOpenClawAgentDatabasesForTest();
    closeOpenClawStateDatabaseForTest();

    expect(
      collectRetainedUnconfiguredAgentDatabaseWarnings({
        cfg: configWithAgents("main"),
        env,
      }),
    ).toEqual([]);
  });

  it("does not warn for a configured shared store owned by a retired agent", () => {
    const stateDir = fs.realpathSync.native(
      tempDirs.make("doctor-configured-shared-agent-database-"),
    );
    const env = { OPENCLAW_STATE_DIR: stateDir };
    const databasePath = path.join(stateDir, "shared.sqlite");
    openOpenClawAgentDatabase({ agentId: "retired", env, path: databasePath });
    closeOpenClawAgentDatabasesForTest();
    closeOpenClawStateDatabaseForTest();

    expect(
      collectRetainedUnconfiguredAgentDatabaseWarnings({
        cfg: {
          ...configWithAgents("worker"),
          session: { store: databasePath },
        },
        env,
      }),
    ).toEqual([]);
  });

  it("reports an unregistered default-layout database discovered from disk", () => {
    const stateDir = fs.realpathSync.native(tempDirs.make("doctor-unregistered-agent-database-"));
    const env = { OPENCLAW_STATE_DIR: stateDir };
    const databasePath = openOpenClawAgentDatabase({ agentId: "retired", env }).path;
    closeOpenClawAgentDatabasesForTest();
    unregisterOpenClawAgentDatabase({ agentId: "retired", env, path: databasePath });
    closeOpenClawStateDatabaseForTest();

    expect(
      collectRetainedUnconfiguredAgentDatabaseWarnings({
        cfg: configWithAgents("main"),
        env,
      }),
    ).toEqual([
      `- Retained unconfigured agent database "retired" at ${databasePath}. Doctor will not remove it automatically because it may contain retired or manually managed agent state.`,
    ]);
  });

  it("ignores missing registered databases owned by migration hygiene", () => {
    const stateDir = fs.realpathSync.native(tempDirs.make("doctor-missing-agent-database-"));
    const env = { OPENCLAW_STATE_DIR: stateDir };
    const databasePath = openOpenClawAgentDatabase({ agentId: "retired", env }).path;
    closeOpenClawAgentDatabasesForTest();
    closeOpenClawStateDatabaseForTest();
    fs.unlinkSync(databasePath);

    expect(
      collectRetainedUnconfiguredAgentDatabaseWarnings({
        cfg: configWithAgents("main"),
        env,
      }),
    ).toEqual([]);
  });
});
