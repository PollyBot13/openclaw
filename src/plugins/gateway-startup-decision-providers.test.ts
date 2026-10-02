import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveGatewayStartupMetadataPluginIds } from "./gateway-startup-plugin-metadata.js";
import { resolveGatewayStartupPluginPlanFromRegistry } from "./gateway-startup-plugin-plan.js";
import { createPluginMetadataSnapshotFixture } from "./plugin-metadata.test-support.js";

function fixture() {
  const snapshot = createPluginMetadataSnapshotFixture({
    plugins: [
      {
        id: "decision-plugin",
        enabledByDefault: false,
        contracts: { decisionProviders: ["decision-provider"] },
      },
      {
        id: "router",
        enabledByDefault: false,
        activation: { onStartup: true },
        decisionRouter: { configMapProperty: "byTask" },
      },
      { id: "allowed-plugin" },
    ],
  });
  snapshot.index.plugins[0]!.contributions = {
    channels: [],
    channelConfigs: [],
    providers: [],
    modelCatalogProviders: [],
    modelSupportPrefixes: [],
    modelSupportPatterns: [],
    autoEnableProviderIds: [],
    commandAliases: [],
    contracts: { decisionProviders: ["decision-provider"] },
  };
  return snapshot;
}

describe("decision provider startup", () => {
  it("activates a provider referenced only by an explicitly enabled router map", () => {
    const metadata = fixture();
    const plan = resolveGatewayStartupPluginPlanFromRegistry({
      config: {
        agents: { defaults: { decisionModel: "other/default" } },
        plugins: {
          entries: {
            router: {
              enabled: true,
              config: { byTask: { "core/tool-prefilter": "decision-provider/fast" } },
            },
          },
        },
      },
      env: {},
      index: metadata.index,
      manifestRegistry: metadata.manifestRegistry,
    });
    expect(plan.pluginIds).toContain("decision-plugin");
    expect(plan.pluginIds).toContain("router");
  });

  it.each<{ name: string; config: OpenClawConfig; expected: string[] }>([
    { name: "unselected", config: {}, expected: [] },
    {
      name: "selected by an agent override",
      config: { agents: { entries: { specialist: { decisionModel: "decision-provider/fast" } } } },
      expected: ["decision-plugin"],
    },
    {
      name: "selected by defaults without a chat model",
      config: { agents: { defaults: { decisionModel: "decision-provider/fast" } } },
      expected: ["decision-plugin"],
    },
    {
      name: "explicitly disabled",
      config: {
        agents: { defaults: { decisionModel: "decision-provider/fast" } },
        plugins: { entries: { "decision-plugin": { enabled: false } } },
      },
      expected: [],
    },
  ])("loads the configured owner when $name", ({ config, expected }) => {
    const metadata = fixture();
    expect(
      resolveGatewayStartupPluginPlanFromRegistry({
        config,
        env: {},
        index: metadata.index,
        manifestRegistry: metadata.manifestRegistry,
      }).pluginIds,
    ).toEqual(expected);
  });

  it("maps per-agent provider IDs through contract ownership in metadata scopes", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "openclaw-decision-startup-"));
    try {
      expect(
        resolveGatewayStartupMetadataPluginIds({
          config: {
            agents: { entries: { specialist: { decisionModel: "decision-provider/fast" } } },
            plugins: { allow: ["allowed-plugin"], slots: { memory: "none" } },
          },
          // Metadata scope must not inherit this machine's bundled-discovery upgrade state.
          env: { OPENCLAW_STATE_DIR: stateDir },
          index: fixture().index,
        }),
      ).toEqual(["allowed-plugin", "decision-plugin"]);
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
