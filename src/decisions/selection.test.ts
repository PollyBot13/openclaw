import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { createPluginRecord } from "../plugins/loader-records.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import {
  configuredRouterProviderIds,
  resolveDecisionSelection,
  sameDecisionSelection,
} from "./selection.js";
import { CORE_DECISION_TASKS } from "./task-ids.js";

const router = createPluginRecord({
  id: "decision-router",
  source: "/synthetic/router.ts",
  origin: "global",
  enabled: true,
  configSchema: true,
  decisionRouter: { configMapProperty: "byTask" },
});

function routedConfig(byTask: Record<string, string | { off: true }>): OpenClawConfig {
  return {
    agents: {
      defaults: { decisionModel: "fixture/default" },
      entries: { disabled: { decisionModel: "" } },
    },
    plugins: { entries: { "decision-router": { enabled: true, config: { byTask } } } },
  };
}

describe("declarative Decision routing", () => {
  it("inherits unless an explicitly enabled router assigns the task", () => {
    const registry = createEmptyPluginRegistry();
    registry.plugins.push(router);
    const config = routedConfig({ [CORE_DECISION_TASKS.toolPrefilter]: "other/fast" });
    expect(
      resolveDecisionSelection(config, "main", CORE_DECISION_TASKS.toolPrefilter, registry),
    ).toMatchObject({
      provider: "other",
      model: "fast",
      source: "router",
    });
    expect(
      resolveDecisionSelection(config, "main", CORE_DECISION_TASKS.decisionEvaluate, registry),
    ).toMatchObject({
      provider: "fixture",
      model: "default",
      source: "scalar",
    });
    expect(
      resolveDecisionSelection(config, "disabled", CORE_DECISION_TASKS.toolPrefilter, registry),
    ).toBeUndefined();
    expect(
      resolveDecisionSelection(
        {
          ...config,
          plugins: {
            entries: {
              "decision-router": {
                enabled: false,
                config: { byTask: { [CORE_DECISION_TASKS.toolPrefilter]: "other/fast" } },
              },
            },
          },
        },
        "main",
        CORE_DECISION_TASKS.toolPrefilter,
        registry,
      ),
    ).toMatchObject({ provider: "fixture", model: "default" });
  });

  it("treats off as distinct from inherit and fences changed effective selections", () => {
    const registry = createEmptyPluginRegistry();
    registry.plugins.push(router);
    const initial = resolveDecisionSelection(
      routedConfig({ [CORE_DECISION_TASKS.toolPrefilter]: "other/fast" }),
      "main",
      CORE_DECISION_TASKS.toolPrefilter,
      registry,
    );
    const off = resolveDecisionSelection(
      routedConfig({ [CORE_DECISION_TASKS.toolPrefilter]: { off: true } }),
      "main",
      CORE_DECISION_TASKS.toolPrefilter,
      registry,
    );
    const inherited = resolveDecisionSelection(
      routedConfig({}),
      "main",
      CORE_DECISION_TASKS.toolPrefilter,
      registry,
    );
    expect(off).toBeUndefined();
    expect(sameDecisionSelection(initial, off)).toBe(false);
    expect(sameDecisionSelection(initial, inherited)).toBe(false);
  });

  it("extracts model providers before plugin code loads, only for enabled routers", () => {
    const config = routedConfig({
      [CORE_DECISION_TASKS.toolPrefilter]: "other/fast",
      [CORE_DECISION_TASKS.decisionEvaluate]: { off: true },
    });
    expect(
      configuredRouterProviderIds(config, [
        { id: "decision-router", decisionRouter: { configMapProperty: "byTask" } },
      ]),
    ).toEqual(["other"]);
    expect(
      configuredRouterProviderIds({ ...config, plugins: { entries: {} } }, [
        { id: "decision-router", decisionRouter: { configMapProperty: "byTask" } },
      ]),
    ).toEqual([]);
  });
});
