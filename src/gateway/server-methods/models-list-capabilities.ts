import type { ModelsListResult } from "../../../packages/gateway-protocol/src/schema/agents-models-skills.js";
import { createPreparedModelCatalogProviderNormalizer } from "../../agents/model-catalog-provider-normalizer.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { createInstalledPluginEnabledPredicate } from "../../plugins/installed-plugin-index.js";
import {
  isManifestPluginAvailableForControlPlane,
  listAvailableManifestContractPlugins,
} from "../../plugins/manifest-contract-eligibility.js";
import type { PluginMetadataSnapshot } from "../../plugins/plugin-metadata-snapshot.types.js";
import { resolveModelProviderCapabilities } from "./model-provider-capabilities.js";

export class UnknownModelCatalogProviderError extends Error {}

type ApiKeyProviderCapabilities = {
  providers: ReadonlyMap<string, boolean>;
  resolveProvider(provider: string): string;
};
export function apiKeyProviderCapabilities(params: {
  cfg: OpenClawConfig;
  metadataSnapshot: PluginMetadataSnapshot;
  workspaceDir: string;
}): ApiKeyProviderCapabilities {
  const { capabilities, resolveProvider } = resolveModelProviderCapabilities({
    config: params.cfg,
    metadataSnapshot: params.metadataSnapshot,
    workspaceDir: params.workspaceDir,
  });
  return {
    providers: new Map(
      capabilities.map(({ provider, apiKeySupported }) => [provider, apiKeySupported]),
    ),
    resolveProvider,
  };
}

export function listDecisionModels({
  config,
  snapshot,
}: {
  config: OpenClawConfig;
  snapshot: PluginMetadataSnapshot;
}) {
  const decisionModels: NonNullable<ModelsListResult["decisionModels"]> = [];
  if (config.plugins?.enabled !== false) {
    const seen = new Set<string>();
    for (const plugin of listAvailableManifestContractPlugins({
      snapshot,
      config,
      contract: "decisionProviders",
    })) {
      for (const model of plugin.decisionModels ?? []) {
        const key = `${model.provider}/${model.id}`;
        if (!seen.has(key)) {
          decisionModels.push({ ...model, pluginId: plugin.id });
          seen.add(key);
        }
      }
    }
  }
  return decisionModels;
}

/** Read-only task inventory; no plugin runtime, provider load or inference. */
export function listDecisionTasks({
  config,
  snapshot,
}: {
  config: OpenClawConfig;
  snapshot: PluginMetadataSnapshot;
}): NonNullable<ModelsListResult["decisionTasks"]> {
  const tasks: NonNullable<ModelsListResult["decisionTasks"]> = [
    {
      id: "core/tool-prefilter",
      owner: "core",
      name: "Conversational tool prefilter",
      description:
        "Decides whether a conversational turn can proceed without tools when Decision assistance is enabled.",
    },
    {
      id: "core/decision-evaluate",
      owner: "core",
      name: "Explicit Decision evaluation",
      description: "Evaluates a supplied Decision batch through the decision_evaluate tool.",
    },
  ];
  if (config.plugins?.enabled === false) {
    return tasks;
  }
  const isEnabled = createInstalledPluginEnabledPredicate(snapshot.index.plugins, config);
  for (const plugin of snapshot.plugins) {
    if (
      !isEnabled(plugin.id) ||
      !isManifestPluginAvailableForControlPlane({ snapshot, plugin, config })
    ) {
      continue;
    }
    for (const task of plugin.decisionTasks ?? []) {
      tasks.push({ ...task, owner: plugin.id });
    }
  }
  return tasks;
}

export function createModelsListProviderFilter(params: {
  config: OpenClawConfig;
  metadataSnapshot: PluginMetadataSnapshot;
  catalog: readonly { provider: string }[];
  provider?: string;
}) {
  const { config, metadataSnapshot, catalog } = params;
  const normalizeProvider = createPreparedModelCatalogProviderNormalizer(metadataSnapshot, config);
  const providerFilter = params.provider ? normalizeProvider(params.provider) : undefined;
  if (providerFilter) {
    const decisionProviderIds = (
      metadataSnapshot.owners.contracts.get("decisionProviders") ?? []
    ).flatMap(
      (pluginId) => metadataSnapshot.byPluginId.get(pluginId)?.contracts?.decisionProviders ?? [],
    );
    const knownProviders = new Set(
      [
        ...metadataSnapshot.owners.providers.keys(),
        ...metadataSnapshot.owners.modelCatalogProviders.keys(),
        ...decisionProviderIds,
        ...Object.keys(config.models?.providers ?? {}),
        ...catalog.map((entry) => entry.provider),
      ].map(normalizeProvider),
    );
    if (!knownProviders.has(providerFilter)) {
      throw new UnknownModelCatalogProviderError(
        `Unknown model catalog provider ${JSON.stringify(params.provider)}. Run openclaw models list --all to list models and their provider IDs.`,
      );
    }
  }
  return {
    normalizeProvider,
    providerFilter,
    matchesProvider: (entry: { provider: string }) =>
      !providerFilter || normalizeProvider(entry.provider) === providerFilter,
  };
}
