import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  resolveAgentWorkspaceDir,
  tryResolveLegacyCompatibilityAgentId,
  withAgentRosterFactsBatch,
} from "../../../../src/agents/agent-scope-config.js";
import { setRetainedLegacyDefaultAgentId } from "../../../../src/config/legacy.default-agent-owner-state.js";
import { materializeLegacyDefaultAgentRoles } from "../../../../src/config/legacy.default-agent-roles.js";
import { materializeRuntimeConfig } from "../../../../src/config/materialize.js";
import type { OpenClawConfig as CoreOpenClawConfig } from "../../../../src/config/types.js";
import {
  normalizeConfiguredMemoryExtraPaths,
  resolveMemoryHostAgentWorkspaceDir,
  resolveRememberAcrossConversations,
  type OpenClawConfig,
} from "./config-utils.js";

describe("resolveMemoryHostAgentWorkspaceDir", () => {
  it("keeps the retained data workspace separate from the runtime owner through materialization and restart", () => {
    const workspace = path.resolve("/srv/shared");
    const cfg: CoreOpenClawConfig = {
      agents: {
        ownership: "explicit",
        defaults: { workspace, systemAgent: { agentId: "other" } },
        entries: { main: {}, other: {} },
      },
    };
    setRetainedLegacyDefaultAgentId(cfg, "main");
    const runtime = materializeRuntimeConfig(cfg, { manifestRegistry: { plugins: [] } });
    const saved = materializeLegacyDefaultAgentRoles(runtime, "main", {
      materializeWorkspace: true,
    }).config;
    const serialized = JSON.stringify(saved);
    const restarted: CoreOpenClawConfig = JSON.parse(serialized);

    expect(saved.agents?.entries?.main?.workspace).toBe(workspace);
    expect(cfg.agents?.entries?.main?.workspace).toBeUndefined();
    for (const config of [cfg, runtime, restarted]) {
      expect(tryResolveLegacyCompatibilityAgentId(config)).toBe("other");
      for (const resolveWorkspace of [
        resolveAgentWorkspaceDir,
        resolveMemoryHostAgentWorkspaceDir,
      ]) {
        expect(resolveWorkspace(config, "main")).toBe(workspace);
        expect(resolveWorkspace(config, "other")).toBe(path.join(workspace, "other"));
      }
    }
  });

  it.each(["runtime first", "workspace first"])(
    "keeps runtime and workspace ownership separate in a roster batch with %s",
    (order) => {
      const workspace = path.resolve("/srv/shared");
      const cfg = {
        agents: {
          ownership: "explicit" as const,
          defaults: { workspace, systemAgent: { agentId: "other" } },
          entries: { main: {}, other: {} },
        },
      };
      setRetainedLegacyDefaultAgentId(cfg, "main");

      withAgentRosterFactsBatch(cfg, () => {
        if (order === "runtime first") {
          expect(tryResolveLegacyCompatibilityAgentId(cfg)).toBe("other");
        }
        expect(resolveAgentWorkspaceDir(cfg, "main")).toBe(workspace);
        expect(tryResolveLegacyCompatibilityAgentId(cfg)).toBe("other");
        expect(resolveAgentWorkspaceDir(cfg, "other")).toBe(path.join(workspace, "other"));
        expect(resolveMemoryHostAgentWorkspaceDir(cfg, "main")).toBe(workspace);
      });

      setRetainedLegacyDefaultAgentId(cfg, "other");
      withAgentRosterFactsBatch(cfg, () => {
        expect(resolveAgentWorkspaceDir(cfg, "main")).toBe(path.join(workspace, "main"));
        expect(resolveAgentWorkspaceDir(cfg, "other")).toBe(workspace);
        expect(resolveMemoryHostAgentWorkspaceDir(cfg, "main")).toBe(path.join(workspace, "main"));
        expect(tryResolveLegacyCompatibilityAgentId(cfg)).toBe("other");
      });
    },
  );

  it.each<{
    name: string;
    entries: NonNullable<NonNullable<OpenClawConfig["agents"]>["entries"]>;
    retained?: string;
  }>([
    { name: "two agents", entries: { main: {}, support: {} } },
    { name: "reordered agents", entries: { support: {}, main: {} } },
    { name: "sole agent", entries: { main: {} } },
    { name: "explicit workspace", entries: { main: { workspace: "~/pinned" }, support: {} } },
    { name: "retained migration owner", entries: { main: {}, support: {} }, retained: "support" },
    { name: "removed migration owner", entries: { main: {}, support: {} }, retained: "removed" },
    { name: "ignored legacy marker", entries: { main: { default: true }, support: {} } },
  ])("agrees with canonical explicit workspace selection for $name", ({ entries, retained }) => {
    const cfg = {
      agents: { ownership: "explicit" as const, defaults: { workspace: "~/shared" }, entries },
    };
    setRetainedLegacyDefaultAgentId(cfg, retained);
    for (const agentId of Object.keys(entries)) {
      const env = { HOME: "/home/fixture" };
      expect(resolveMemoryHostAgentWorkspaceDir(cfg, agentId, env)).toBe(
        resolveAgentWorkspaceDir(cfg, agentId, env),
      );
    }
  });

  it.each([
    { name: "absent roster", agents: {}, expected: "shared" },
    { name: "empty roster", agents: { entries: {} }, expected: "shared/main" },
    {
      name: "duplicate IDs",
      agents: { list: [{ id: "main" }, { id: "MAIN" }] },
      expected: "shared/main",
    },
  ])("respects explicit $name inheritance", ({ agents, expected }) => {
    const cfg: OpenClawConfig = {
      agents: { ...agents, ownership: "explicit", defaults: { workspace: "~/shared" } },
    };
    expect(resolveMemoryHostAgentWorkspaceDir(cfg, "main", { HOME: "/home/fixture" })).toBe(
      path.resolve("/home/fixture", expected),
    );
  });

  it("preserves optional legacy IDs in explicitly owned reader input", () => {
    const cfg: OpenClawConfig = {
      agents: {
        ownership: "explicit",
        defaults: { workspace: "~/shared" },
        list: [{}, { id: "support" }],
      },
    };
    const env = { HOME: "/home/fixture" };
    expect(resolveMemoryHostAgentWorkspaceDir(cfg, "main", env)).toBe(
      path.resolve("/home/fixture/shared/main"),
    );
    setRetainedLegacyDefaultAgentId(cfg, "support");
    expect(resolveMemoryHostAgentWorkspaceDir(cfg, "support", env)).toBe(
      path.resolve("/home/fixture/shared"),
    );
  });

  it.each([
    { name: "profile alone", stateDir: undefined },
    { name: "explicit profile state directory", stateDir: "/home/fixture/.openclaw-work" },
  ])("uses the active profile workspace with $name", ({ stateDir }) => {
    expect(
      resolveMemoryHostAgentWorkspaceDir({}, "main", {
        HOME: "/home/fixture",
        OPENCLAW_PROFILE: "work",
        OPENCLAW_STATE_DIR: stateDir,
      }),
    ).toBe(path.resolve("/home/fixture/.openclaw-work/workspace"));
  });

  it("keeps the default agent workspace inside an overridden state directory", () => {
    expect(
      resolveMemoryHostAgentWorkspaceDir({}, "main", {
        HOME: "/home/peter",
        OPENCLAW_STATE_DIR: "/srv/openclaw-scratch",
      }),
    ).toBe("/srv/openclaw-scratch/workspace");
  });

  it("prefers an explicit workspace override to the state directory", () => {
    expect(
      resolveMemoryHostAgentWorkspaceDir({}, "main", {
        HOME: "/home/peter",
        OPENCLAW_STATE_DIR: "/srv/openclaw-scratch",
        OPENCLAW_WORKSPACE_DIR: "/srv/openclaw-workspace",
      }),
    ).toBe("/srv/openclaw-workspace");
  });

  it("keeps literal $ patterns in home when expanding tilde workspace paths", () => {
    expect(
      resolveMemoryHostAgentWorkspaceDir(
        { agents: { entries: { support: { workspace: "~/ws" } } } },
        "support",
        { HOME: "/home/peter$&mall", OPENCLAW_HOME: "~/oc" },
      ),
    ).toBe(path.resolve("/home/peter$&mall/oc/ws"));
  });

  it.each([
    {
      name: "tilde state root",
      stateDir: "~/state",
      workspaceDir: undefined,
      expected: "state/workspace",
    },
    {
      name: "tilde workspace override",
      stateDir: "~/state",
      workspaceDir: "~/workspace",
      expected: "workspace",
    },
  ])("expands the $name against OPENCLAW_HOME", ({ stateDir, workspaceDir, expected }) => {
    expect(
      resolveMemoryHostAgentWorkspaceDir({}, "main", {
        HOME: "/home/fixture",
        OPENCLAW_HOME: "~/openclaw-home",
        OPENCLAW_STATE_DIR: stateDir,
        OPENCLAW_WORKSPACE_DIR: workspaceDir,
      }),
    ).toBe(path.resolve("/home/fixture/openclaw-home", expected));
  });

  it.each([
    { name: "default workspace", workspace: undefined, expected: ".openclaw/workspace" },
    { name: "configured workspace", workspace: "~/notes", expected: "notes" },
  ])("uses the Termux home for the $name when HOME is unavailable", ({ workspace, expected }) => {
    const homedir = vi.spyOn(os, "homedir").mockReturnValue("/unexpected/os/home");
    try {
      expect(
        resolveMemoryHostAgentWorkspaceDir(
          { agents: { entries: { main: { workspace } } } },
          "main",
          {
            HOME: "undefined",
            USERPROFILE: "null",
            PREFIX: "/data/data/com.termux/files/usr",
            ANDROID_DATA: "/data",
          },
        ),
      ).toBe(path.resolve("/data/data/com.termux/files/home", expected));
    } finally {
      homedir.mockRestore();
    }
  });

  it.each([
    { agentId: "main", stateDir: undefined, expected: ".openclaw/workspace" },
    { agentId: "support", stateDir: undefined, expected: ".openclaw/workspace-support" },
    { agentId: "main", stateDir: "~/state", expected: "state/workspace" },
    { agentId: "support", stateDir: "~/state", expected: "state/workspace-support" },
  ])(
    "expands the OS fallback home once for $agentId with state override $stateDir",
    ({ agentId, stateDir, expected }) => {
      const homedir = vi.spyOn(os, "homedir").mockReturnValue("/home/fixture");
      try {
        expect(
          resolveMemoryHostAgentWorkspaceDir(
            { agents: { entries: { main: {}, support: {} } } },
            agentId,
            {
              OPENCLAW_HOME: "~/oc",
              OPENCLAW_STATE_DIR: stateDir,
              VITEST: "1",
              OPENCLAW_TEST_FAST: "1",
            },
          ),
        ).toBe(path.resolve("/home/fixture/oc", expected));
      } finally {
        homedir.mockRestore();
      }
    },
  );

  it.each([
    { agentId: "main", override: "state", leaf: "workspace" },
    { agentId: "support", override: "state", leaf: "workspace-support" },
    { agentId: "main", override: "workspace", leaf: "" },
  ])(
    "resolves the absolute $override override for $agentId without home or cwd",
    ({ agentId, override, leaf }) => {
      const absolute = path.resolve("/srv/fixture-override");
      const expected = path.join(absolute, leaf);
      const homedir = vi.spyOn(os, "homedir").mockImplementation(() => {
        throw new Error("fixture home unavailable");
      });
      const cwd = vi.spyOn(process, "cwd").mockImplementation(() => {
        throw new Error("ENOENT: fixture cwd unavailable");
      });
      try {
        expect(
          resolveMemoryHostAgentWorkspaceDir(
            { agents: { entries: { main: {}, support: {} } } },
            agentId,
            {
              OPENCLAW_HOME: "~/oc",
              OPENCLAW_STATE_DIR: override === "state" ? absolute : "~/state",
              OPENCLAW_WORKSPACE_DIR: override === "workspace" ? absolute : undefined,
            },
          ),
        ).toBe(expected);
      } finally {
        cwd.mockRestore();
        homedir.mockRestore();
      }
    },
  );

  it("falls back to cwd when no home source is available", () => {
    const expected = path.join(process.cwd(), ".openclaw", "workspace");
    const homedir = vi.spyOn(os, "homedir").mockImplementation(() => {
      throw new Error("fixture home unavailable");
    });
    try {
      expect(resolveMemoryHostAgentWorkspaceDir({}, "main", {})).toBe(expected);
    } finally {
      homedir.mockRestore();
    }
  });

  it("explains how to recover when both home and cwd are unavailable", () => {
    const homedir = vi.spyOn(os, "homedir").mockImplementation(() => {
      throw new Error("fixture home unavailable");
    });
    const cwd = vi.spyOn(process, "cwd").mockImplementation(() => {
      throw new Error("ENOENT: fixture cwd unavailable");
    });
    try {
      expect(() => resolveMemoryHostAgentWorkspaceDir({}, "main", {})).toThrow(
        "Unable to resolve an OpenClaw home: set OPENCLAW_HOME, HOME, or USERPROFILE",
      );
    } finally {
      cwd.mockRestore();
      homedir.mockRestore();
    }
  });

  it("preserves legacy state precedence for secondary agents without moving the default workspace", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "memory-host-state-"));
    const cfg: OpenClawConfig = { agents: { entries: { main: {}, support: {} } } };
    const env = { HOME: home };
    const legacy = path.join(home, ".clawdbot");
    const current = path.join(home, ".openclaw");
    try {
      await fs.mkdir(legacy);
      expect(resolveMemoryHostAgentWorkspaceDir(cfg, "support", env)).toBe(
        path.join(legacy, "workspace-support"),
      );
      expect(resolveMemoryHostAgentWorkspaceDir(cfg, "main", env)).toBe(
        path.join(current, "workspace"),
      );
      expect(
        resolveMemoryHostAgentWorkspaceDir(cfg, "support", {
          ...env,
          VITEST: "1",
          OPENCLAW_TEST_FAST: "1",
        }),
      ).toBe(path.join(current, "workspace-support"));
      await fs.mkdir(current);
      expect(resolveMemoryHostAgentWorkspaceDir(cfg, "support", env)).toBe(
        path.join(current, "workspace-support"),
      );
      expect(
        resolveMemoryHostAgentWorkspaceDir(cfg, "support", {
          ...env,
          OPENCLAW_STATE_DIR: path.join(home, "override"),
        }),
      ).toBe(path.join(home, "override", "workspace-support"));
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it.each<{
    name: string;
    agents: NonNullable<OpenClawConfig["agents"]>;
    expected: Record<string, string>;
  }>([
    {
      name: "keyed first-agent inheritance",
      agents: { entries: { main: {}, support: {} } },
      expected: { main: "shared", support: "shared/support" },
    },
    {
      name: "marked legacy default",
      agents: { list: [{ id: "first" }, { id: "support", default: true }] },
      expected: { first: "shared/first", support: "shared" },
    },
    {
      name: "optional legacy list id and explicit workspace",
      agents: { list: [{ workspace: "~/anonymous" }, { id: "support" }] },
      expected: { main: "anonymous", support: "shared/support" },
    },
  ])("preserves $name", ({ agents, expected }) => {
    const cfg: OpenClawConfig = {
      agents: { ...agents, defaults: { workspace: "~/shared" } },
    };
    for (const [agentId, relativePath] of Object.entries(expected)) {
      expect(resolveMemoryHostAgentWorkspaceDir(cfg, agentId, { HOME: "/home/fixture" })).toBe(
        path.resolve("/home/fixture", relativePath),
      );
    }
  });
});

describe("resolveRememberAcrossConversations", () => {
  it("honors keyed per-agent memory overrides", () => {
    const config = {
      memory: { search: { rememberAcrossConversations: true } },
      agents: {
        entries: {
          support: { memory: { search: { rememberAcrossConversations: false } } },
        },
      },
    };

    expect(resolveRememberAcrossConversations(config, "support")).toBe(false);
  });
});

describe("normalizeConfiguredMemoryExtraPaths", () => {
  it("preserves distinct patterns and canonicalizes unpatterned objects", () => {
    expect(
      normalizeConfiguredMemoryExtraPaths([
        " notes ",
        { path: "notes" },
        { path: " notes ", pattern: " runbooks/**/*.md " },
        { path: "notes", pattern: "runbooks/**/*.md" },
        { path: "notes", pattern: "decisions/**/*.md" },
      ]),
    ).toEqual([
      "notes",
      { path: "notes", pattern: "runbooks/**/*.md" },
      { path: "notes", pattern: "decisions/**/*.md" },
    ]);
  });
});
