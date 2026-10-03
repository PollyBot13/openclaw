import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import { runWithSqliteCleanup } from "../infra/sqlite-lifecycle-errors.js";
import { prepareSqliteReadOnlyLocation } from "../infra/sqlite-snapshot-source.js";
import { OPENCLAW_AGENT_SCHEMA_VERSION } from "../state/openclaw-agent-db-contract.js";
import {
  assertOpenClawAgentSchemaContains,
  getOpenClawAgentMigrationSchema,
} from "../state/openclaw-agent-db-schema-helpers.js";
import { readExistingAgentSchemaMeta } from "../state/openclaw-agent-db-schema-read.js";
import { assertSupportedAgentMigrationSchemas } from "../state/openclaw-agent-db-session-migrations.js";
import { resolveOpenClawAgentSqlitePath } from "../state/openclaw-agent-db.paths.js";
import { isReservedSystemAgentId } from "../system-agent/agent-id.js";

type Identity = { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint };
type Inspection = { kind: "coordination" | "system"; current: () => boolean };

function fileIdentity(pathname: string): Identity | undefined {
  const stat = fs.lstatSync(pathname, { bigint: true, throwIfNoEntry: false });
  if (!stat?.isFile() || stat.nlink !== 1n || fs.realpathSync.native(pathname) !== pathname) {
    return undefined;
  }
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  };
}

async function inspectSnapshot(
  pathname: string,
  check: (db: DatabaseSync) => boolean,
): Promise<boolean> {
  const prepared = await prepareSqliteReadOnlyLocation(pathname, {
    preserveSourceArtifacts: true,
    allowLiveOwner: false,
  });
  return runWithSqliteCleanup(
    {
      release: () => {
        if (!prepared.cleanup()) {
          throw new Error(`Could not clean up recovery inspection snapshot for ${pathname}`);
        }
      },
    },
    "Doctor recovery inspection snapshot",
    () => {
      const db = new DatabaseSync(prepared.location, { readOnly: true });
      return runWithSqliteCleanup(
        { release: () => db.close() },
        "Doctor recovery inspection read",
        () => {
          assertSqliteIntegrity(db, prepared.location);
          return check(db);
        },
      );
    },
  );
}

/** Positive Doctor-only evidence; an ambiguous locator stays held. */
export async function inspectDoctorRecoveryArtifact(
  agentId: string,
  pathname: string,
  env: NodeJS.ProcessEnv,
): Promise<Inspection | undefined> {
  try {
    if (pathname !== path.resolve(pathname)) {
      return undefined;
    }
    const canonical = resolveOpenClawAgentSqlitePath({ agentId, env });
    const system = isReservedSystemAgentId(agentId) && pathname === canonical;
    const suffix = /\.(?:generation-lock|generation-writer|reindex-lock)\.sqlite$/u;
    const parent = system ? pathname : pathname.replace(suffix, "");
    if (!system && (parent === pathname || path.dirname(parent) !== path.dirname(canonical))) {
      return undefined;
    }
    const identity = fileIdentity(pathname);
    const parentIdentity = system ? identity : fileIdentity(parent);
    if (!identity || !parentIdentity) {
      return undefined;
    }
    // A detached sidecar can contain committed data; neither shape may be inferred from it.
    const family = [pathname, ...(system ? [] : [parent])];
    if (
      family.some((name) =>
        ["-wal", "-shm", "-journal"].some((sidecar) =>
          fs.lstatSync(name + sidecar, { throwIfNoEntry: false }),
        ),
      )
    ) {
      return undefined;
    }
    if (
      !(await inspectSnapshot(parent, (db) => {
        const owner = readExistingAgentSchemaMeta(db);
        const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
        const owned =
          owner?.role === "agent" &&
          owner.agentId === agentId &&
          version > 0 &&
          version <= OPENCLAW_AGENT_SCHEMA_VERSION &&
          owner.schemaVersion === version;
        if (!owned) {
          return false;
        }
        assertSupportedAgentMigrationSchemas(db, parent, version);
        assertOpenClawAgentSchemaContains(
          db,
          parent,
          getOpenClawAgentMigrationSchema(version),
          version === OPENCLAW_AGENT_SCHEMA_VERSION ? "current" : "legacy",
        );
        return true;
      }))
    ) {
      return undefined;
    }
    if (
      !system &&
      !(await inspectSnapshot(
        pathname,
        (db) =>
          Number(db.prepare("PRAGMA user_version").get()?.user_version) === 0 &&
          !db.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get(),
      ))
    ) {
      return undefined;
    }
    const current = () => {
      try {
        return (
          JSON.stringify(fileIdentity(pathname), (_key, value) =>
            typeof value === "bigint" ? String(value) : value,
          ) ===
            JSON.stringify(identity, (_key, value) =>
              typeof value === "bigint" ? String(value) : value,
            ) &&
          JSON.stringify(fileIdentity(parent), (_key, value) =>
            typeof value === "bigint" ? String(value) : value,
          ) ===
            JSON.stringify(parentIdentity, (_key, value) =>
              typeof value === "bigint" ? String(value) : value,
            ) &&
          family.every((name) =>
            ["-wal", "-shm", "-journal"].every(
              (sidecar) => !fs.lstatSync(name + sidecar, { throwIfNoEntry: false }),
            ),
          )
        );
      } catch {
        return false;
      }
    };
    return current() ? { kind: system ? "system" : "coordination", current } : undefined;
  } catch {
    return undefined;
  }
}
