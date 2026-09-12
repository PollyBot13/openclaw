import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { loadOpenClawPlugins } from "./loader.js";
import {
  cleanupPluginLoaderFixturesForTest,
  EMPTY_PLUGIN_SCHEMA,
  makePluginLoaderTempDir,
  resetPluginLoaderTestStateForTest,
  useNoBundledPlugins,
  writePlugin,
} from "./loader.test-fixtures.js";
import { clearPluginMetadataLifecycleCaches } from "./plugin-metadata-lifecycle.js";
import { loadPluginMetadataSnapshot } from "./plugin-metadata-snapshot.js";
import { disposePluginRegistryInstances } from "./runtime.js";
import { applySlotSelectionForPlugin } from "./slot-selection.js";

afterEach(() => {
  resetPluginLoaderTestStateForTest();
  clearPluginMetadataLifecycleCaches();
  vi.unstubAllEnvs();
});
afterAll(cleanupPluginLoaderFixturesForTest);

it.each(["broken", "missing"] as const)(
  "selects a declared engine through cold startup and clears it with %s plugin source",
  async (sourceState) => {
    const { resolveContextEngine } = await import("../context-engine/registry.js");
    const { loadGatewayStartupPluginPlan } = await import("./gateway-startup-plugin-loader.js");
    const { planPluginUninstall } = await import("./uninstall.js");
    useNoBundledPlugins();
    const stateDir = makePluginLoaderTempDir();
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    const imported = path.join(stateDir, "runtime-imported");
    const plugin = writePlugin({
      id: "vendor-plugin",
      body: `require("node:fs").writeFileSync(${JSON.stringify(imported)}, "loaded");
module.exports = { id: "vendor-plugin", kind: "context-engine", register(api) {
  api.registerContextEngine("canonical-engine", () => ({
    info: { id: "canonical-engine", name: "Synthetic Engine" },
    ingest: async () => ({ ingested: true }),
    assemble: async () => ({ messages: [], estimatedTokens: 0, systemPromptAddition: "custom-engine-used" }),
    compact: async () => ({ ok: true, compacted: false }),
  }));
} };`,
    });
    fs.writeFileSync(
      path.join(plugin.dir, "openclaw.plugin.json"),
      JSON.stringify({
        id: plugin.id,
        kind: "context-engine",
        contextEngineIds: ["canonical-engine"],
        configSchema: EMPTY_PLUGIN_SCHEMA,
      }),
    );
    const config: OpenClawConfig = {
      plugins: {
        allow: [plugin.id],
        entries: { [plugin.id]: { enabled: true } },
        load: { paths: [plugin.file] },
        slots: { memory: "none" },
      },
    };
    const metadata = loadPluginMetadataSnapshot({
      config,
      allowCurrent: false,
      preferPersisted: false,
    });
    expect(metadata.byPluginId.get(plugin.id)?.contextEngineIds).toEqual(["canonical-engine"]);
    const selected = await applySlotSelectionForPlugin(config, plugin.id, metadata);
    expect(selected.config.plugins?.slots?.contextEngine).toBe("canonical-engine");
    expect(fs.existsSync(imported)).toBe(false);

    const configPath = path.join(stateDir, "selected-config.json");
    fs.writeFileSync(configPath, JSON.stringify(selected.config));
    const persisted: OpenClawConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    clearPluginMetadataLifecycleCaches();
    const fresh = loadPluginMetadataSnapshot({
      config: persisted,
      allowCurrent: false,
      preferPersisted: false,
    });
    const plan = loadGatewayStartupPluginPlan({
      config: persisted,
      env: process.env,
      metadataSnapshot: fresh,
    });
    expect(plan.pluginIds).toContain(plugin.id);
    expect(plan.pluginIds).not.toContain("canonical-engine");
    expect(fs.existsSync(imported)).toBe(false);
    const registry = loadOpenClawPlugins({
      config: persisted,
      onlyPluginIds: [...plan.pluginIds],
      runtimeSideEffects: true,
      cache: false,
    });
    try {
      expect(registry.plugins.find((entry) => entry.id === plugin.id)?.status).toBe("loaded");
      const engine = await resolveContextEngine(persisted);
      try {
        expect(engine.info.id).toBe("canonical-engine");
        expect(await engine.assemble({ sessionId: "synthetic", messages: [] })).toMatchObject({
          systemPromptAddition: "custom-engine-used",
        });
      } finally {
        await engine.dispose?.();
      }
    } finally {
      await disposePluginRegistryInstances(registry);
    }

    // The install ledger survives source failure. No runtime introspection is available here.
    persisted.plugins!.installs = {
      [plugin.id]: {
        source: "path",
        sourcePath: plugin.dir,
        contextEngineIdsByPlugin: { [plugin.id]: ["canonical-engine"] },
      },
    };
    if (sourceState === "broken") {
      fs.writeFileSync(plugin.file, "throw new Error('must not import during uninstall');");
    } else {
      fs.rmSync(plugin.dir, { recursive: true });
    }
    const uninstall = planPluginUninstall({
      config: persisted,
      pluginId: plugin.id,
      deleteFiles: false,
    });
    expect(uninstall.ok).toBe(true);
    if (!uninstall.ok) throw new Error(uninstall.error);
    expect(uninstall.actions.contextEngineSlot).toBe(true);
    expect(uninstall.config.plugins?.slots?.contextEngine).toBeUndefined();
  },
);
