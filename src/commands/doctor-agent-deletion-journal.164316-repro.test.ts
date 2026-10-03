import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { validateAgentIdInput } from "../agents/agent-create.js";
import { createLegacyDatabaseFixture } from "../infra/state-migrations.media-persistence.test-support.js";
import { reconstructAgentDeletionJournal } from "../state/agent-deletion-journal-recovery.js";
import { beginAgentDeletionJournal } from "../state/agent-deletion-journal.js";
import { closeOpenClawAgentDatabasesForTest } from "../state/openclaw-agent-db.js";
import {
  closeOpenClawStateDatabaseForTest,
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
} from "../state/openclaw-state-db.js";
import { resolveOpenClawStateSqlitePath } from "../state/openclaw-state-db.paths.js";
import { repairDoctorAgentDeletionJournal } from "./doctor-agent-deletion-journal.js";
import { inspectDoctorRecoveryArtifact } from "./doctor-agent-recovery-inspection.js";
import { prepareDoctorDatabasePreflight } from "./doctor-database-preflight.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  closeOpenClawAgentDatabasesForTest();
  closeOpenClawStateDatabaseForTest();
  vi.unstubAllEnvs();
});

it("#164316: excludes coordination stores and never recommends a rejected reserved-agent restore", async () => {
  const stateDir = fs.realpathSync.native(tempDirs.make("doctor-164316-"));
  const env = { OPENCLAW_STATE_DIR: stateDir };
  vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  const configPath = path.join(stateDir, "openclaw.json");
  vi.stubEnv("OPENCLAW_CONFIG_PATH", configPath);
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      agents: { entries: { main: { workspace: path.join(stateDir, "workspace") } } },
      plugins: { enabled: false },
    }),
  );
  const stores = ["main", "retired", "openclaw"].map((agentId) =>
    createLegacyDatabaseFixture({ agentId, env, eventsBySession: {}, schemaVersion: 19 }),
  );
  // The lease owner opens schema-free SQLite files and holds transactions on them.
  // These use that same schema-free shape, not renamed copies of agent stores.
  const coordination = ["generation-lock", "generation-writer", "reindex-lock"].map((kind) => {
    const file = `${stores[0]}.${kind}.sqlite`;
    const db = new DatabaseSync(file);
    db.exec("BEGIN EXCLUSIVE; ROLLBACK");
    db.close();
    return file;
  });
  closeOpenClawStateDatabaseForTest();
  const stateDb = new DatabaseSync(resolveOpenClawStateSqlitePath(env));
  stateDb.exec("DROP TABLE agent_deletion_journal");
  stateDb.close();
  const protectedFiles = [...stores, ...coordination, configPath];
  const before = protectedFiles.map((file) => fs.readFileSync(file));
  const initial = await prepareDoctorDatabasePreflight();
  const preview = await repairDoctorAgentDeletionJournal({
    preflight: initial,
    shouldRepair: false,
    env,
  });
  expect(preview.changes).toEqual([]);
  const reconstructed = await repairDoctorAgentDeletionJournal({
    preflight: initial,
    shouldRepair: true,
    env,
  });
  expect(reconstructed.changes.join("\n")).toContain("recorded a Doctor receipt");
  closeOpenClawStateDatabaseForTest();
  const next = await prepareDoctorDatabasePreflight();
  const second = await repairDoctorAgentDeletionJournal({
    preflight: next,
    shouldRepair: true,
    env,
  });
  expect(second.changes).toEqual([]);
  const state = openOpenClawStateDatabase({ env });
  const receipt = state.db
    .prepare(
      "SELECT report_json FROM migration_sources WHERE migration_kind = 'agent-deletion-journal-reconstruction'",
    )
    .get();
  const held = JSON.parse(String(receipt?.report_json)).held;
  const validation = validateAgentIdInput("openclaw");
  expect(validation).toMatchObject({ ok: false, reason: "reserved-id" });
  const bytesPreserved = protectedFiles.every((file, index) =>
    fs.readFileSync(file).equals(before[index]!),
  );
  expect(bytesPreserved).toBe(true);
  for (const agentId of ["main", "retired"]) {
    expect(held).toEqual(expect.arrayContaining([expect.objectContaining({ agentId })]));
  }
  const proof = {
    boundary: "real Doctor preflight and recovery owner; not CLI/update lifecycle",
    initialUnverified: initial.agentDatabaseMigrationDiscovery?.discovery.unverifiedTargets.map(
      (target) => ({ agentId: target.agentId, path: path.relative(stateDir, target.path) }),
    ),
    preview,
    reconstructed,
    second,
    held,
    validation,
    bytesPreserved,
  };
  // Normalize the disposable prefix before retaining the synthetic transcript.
  const serialized = JSON.stringify(proof, null, 2).replaceAll(stateDir, "<disposable-state>");
  const artifact = process.env.DOCTOR_164316_PROOF;
  if (artifact) {
    fs.writeFileSync(artifact, serialized + "\n");
  }
  // Raw preflight keeps all inferred locators until Doctor can inspect preserved snapshots.
  expect(
    initial.agentDatabaseMigrationDiscovery?.discovery.unverifiedTargets.filter((target) =>
      coordination.includes(target.path),
    ),
  ).toHaveLength(3);
  expect
    .soft(
      held.filter((target: { path: string }) =>
        coordination.some((file) => path.relative(stateDir, file) === target.path),
      ),
    )
    .toEqual([]);
  expect.soft(reconstructed.warnings.join("\n")).not.toMatch(/agents add '?openclaw'?/);
});

it("reconciles only verified existing receipt pairs and leaves ambiguous suffix stores held", async () => {
  const stateDir = fs.realpathSync.native(tempDirs.make("doctor-164316-receipt-"));
  const env = { OPENCLAW_STATE_DIR: stateDir };
  vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  const configPath = path.join(stateDir, "openclaw.json");
  vi.stubEnv("OPENCLAW_CONFIG_PATH", configPath);
  fs.writeFileSync(
    configPath,
    JSON.stringify({ agents: { entries: { main: {} } }, plugins: { enabled: false } }),
  );
  const main = createLegacyDatabaseFixture({
    agentId: "main",
    env,
    eventsBySession: {},
    schemaVersion: 19,
  });
  const system = createLegacyDatabaseFixture({
    agentId: "openclaw",
    env,
    eventsBySession: {},
    schemaVersion: 19,
  });
  const coordination = `${main}.generation-lock.sqlite`;
  const lease = new DatabaseSync(coordination);
  lease.exec("BEGIN EXCLUSIVE; ROLLBACK");
  lease.close();
  const custom = createLegacyDatabaseFixture({
    agentId: "main",
    env,
    path: `${main}.reindex-lock.sqlite`,
    eventsBySession: {},
    schemaVersion: 19,
  });
  closeOpenClawStateDatabaseForTest();
  const stateDb = new DatabaseSync(resolveOpenClawStateSqlitePath(env));
  stateDb.exec("DROP TABLE agent_deletion_journal");
  stateDb.close();
  runOpenClawStateWriteTransaction(
    (database) =>
      reconstructAgentDeletionJournal(database, [
        { agentId: "main", path: coordination },
        { agentId: "main", path: custom },
        { agentId: "openclaw", path: system },
      ]),
    { env },
  );
  const protectedFiles = [main, system, coordination, custom, configPath];
  const before = protectedFiles.map((file) => fs.readFileSync(file));
  const preflight = await prepareDoctorDatabasePreflight();
  const preview = await repairDoctorAgentDeletionJournal({ preflight, shouldRepair: false, env });
  expect(preview.changes).toEqual([]);
  const repaired = await repairDoctorAgentDeletionJournal({ preflight, shouldRepair: true, env });
  expect(repaired.changes.join("\n")).toContain("Verified and released 2 Doctor recovery holds");
  expect(repaired.warnings.join("\n")).toContain(custom);
  const state = openOpenClawStateDatabase({ env });
  const row = state.db
    .prepare(
      "SELECT report_json FROM migration_sources WHERE migration_kind = 'agent-deletion-journal-reconstruction'",
    )
    .get();
  expect(JSON.parse(String(row?.report_json)).held).toEqual([
    { agentId: "main", path: path.relative(stateDir, custom) },
  ]);
  expect(protectedFiles.map((file) => fs.readFileSync(file))).toEqual(before);
  closeOpenClawStateDatabaseForTest();
  const second = await repairDoctorAgentDeletionJournal({
    preflight: await prepareDoctorDatabasePreflight(),
    shouldRepair: true,
    env,
  });
  expect(second.changes).toEqual([]);
});

it("refuses ambiguous coordination and reserved-system locators before receipt editing", async () => {
  const stateDir = fs.realpathSync.native(tempDirs.make("doctor-164316-ambiguous-"));
  const env = { OPENCLAW_STATE_DIR: stateDir };
  const main = createLegacyDatabaseFixture({
    agentId: "main",
    env,
    eventsBySession: {},
    schemaVersion: 19,
  });
  const coordinate = `${main}.generation-writer.sqlite`;
  const db = new DatabaseSync(coordinate);
  db.close();
  expect((await inspectDoctorRecoveryArtifact("main", coordinate, env))?.kind).toBe("coordination");
  fs.writeFileSync(`${coordinate}-wal`, "retained sidecar");
  expect(await inspectDoctorRecoveryArtifact("main", coordinate, env)).toBeUndefined();
  fs.rmSync(`${coordinate}-wal`);
  const alias = `${coordinate}.alias`;
  fs.linkSync(coordinate, alias);
  expect(await inspectDoctorRecoveryArtifact("main", coordinate, env)).toBeUndefined();
  fs.rmSync(alias);
  const link = `${coordinate}.link`;
  fs.symlinkSync(coordinate, link);
  expect(await inspectDoctorRecoveryArtifact("main", link, env)).toBeUndefined();
  fs.rmSync(link);
  const shape = new DatabaseSync(coordinate);
  shape.exec("CREATE TABLE custom_data (id INTEGER PRIMARY KEY)");
  shape.close();
  expect(await inspectDoctorRecoveryArtifact("main", coordinate, env)).toBeUndefined();
  const invalidSystemPath = path.join(
    stateDir,
    "agents",
    "openclaw",
    "agent",
    "openclaw-agent.sqlite",
  );
  createLegacyDatabaseFixture({
    agentId: "main",
    env,
    path: invalidSystemPath,
    eventsBySession: {},
    schemaVersion: 19,
  });
  expect(await inspectDoctorRecoveryArtifact("openclaw", invalidSystemPath, env)).toBeUndefined();
  const validSystemPath = path.join(
    stateDir,
    "agents",
    "crestodian",
    "agent",
    "openclaw-agent.sqlite",
  );
  createLegacyDatabaseFixture({
    agentId: "crestodian",
    env,
    path: validSystemPath,
    eventsBySession: {},
    schemaVersion: 19,
  });
  const malformed = new DatabaseSync(validSystemPath);
  malformed.exec("PRAGMA foreign_keys = OFF; DROP TABLE session_nodes");
  malformed.close();
  expect(await inspectDoctorRecoveryArtifact("crestodian", validSystemPath, env)).toBeUndefined();
});

it("retains a held system store when a different deletion claims its implicit agent-dir path after preflight", async () => {
  const stateDir = fs.realpathSync.native(tempDirs.make("doctor-164316-late-deletion-"));
  const env = { OPENCLAW_STATE_DIR: stateDir };
  vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  const configPath = path.join(stateDir, "openclaw.json");
  vi.stubEnv("OPENCLAW_CONFIG_PATH", configPath);
  fs.writeFileSync(configPath, JSON.stringify({ plugins: { enabled: false } }));
  const system = createLegacyDatabaseFixture({
    agentId: "openclaw",
    env,
    eventsBySession: {},
    schemaVersion: 19,
  });
  closeOpenClawStateDatabaseForTest();
  const stateDb = new DatabaseSync(resolveOpenClawStateSqlitePath(env));
  stateDb.exec("DROP TABLE agent_deletion_journal");
  stateDb.close();
  runOpenClawStateWriteTransaction(
    (database) =>
      reconstructAgentDeletionJournal(database, [{ agentId: "openclaw", path: system }]),
    { env },
  );
  const preflight = await prepareDoctorDatabasePreflight();
  beginAgentDeletionJournal(
    {
      agentId: "retired",
      operationId: "late-implicit-owner",
      agentDir: path.dirname(system),
      workspaceDir: path.join(stateDir, "retired-workspace"),
      sessionsDir: path.join(stateDir, "agents", "retired", "sessions"),
      deleteFiles: false,
    },
    { env },
  );
  const result = await repairDoctorAgentDeletionJournal({ preflight, shouldRepair: true, env });
  expect(result.warnings.join("\n")).toContain("reserved system-agent store remains held");
  const state = openOpenClawStateDatabase({ env });
  const receipt = state.db
    .prepare(
      "SELECT report_json FROM migration_sources WHERE migration_kind = 'agent-deletion-journal-reconstruction'",
    )
    .get();
  expect(JSON.parse(String(receipt?.report_json)).held).toEqual([
    { agentId: "openclaw", path: path.relative(stateDir, system) },
  ]);
});
