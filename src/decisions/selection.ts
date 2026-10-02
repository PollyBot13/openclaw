import { parseProviderModelRef } from "@openclaw/model-catalog-core/model-catalog-refs";
import { resolveAgentConfig } from "../agents/agent-scope-config.js";
import { resolveDecisionModelSetting } from "../agents/decision-model-setting.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { getPluginInstance } from "../plugins/plugin-instance-scope.js";
import type { PluginRecord, PluginRegistry } from "../plugins/registry-types.js";
import { isRecord } from "../utils.js";
import type { DecisionTaskId } from "./task-ids.js";
import { DecisionContractError } from "./validation.js";

export type DecisionSelection = {
  provider: string;
  model: string;
  source: "scalar" | "router" | "candidate";
  router?: PluginRecord;
};

/** A manual evaluation may name a model, but agent-wide disable still wins. */
export function resolveCandidateDecisionSelection(
  config: OpenClawConfig,
  agentId: string | undefined,
  candidateModel: string,
): DecisionSelection | undefined {
  if (agentId && resolveAgentConfig(config, agentId)?.decisionModel === "") {
    return undefined;
  }
  if (!resolveDecisionModelSetting(config, agentId)) {
    return undefined;
  }
  const selected = parseProviderModelRef(candidateModel);
  if (!selected) {
    throw new DecisionContractError();
  }
  return { ...selected, source: "candidate" };
}

/** Selection is a local read of validated plugin config; no plugin code runs on this path. */
export function resolveDecisionSelection(
  config: OpenClawConfig,
  agentId?: string,
  taskId?: DecisionTaskId,
  registry?: PluginRegistry | null,
): DecisionSelection | undefined {
  if (agentId && resolveAgentConfig(config, agentId)?.decisionModel === "") {
    return undefined;
  }
  const scalar = resolveDecisionModelSetting(config, agentId);
  if (!scalar) {
    return undefined;
  }
  const inherited: DecisionSelection = { ...scalar, source: "scalar" };
  if (!taskId || !registry || config.plugins?.enabled === false) {
    return inherited;
  }
  const routers = registry.plugins.filter(
    (record) =>
      record.decisionRouter &&
      record.enabled &&
      record.status === "loaded" &&
      getPluginInstance(record)?.acceptingCalls !== false &&
      config.plugins?.entries?.[record.id]?.enabled === true,
  );
  if (routers.length === 0) {
    return inherited;
  }
  if (routers.length !== 1) {
    throw new DecisionContractError();
  }
  const router = routers[0]!;
  const property = router.decisionRouter!.configMapProperty;
  const pluginConfig = config.plugins?.entries?.[router.id]?.config;
  const map = isRecord(pluginConfig) ? pluginConfig[property] : undefined;
  if (!isRecord(map) || !Object.hasOwn(map, taskId)) {
    return inherited;
  }
  const value = map[taskId];
  if (isRecord(value) && value.off === true && Object.keys(value).length === 1) {
    return undefined;
  }
  const selected = typeof value === "string" ? parseProviderModelRef(value) : null;
  if (!selected) {
    throw new DecisionContractError();
  }
  return { ...selected, source: "router", router };
}

export function sameDecisionSelection(
  left: DecisionSelection | undefined,
  right: DecisionSelection | undefined,
): boolean {
  return (
    left?.provider === right?.provider &&
    left?.model === right?.model &&
    left?.source === right?.source &&
    left?.router === right?.router
  );
}

/** Bootstrap reads only explicitly enabled routers' declared, schema-validated map. */
export function configuredRouterProviderIds(
  config: OpenClawConfig,
  manifests: readonly { id: string; decisionRouter?: { configMapProperty: string } }[],
): string[] {
  if (config.plugins?.enabled === false) {
    return [];
  }
  const providers = new Set<string>();
  for (const manifest of manifests) {
    const property = manifest.decisionRouter?.configMapProperty;
    const entry = config.plugins?.entries?.[manifest.id];
    if (!property || entry?.enabled !== true || !isRecord(entry.config)) {
      continue;
    }
    const map = entry.config[property];
    if (!isRecord(map)) {
      continue;
    }
    for (const value of Object.values(map)) {
      const selected = typeof value === "string" ? parseProviderModelRef(value) : null;
      if (selected) {
        providers.add(selected.provider);
      }
    }
  }
  return [...providers];
}
