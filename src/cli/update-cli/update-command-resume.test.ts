import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultRuntime } from "../../runtime.js";
import { withOpenClawTestState } from "../../test-utils/openclaw-test-state.js";

const mocks = vi.hoisted(() => ({
  completePluginUpdate: vi.fn(),
  readConfig: vi.fn(),
  runFreshDoctor: vi.fn(),
  updatePlugins: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  readConfigFileSnapshot: mocks.readConfig,
}));
vi.mock("../../plugins/installed-plugin-index-records.js", () => ({
  loadInstalledPluginIndexInstallRecords: vi.fn(async () => ({})),
}));
vi.mock("../../plugins/installed-plugin-index-store.js", () => ({
  readPersistedInstalledPluginIndex: vi.fn(async () => null),
}));
vi.mock("./shared.js", () => ({
  readPackageVersion: vi.fn(async () => "2026.8.1"),
}));
vi.mock("./update-command-config.js", () => ({
  createUpdateConfigSnapshot: vi.fn(async () => undefined),
  persistRequestedUpdateChannel: vi.fn(async ({ configSnapshot }) => configSnapshot),
  readPostCorePreUpdateSourceConfig: vi.fn(async () => undefined),
  restoreDroppedPreUpdateChannels: vi.fn((snapshot) => ({ snapshot, changed: false })),
}));
vi.mock("./update-command-fresh-doctor.js", () => ({
  completePostCorePluginUpdate: mocks.completePluginUpdate,
  runUpdateFinalizationDoctorInFreshProcess: mocks.runFreshDoctor,
}));
vi.mock("./update-command-plugins.js", () => ({
  updatePluginsAfterCoreUpdate: mocks.updatePlugins,
}));
vi.mock("./update-command-post-core.js", () => ({
  POST_CORE_UPDATE_INSTALL_RECORDS_PATH_ENV: "OPENCLAW_UPDATE_POST_CORE_INSTALL_RECORDS_PATH",
  POST_CORE_UPDATE_RESULT_PATH_ENV: "OPENCLAW_UPDATE_POST_CORE_RESULT_PATH",
  POST_CORE_UPDATE_STARTED_AT_ENV: "OPENCLAW_UPDATE_POST_CORE_STARTED_AT_MS",
  readPostCorePluginInstallRecordsFile: vi.fn(async () => undefined),
  resolvePostCoreUpdateStartedAtMs: vi.fn(async () => undefined),
  writePostCorePluginUpdateResultFile: vi.fn(async () => undefined),
}));

import { resumePostCoreUpdate } from "./update-command-resume.js";

async function probePluginLease(scriptPath: string, stateDir: string): Promise<string> {
  const child = spawn(process.execPath, ["--import", "tsx", scriptPath, stateDir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`lease probe exited ${code ?? signal}: ${stderr}`));
      }
    });
  });
}

const configSnapshot = {
  valid: true,
  parsed: {},
  config: {},
  runtimeConfig: {},
  sourceConfig: {},
  warnings: [],
  issues: [],
  legacyIssues: [],
};

const pluginUpdate = {
  status: "ok",
  changed: true,
  sync: { changed: false, switchedToBundled: [], switchedToNpm: [], warnings: [], errors: [] },
  npm: { changed: false, outcomes: [] },
  integrityDrifts: [],
  warnings: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("resumePostCoreUpdate plugin lifecycle lease", () => {
  it("releases the lease before each Doctor subprocess boundary", async () => {
    await withOpenClawTestState({ label: "update-resume-lease" }, async (state) => {
      const leaseModuleUrl = pathToFileURL(
        path.resolve("src/plugins/plugin-lifecycle-lease.ts"),
      ).href;
      const probeScript = await state.writeText(
        "probe-plugin-lease.mts",
        `
          import { withPluginLifecycleLease } from ${JSON.stringify(leaseModuleUrl)};
          const env = { ...process.env, OPENCLAW_STATE_DIR: process.argv[2] };
          try {
            await withPluginLifecycleLease({ env, leaseMs: 1_000, waitMs: 0 }, async () => {});
            process.stdout.write("acquired");
          } catch (error) {
            process.stdout.write(error?.code ?? String(error));
          }
        `,
      );
      const probe = () => probePluginLease(probeScript, state.stateDir);
      vi.stubEnv("OPENCLAW_COMPATIBILITY_HOST_VERSION", "previous");
      mocks.readConfig.mockResolvedValue(configSnapshot);
      mocks.runFreshDoctor.mockImplementation(async () => {
        await expect(probe()).resolves.toBe("acquired");
      });
      mocks.updatePlugins.mockImplementation(async () => {
        await expect(probe()).resolves.toBe("OPENCLAW_STATE_LEASE_TIMEOUT");
        return pluginUpdate;
      });
      mocks.completePluginUpdate.mockImplementation(async () => {
        await expect(probe()).resolves.toBe("acquired");
        return { pluginUpdate, configSnapshot };
      });
      vi.spyOn(defaultRuntime, "exit").mockImplementation(() => undefined as never);

      await resumePostCoreUpdate({
        root: "/tmp/openclaw",
        channel: "dev",
        opts: { yes: true },
        timeoutMs: 1_000,
      });

      expect(mocks.runFreshDoctor).toHaveBeenCalledOnce();
      expect(mocks.updatePlugins).toHaveBeenCalledOnce();
      expect(mocks.completePluginUpdate).toHaveBeenCalledOnce();
    });
  });
});
