import fs from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { getRegistryWorktree } from "../agents/worktrees/registry.test-support.js";
import { ManagedWorktreeService } from "../agents/worktrees/service.js";
import {
  materializeManagedWorktreeFixture,
  useManagedWorktreeTestRepository,
} from "../agents/worktrees/service.test-support.js";
import { setRuntimeConfigSnapshot } from "../config/runtime-snapshot.js";
import {
  appendTranscriptMessage,
  loadExactSessionEntryReadOnly,
  loadTranscriptEventsSync,
  replaceSessionEntry,
} from "../config/sessions/session-accessor.js";
import type { DoctorHealthFlowContext } from "../flows/doctor-health-contribution-types.js";
import { resolveInitialDoctorHealthContributions } from "../flows/doctor-health-contributions-initial.js";
import {
  createDoctorHealthFlowContext,
  runDoctorHealthContributionList,
} from "../flows/doctor-health-contributions.test-support.js";
import * as sessionWorktreeLifecycle from "../sessions/session-worktree-lifecycle.js";
import { createOpenClawDatabaseMaintenanceScope } from "../state/openclaw-state-db-async-lifecycle.js";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";

const note = vi.hoisted(() => vi.fn());
vi.mock("../../packages/terminal-core/src/note.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../packages/terminal-core/src/note.js")>()),
  note,
}));

import {
  detectArchivedNativeCommandSources,
  noteArchivedNativeCommandSources,
  repairArchivedNativeCommandSources,
} from "./doctor-native-command-archives.js";

const initializeRepository = useManagedWorktreeTestRepository();

function nativeArchiveContribution() {
  const noop = async () => {};
  return resolveInitialDoctorHealthContributions({
    runStructuredHealthRepairs: noop,
    runGatewayConfigHealth: noop,
    runAuthProfileMigration: noop,
    runAuthProfileHealth: noop,
    runGatewayAuthHealth: noop,
    runLegacyStateHealth: noop,
  }).find((candidate) => candidate.id === "doctor:native-command-archives")!;
}

it("warns about archived native sources without changing manual archives or ordinary conversations", async () => {
  await withOpenClawTestState(
    { scenario: "minimal", label: "doctor-native-archives" },
    async (state) => {
      note.mockClear();
      const cfg = { agents: { entries: { main: {} } } };
      setRuntimeConfigSnapshot(cfg);
      const entries = [
        ["agent:main:discord:slash:user-1", { archivedAt: 10, archiveReason: "manual" }],
        ["agent:main:slack:slash:user-2", { archivedAt: 11 }],
        ["agent:main:discord:slash:user-3", {}],
        ["agent:main:discord:channel:room-1", { archivedAt: 12 }],
        ["agent:main:discord:slash:user-4", { archivedAt: 13, pluginOwnerId: "owner" }],
        [
          "agent:main:discord:slash:user-5",
          { archivedAt: 14, archiveReason: "active-session-cap" },
        ],
        ["agent:main:discord:slash:user-6", { archivedAt: 15, archiveReason: "age-retention" }],
      ] as const;
      for (const [sessionKey, fields] of entries) {
        await replaceSessionEntry(
          { agentId: "main", sessionKey, env: state.env },
          {
            sessionId: sessionKey,
            updatedAt: 1,
            ...fields,
          },
        );
      }

      const findings = detectArchivedNativeCommandSources({ cfg, env: state.env });
      expect(findings).toEqual([
        {
          key: "agent:main:discord:slash:user-1",
          sessionId: "agent:main:discord:slash:user-1",
          reason: "manual",
        },
        {
          key: "agent:main:discord:slash:user-5",
          sessionId: "agent:main:discord:slash:user-5",
          reason: "active-session-cap",
        },
        {
          key: "agent:main:discord:slash:user-6",
          sessionId: "agent:main:discord:slash:user-6",
          reason: "age-retention",
        },
        {
          key: "agent:main:slack:slash:user-2",
          sessionId: "agent:main:slack:slash:user-2",
          reason: "unknown",
        },
      ]);
      noteArchivedNativeCommandSources({ cfg, env: state.env });
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining("Control UI → Sessions → Archived"),
        "Archived native commands",
      );
      const contribution = nativeArchiveContribution();
      expect(contribution.updateWork).toEqual({ kind: "standalone" });
      await contribution.run({
        cfg,
        env: state.env,
        options: { yes: true },
      } as DoctorHealthFlowContext);
      for (const [sessionKey, fields] of entries) {
        expect(
          loadExactSessionEntryReadOnly({ agentId: "main", sessionKey, env: state.env })?.entry,
        ).toMatchObject({
          sessionId: sessionKey,
          ...fields,
        });
      }
    },
  );
});

it("requires maintenance custody and restores only exact internal sources without rotating identity", async () => {
  await withOpenClawTestState(
    { scenario: "minimal", label: "doctor-native-archives-repair" },
    async (state) => {
      const cfg = { agents: { entries: { main: {} } } };
      setRuntimeConfigSnapshot(cfg);
      const entries = [
        ["agent:main:discord:slash:user-1", { archivedAt: 10, archiveReason: "manual" }],
        ["agent:main:slack:slash:user-2", { archivedAt: 11, archiveReason: "age-retention" }],
        ["agent:main:discord:channel:room-1", { archivedAt: 12 }],
        ["agent:main:discord:slash:user-3", { archivedAt: 13, pluginOwnerId: "owner" }],
        ["agent:main:discord:slash:user-4", {}],
        [
          "agent:main:discord:slash:user-5",
          {
            archivedAt: 14,
            worktree: { id: "missing", branch: "fixture", repoRoot: "/missing-repo" },
          },
        ],
      ] as const;
      for (const [sessionKey, fields] of entries) {
        await replaceSessionEntry(
          { agentId: "main", sessionKey, env: state.env },
          { sessionId: `id:${sessionKey}`, updatedAt: 7, ...fields },
        );
      }
      const before = new Map(
        entries.map(
          ([sessionKey]) =>
            [
              sessionKey,
              loadExactSessionEntryReadOnly({ agentId: "main", sessionKey, env: state.env })?.entry,
            ] as const,
        ),
      );
      const params = { cfg, env: state.env };
      await expect(repairArchivedNativeCommandSources(params)).rejects.toThrow(
        "requires Doctor maintenance ownership",
      );
      const maintenance = createOpenClawDatabaseMaintenanceScope({
        schemaMaintenance: true,
        assertOwnerCurrent: () => {},
        assertDatabaseAccess: () => {},
      });
      try {
        await expect(
          maintenance.run(() =>
            nativeArchiveContribution().run({
              cfg,
              env: state.env,
              options: { repair: true },
            } as DoctorHealthFlowContext),
          ),
        ).resolves.toBeUndefined();
      } finally {
        await maintenance.close();
      }
      expect(note).toHaveBeenCalledWith(
        expect.stringContaining(
          "Found 3 archived native-command source session(s); restored 2, skipped 1",
        ),
        "Archived native commands",
      );
      for (const [sessionKey, fields] of entries) {
        const entry = loadExactSessionEntryReadOnly({
          agentId: "main",
          sessionKey,
          env: state.env,
        })?.entry;
        const expected = { ...before.get(sessionKey) };
        if (
          sessionKey.includes(":slash:") &&
          !("pluginOwnerId" in fields) &&
          !("worktree" in fields)
        ) {
          delete expected.archivedAt;
          delete expected.archivedBy;
          delete expected.archiveReason;
        }
        expect(entry).toEqual(expected);
      }
    },
  );
});

it("omits native archive repair during updater Doctor but restores it in standalone Doctor", async () => {
  await withOpenClawTestState(
    { scenario: "minimal", label: "doctor-native-archives-updater" },
    async (state) => {
      note.mockClear();
      const cfg = { agents: { entries: { main: {} } } };
      setRuntimeConfigSnapshot(cfg);
      const sessionKey = "agent:main:discord:slash:updater-user";
      const scope = { agentId: "main", sessionKey, env: state.env };
      await replaceSessionEntry(scope, {
        sessionId: "updater-source",
        updatedAt: 7,
        archivedAt: 10,
        archiveReason: "manual",
      });
      const maintenance = createOpenClawDatabaseMaintenanceScope({
        schemaMaintenance: true,
        assertOwnerCurrent: () => {},
        assertDatabaseAccess: () => {},
      });
      try {
        await maintenance.run(() =>
          runDoctorHealthContributionList(
            createDoctorHealthFlowContext({
              cfg,
              env: { ...state.env, OPENCLAW_UPDATE_IN_PROGRESS: "1" },
              options: { repair: true },
            }),
            [nativeArchiveContribution()],
          ),
        );
        expect(loadExactSessionEntryReadOnly(scope)?.entry.archivedAt).toBe(10);
        expect(note).toHaveBeenCalledWith(
          expect.stringContaining("Omitted during update: Native command archives"),
          "Update Doctor scope",
        );

        await maintenance.run(() =>
          runDoctorHealthContributionList(
            createDoctorHealthFlowContext({ cfg, env: state.env, options: { repair: true } }),
            [nativeArchiveContribution()],
          ),
        );
        expect(loadExactSessionEntryReadOnly(scope)?.entry).toMatchObject({
          sessionId: "updater-source",
          updatedAt: 7,
        });
        expect(loadExactSessionEntryReadOnly(scope)?.entry.archivedAt).toBeUndefined();
      } finally {
        await maintenance.close();
      }
    },
  );
});

it("restores a managed archived worktree while preserving the transcript and session identity", async () => {
  await withOpenClawTestState(
    { scenario: "minimal", label: "doctor-native-archives-worktree" },
    async (state) => {
      const cfg = { agents: { entries: { main: {} } } };
      setRuntimeConfigSnapshot(cfg);
      const sessionKey = "agent:main:discord:slash:worktree-user";
      const sessionId = "archived-native-worktree";
      const scope = { agentId: "main", sessionKey, env: state.env };
      const repoRoot = await initializeRepository(state.path("worktree-fixture"));
      const record = await materializeManagedWorktreeFixture({
        env: state.env,
        stateDir: state.stateDir,
        repoRoot,
        name: "native-archive",
        now: 1,
        ownerKind: "session",
        ownerId: sessionKey,
      });
      await fs.writeFile(path.join(record.path, "draft.txt"), "retained worktree draft\n");
      await new ManagedWorktreeService({ env: state.env, now: () => 2 }).remove({
        id: record.id,
        reason: "archive fixture",
      });
      expect(getRegistryWorktree(state.env, record.id)?.removedAt).toBe(2);
      await replaceSessionEntry(scope, {
        sessionId,
        updatedAt: 7,
        worktree: { id: record.id, branch: record.branch, repoRoot },
      });
      const transcriptScope = { ...scope, sessionId };
      await appendTranscriptMessage(transcriptScope, {
        eventId: "retained-user-event",
        message: { role: "user", content: "retained history", timestamp: 1 },
      });
      const transcriptBefore = loadTranscriptEventsSync(transcriptScope);
      expect(transcriptBefore).toHaveLength(2);
      expect(transcriptBefore.at(-1)).toMatchObject({
        type: "message",
        id: "retained-user-event",
        message: { role: "user", content: "retained history" },
      });
      await replaceSessionEntry(scope, {
        sessionId,
        updatedAt: 7,
        archivedAt: 10,
        archiveReason: "manual",
        worktree: { id: record.id, branch: record.branch, repoRoot },
      });
      const before = loadExactSessionEntryReadOnly(scope)?.entry;
      expect(before).toMatchObject({
        sessionId,
        updatedAt: 7,
        archivedAt: 10,
        worktree: { id: record.id, branch: record.branch, repoRoot },
      });
      const maintenance = createOpenClawDatabaseMaintenanceScope({
        schemaMaintenance: true,
        assertOwnerCurrent: () => {},
        assertDatabaseAccess: () => {},
      });
      try {
        await maintenance.run(() => repairArchivedNativeCommandSources({ cfg, env: state.env }));
      } finally {
        await maintenance.close();
      }
      const after = loadExactSessionEntryReadOnly(scope)?.entry;
      const expected = { ...before };
      delete expected.archivedAt;
      delete expected.archiveReason;
      expect(after).toEqual(expected);
      expect(after?.archivedAt).toBeUndefined();
      expect(loadTranscriptEventsSync(transcriptScope)).toEqual(transcriptBefore);
      expect(await fs.readFile(path.join(record.path, "draft.txt"), "utf8")).toBe(
        "retained worktree draft\n",
      );
      expect(getRegistryWorktree(state.env, record.id)?.removedAt).toBeUndefined();
    },
  );
});

it("leaves a source archived when its lifecycle revision changes after the scan", async () => {
  await withOpenClawTestState(
    { scenario: "minimal", label: "doctor-native-archives-stale" },
    async (state) => {
      const cfg = { agents: { entries: { main: {} } } };
      setRuntimeConfigSnapshot(cfg);
      const sessionKey = "agent:main:discord:slash:stale-user";
      const scope = { agentId: "main", sessionKey, env: state.env };
      await replaceSessionEntry(scope, {
        sessionId: "stale-source",
        updatedAt: 7,
        archivedAt: 10,
        lifecycleRevision: 1,
      });
      const restore = vi
        .spyOn(sessionWorktreeLifecycle, "restoreSessionWorktree")
        .mockImplementationOnce(async () => {
          await replaceSessionEntry(scope, {
            sessionId: "stale-source",
            updatedAt: 7,
            archivedAt: 10,
            lifecycleRevision: 2,
          });
          return () => {};
        });
      const maintenance = createOpenClawDatabaseMaintenanceScope({
        schemaMaintenance: true,
        assertOwnerCurrent: () => {},
        assertDatabaseAccess: () => {},
      });
      try {
        await expect(
          maintenance.run(() => repairArchivedNativeCommandSources({ cfg, env: state.env })),
        ).resolves.toEqual({ found: 1, repaired: 0, skipped: 1 });
        expect(restore).toHaveBeenCalledOnce();
      } finally {
        restore.mockRestore();
        await maintenance.close();
      }
      expect(loadExactSessionEntryReadOnly(scope)?.entry).toMatchObject({
        sessionId: "stale-source",
        archivedAt: 10,
        lifecycleRevision: 2,
      });
    },
  );
});
