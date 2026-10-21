// Covers plugin config state normalization and reset behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as bundledChannelCatalog from "../channels/bundled-channel-catalog-read.js";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolvePluginActivationStateShared } from "./config-activation-shared.js";
import {
  createPluginActivationSource,
  normalizePluginsConfig,
  normalizePluginTargetConfig,
  resolveEligibleContextEngineOwnerIds,
  resolveEffectiveEnableState,
  resolveEnableState,
  resolveEffectivePluginActivationState,
  resolveMemorySlotDecision,
  resolveSelectedContextEnginePluginId,
  resolveSelectedContextEnginePluginIdFromConfig,
  withContextEngineOwner,
} from "./config-state.js";

function normalizeVoiceCallEntry(entry: Record<string, unknown>) {
  return normalizePluginsConfig({ entries: { "voice-call": entry } }).entries["voice-call"];
}

type ActivationProvenance = Pick<
  ReturnType<typeof resolveEffectivePluginActivationState>,
  "explicitlyEnabled" | "source" | "reason"
>;

function expectResolvedEnableState(
  params: Parameters<typeof resolveEnableState>,
  expected: ReturnType<typeof resolveEnableState>,
  provenance?: ActivationProvenance,
) {
  expect(resolveEnableState(...params)).toEqual(expected);
  if (provenance) {
    const [id, origin, config, enabledByDefault] = params;
    expect(resolveEffectivePluginActivationState({ id, origin, config, enabledByDefault })).toEqual(
      { enabled: expected.enabled, activated: expected.enabled, ...provenance },
    );
  }
}

function expectNormalizedEnableState(
  [id, origin, config]: [string, "bundled" | "workspace", Record<string, unknown>],
  expected: ReturnType<typeof resolveEnableState>,
  provenance?: ActivationProvenance,
) {
  expectResolvedEnableState([id, origin, normalizePluginsConfig(config)], expected, provenance);
}

function activation(
  enabled: boolean,
  explicitlyEnabled: boolean,
  source: ActivationProvenance["source"],
  reason: string | undefined,
) {
  return { enabled, activated: enabled, explicitlyEnabled, source, reason };
}

const hookPolicy = {
  allowPromptInjection: false,
  allowConversationAccess: true,
  timeoutMs: 250,
  timeouts: { before_prompt_build: 90_000, agent_end: 60_000 },
};

describe("normalizePluginsConfig", () => {
  afterEach(() => clearRuntimeConfigSnapshot());

  it("serves published policy without rereading entries and refreshes every publication", () => {
    const entries = { "google-gemini-cli": { enabled: true } };
    const readEntries = vi.fn(() => entries);
    const config: OpenClawConfig = {
      plugins: {
        get entries() {
          return readEntries();
        },
      },
    };
    setRuntimeConfigSnapshot(config);
    readEntries.mockClear();

    expect(normalizePluginsConfig(config.plugins).entries.google?.enabled).toBe(true);
    expect(normalizePluginsConfig(config.plugins).entries.google?.enabled).toBe(true);
    expect(readEntries).not.toHaveBeenCalled();

    entries["google-gemini-cli"].enabled = false;
    setRuntimeConfigSnapshot(config);
    expect(normalizePluginsConfig(config.plugins).entries.google?.enabled).toBe(false);

    const replacement = { plugins: { allow: ["replacement"] } };
    setRuntimeConfigSnapshot(replacement);
    expect(normalizePluginsConfig(replacement.plugins).allow).toEqual(["replacement"]);
    clearRuntimeConfigSnapshot();
    replacement.plugins.allow.push("unpublished-edit");
    expect(normalizePluginsConfig(replacement.plugins).allow).toEqual([
      "replacement",
      "unpublished-edit",
    ]);
  });

  it("keeps targeted authored plugin state identical across JSON persistence", () => {
    const normalized = normalizePluginTargetConfig(
      { plugins: { entries: { CODEX: { enabled: true, config: { appServer: {} } } } } },
      "codex",
    );
    const persistedJson = JSON.stringify(normalized);
    expect(JSON.parse(persistedJson)).toStrictEqual(normalized);
    expect(normalized.plugins?.entries?.codex).toEqual({
      enabled: true,
      config: { appServer: {} },
    });
  });
  it.each([
    [{}, undefined],
    [{ slots: { contextEngine: "none" } }, null],
    [{ slots: { contextEngine: "  cortex  " } }, "cortex"],
    [{ slots: { contextEngine: "" } }, undefined],
  ] as const)("preserves contextEngine slot for %o (#64170)", (config, expected) => {
    expect(normalizePluginsConfig(config).slots.contextEngine).toBe(expected);
  });

  it.each([
    {
      name: "normalizes plugin hook policy flags",
      entry: {
        hooks: hookPolicy,
      },
      expectedHooks: {
        allowPromptInjection: false,
        allowConversationAccess: true,
        timeoutMs: 250,
        timeouts: { before_prompt_build: 90_000, agent_end: 60_000 },
      },
    },
    {
      name: "drops invalid plugin hook policy values",
      entry: {
        hooks: {
          allowPromptInjection: "nope",
          allowConversationAccess: "nope",
          timeoutMs: 0,
          timeouts: {
            before_prompt_build: 900_000,
          },
        } as unknown as { allowPromptInjection: boolean; allowConversationAccess: boolean },
      },
      expectedHooks: undefined,
    },
  ] as const)("$name", ({ entry, expectedHooks }) => {
    expect(normalizeVoiceCallEntry(entry)?.hooks).toEqual(expectedHooks);
  });

  it.each([
    {
      name: "normalizes plugin subagent override policy settings",
      subagent: {
        allowModelOverride: true,
        allowedModels: [" anthropic/claude-sonnet-4-6 ", "", "openai/gpt-5.5"],
      },
      expected: {
        allowModelOverride: true,
        hasAllowedModelsConfig: true,
        allowedModels: ["anthropic/claude-sonnet-4-6", "openai/gpt-5.5"],
      },
    },
    {
      name: "preserves explicit subagent allowlist intent even when all entries are invalid",
      subagent: {
        allowModelOverride: true,
        allowedModels: [42, null, "anthropic"],
      } as unknown as { allowModelOverride: boolean; allowedModels: string[] },
      expected: {
        allowModelOverride: true,
        hasAllowedModelsConfig: true,
        allowedModels: ["anthropic"],
      },
    },
    {
      name: "keeps explicit invalid subagent allowlist config visible to callers",
      subagent: {
        allowModelOverride: "nope",
        allowedModels: [42, null],
      } as unknown as { allowModelOverride: boolean; allowedModels: string[] },
      expected: {
        hasAllowedModelsConfig: true,
      },
    },
  ] as const)("$name", ({ subagent, expected }) => {
    expect(normalizeVoiceCallEntry({ subagent })?.subagent).toEqual(expected);
  });

  it("normalizes plugin llm override policy settings", () => {
    expect(
      normalizeVoiceCallEntry({
        llm: {
          allowModelOverride: true,
          allowedModels: [" openai/gpt-5.4 ", "", "anthropic/claude-sonnet-4-6"],
          allowedCompletionModels: [" openai/gpt-5.4 ", "", "google/gemini-3-flash"],
          allowAuthProfileOverride: true,
          allowAgentIdOverride: false,
        },
      })?.llm,
    ).toEqual({
      allowModelOverride: true,
      hasAllowedModelsConfig: true,
      allowedModels: ["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"],
      hasAllowedCompletionModelsConfig: true,
      allowedCompletionModels: ["openai/gpt-5.4", "google/gemini-3-flash"],
      allowAuthProfileOverride: true,
      allowAgentIdOverride: false,
    });
  });
});

it("does not bypass allowlists for non-bundled plugins that reuse a channel id", () => {
  expect(
    resolveEffectiveEnableState({
      id: "telegram",
      origin: "config",
      config: normalizePluginsConfig({ enabled: true, allow: ["browser"] }),
      rootConfig: { channels: { telegram: { enabled: true } } },
    }),
  ).toEqual({ enabled: false, reason: "not in allowlist" });
});

describe("resolveEffectivePluginActivationState", () => {
  type ActivationParams = Parameters<typeof resolveEffectivePluginActivationState>[0];

  it.each([
    { alpha: false, beta: true, pluginEnabled: true, expected: true },
    { alpha: false, beta: undefined, pluginEnabled: true, expected: true },
    // The same-named built-in channel is not owned by these manifest channel IDs.
    { id: "telegram", alpha: false, beta: false, pluginEnabled: true, expected: false },
    { id: "telegram", alpha: undefined, beta: undefined, pluginEnabled: true, expected: true },
  ])(
    "keeps multi-channel activation independent of order: %j",
    ({ id = "multi-channel", alpha, beta, pluginEnabled, expected }) => {
      const rootConfig = {
        plugins: { entries: { [id]: { enabled: pluginEnabled } } },
        channels: {
          alpha: { enabled: alpha },
          beta: { enabled: beta },
          telegram: { enabled: !expected },
        },
      };
      for (const channelIds of [
        ["alpha", "beta"],
        ["beta", "alpha"],
      ]) {
        const params = {
          id,
          origin: "config" as const,
          config: normalizePluginsConfig(rootConfig.plugins),
          rootConfig,
          channelIds,
        };
        for (const resolve of [
          resolveEffectivePluginActivationState,
          resolvePluginActivationStateShared,
        ]) {
          expect(resolve(params)).toMatchObject({ enabled: expected, activated: expected });
        }
      }
    },
  );

  it.each<{
    name: string;
    params: Pick<
      ActivationParams,
      "id" | "origin" | "enabledByDefault" | "autoEnabledReason" | "channelIds"
    >;
    rawConfig?: ActivationParams["rootConfig"];
    effectiveConfig?: ActivationParams["rootConfig"];
    expected: ReturnType<typeof resolveEffectivePluginActivationState>;
  }>([
    {
      name: "distinguishes explicit enablement from auto activation",
      params: { id: "telegram", origin: "bundled", autoEnabledReason: "telegram configured" },
      rawConfig: { channels: { telegram: { botToken: "x" } } },
      effectiveConfig: { channels: { telegram: { botToken: "x", enabled: true } } },
      expected: activation(true, false, "auto", "telegram configured"),
    },
    {
      name: "preserves explicit selection even when plugins are globally disabled",
      params: { id: "browser", origin: "bundled" },
      rawConfig: { plugins: { enabled: false, entries: { browser: { enabled: true } } } },
      expected: activation(false, true, "disabled", "plugins disabled"),
    },
    {
      name: "marks bundled default-enabled plugins as default activation",
      params: { id: "openai", origin: "bundled", enabledByDefault: true },
      rawConfig: {},
      expected: activation(true, false, "default", "bundled default enablement"),
    },
    {
      name: "keeps bundled default activation when auto-enable adds an effective entry",
      params: { id: "acpx", origin: "bundled", enabledByDefault: true },
      rawConfig: { acp: { enabled: true } },
      effectiveConfig: {
        acp: { enabled: true },
        plugins: { entries: { acpx: { enabled: true } } },
      },
      expected: activation(true, false, "default", "bundled default enablement"),
    },
    {
      name: "keeps bundled default activation when auto-enable supplies a reason",
      params: {
        id: "acpx",
        origin: "bundled",
        enabledByDefault: true,
        autoEnabledReason: "ACP runtime configured",
      },
      rawConfig: {},
      expected: activation(true, false, "default", "bundled default enablement"),
    },
    {
      name: "keeps allowlists authoritative over explicit bundled plugin enablement",
      params: { id: "telegram", origin: "bundled" },
      rawConfig: { plugins: { allow: ["browser"], entries: { telegram: { enabled: true } } } },
      expected: activation(false, true, "disabled", "not in allowlist"),
    },
    {
      name: "lets explicit bundled channel activation bypass the allowlist",
      params: { id: "telegram", origin: "bundled" },
      rawConfig: {
        channels: { telegram: { enabled: true } },
        plugins: { allow: ["browser"] },
      },
      expected: activation(true, true, "explicit", "channel enabled in config"),
    },
    {
      name: "keeps denylist authoritative over explicit bundled channel activation",
      params: { id: "telegram", origin: "bundled" },
      rawConfig: {
        channels: { telegram: { enabled: true } },
        plugins: { deny: ["telegram"] },
      },
      expected: activation(false, true, "disabled", "blocked by denylist"),
    },
    {
      name: "preserves activation when only the effective config enables a bundled plugin",
      params: { id: "openai", origin: "bundled" },
      rawConfig: { plugins: {} },
      effectiveConfig: { plugins: { entries: { openai: { enabled: true } } } },
      expected: activation(true, false, "auto", "enabled by effective config"),
    },
    {
      name: "marks a channel enabled only in effective config as auto activation without an override reason",
      params: { id: "telegram", origin: "bundled" },
      rawConfig: {},
      effectiveConfig: { channels: { telegram: { enabled: true } } },
      expected: activation(true, false, "auto", "channel configured"),
    },
    {
      name: "resolves an explicit channel disable through manifest-owned channel ids",
      // QQ Bot style: plugin id `openclaw-demo` owns `channels.demo`, which the built-in
      // catalog cannot map from the plugin id alone.
      params: { id: "openclaw-demo", origin: "bundled", channelIds: ["demo"] },
      rawConfig: {
        channels: { demo: { enabled: false } },
        plugins: { entries: { "openclaw-demo": { enabled: true } } },
      },
      expected: activation(false, true, "disabled", "channel disabled in config"),
    },
    {
      name: "keeps a global plugin default-enabled without inventing explicit selection or a reason",
      params: { id: "global-helper", origin: "global" },
      expected: activation(true, false, "default", undefined),
    },
  ])("$name", ({ params, rawConfig, effectiveConfig = rawConfig, expected }) => {
    const catalog = vi.spyOn(bundledChannelCatalog, "listBundledChannelCatalogEntries");
    try {
      expect(
        resolveEffectivePluginActivationState({
          ...params,
          config: normalizePluginsConfig(effectiveConfig ? effectiveConfig.plugins : {}),
          ...(effectiveConfig ? { rootConfig: effectiveConfig } : {}),
          ...(rawConfig
            ? { activationSource: createPluginActivationSource({ config: rawConfig }) }
            : {}),
        }),
      ).toEqual(expected);
      if (!rawConfig?.channels && !effectiveConfig?.channels) {
        expect(catalog).not.toHaveBeenCalled();
      }
    } finally {
      catalog.mockRestore();
    }
  });
});

describe("resolveEnableState", () => {
  it.each([
    [
      "openai",
      "bundled",
      normalizePluginsConfig({}),
      undefined,
      { enabled: false, reason: "bundled (disabled by default)" },
      {
        explicitlyEnabled: false,
        source: "disabled",
        reason: "bundled (disabled by default)",
      },
    ],
    ["openai", "bundled", normalizePluginsConfig({}), true, { enabled: true }],
  ] as const)(
    "resolves %s enable state for origin=%s manifestEnabledByDefault=%s",
    (id, origin, config, manifestEnabledByDefault, expected, provenance?: ActivationProvenance) => {
      expectResolvedEnableState(
        [id, origin, config, manifestEnabledByDefault],
        expected,
        provenance,
      );
    },
  );

  it.each([true, false])("resolves selected memory slot with enabled=%s", (enabled) => {
    expectNormalizedEnableState(
      [
        "memory-core",
        "bundled",
        {
          allow: ["telegram"],
          slots: { memory: "memory-core" },
          ...(enabled ? {} : { entries: { "memory-core": { enabled: false } } }),
        },
      ],
      enabled ? { enabled: true } : { enabled: false, reason: "disabled in config" },
      {
        explicitlyEnabled: true,
        source: enabled ? "explicit" : "disabled",
        reason: enabled ? "selected memory slot" : "disabled in config",
      },
    );
  });

  it.each([
    [
      normalizePluginsConfig({
        allow: ["workspace-helper"],
      }),
      { enabled: true },
      { explicitlyEnabled: true, source: "explicit", reason: "selected in allowlist" },
    ],
    [
      normalizePluginsConfig({ entries: { "workspace-helper": { enabled: true } } }),
      { enabled: true },
      { explicitlyEnabled: true, source: "explicit", reason: "enabled in config" },
    ],
  ] as const)("resolves workspace-helper enable state for %o", (config, expected, provenance) => {
    expectResolvedEnableState(["workspace-helper", "workspace", config], expected, provenance);
  });

  it("does not let the default memory slot auto-enable an untrusted workspace plugin", () => {
    const reason = "workspace plugin (disabled by default)";
    expectNormalizedEnableState(
      ["memory-core", "workspace", { slots: { memory: "memory-core" } }],
      { enabled: false, reason },
      { explicitlyEnabled: true, source: "disabled", reason },
    );
  });

  it("keeps an explicitly selected workspace context engine enabled when omitted from plugins.allow", () => {
    expectNormalizedEnableState(
      [
        "lossless-claw",
        "workspace",
        {
          allow: ["telegram"],
          slots: { contextEngine: "lossless-claw" },
        },
      ],
      { enabled: true },
    );
  });
});

describe("resolveMemorySlotDecision", () => {
  it.each([
    ["memory", "new-memory", { enabled: false }],
    [["memory", "context-engine"], "new-memory", { enabled: true, selected: undefined }],
    [["memory", "context-engine"], "memory-plugin", { enabled: true, selected: true }],
    [["memory", "context-engine"], null, { enabled: true }],
    ["memory", null, { enabled: false }],
  ] as const)("resolves kind=%j slot=%s", (kind, slot, expected) => {
    const result = resolveMemorySlotDecision({
      id: "memory-plugin",
      kind: typeof kind === "string" ? kind : [...kind],
      slot,
      selectedId: null,
    });
    expect({ enabled: result.enabled, selected: result.selected }).toMatchObject(expected);
  });
});

describe("context engine ownership", () => {
  const records = [
    { id: "vendor-plugin", contextEngineIds: ["Canonical-Engine", "second-engine"] },
    { id: "legacy-plugin" },
  ];
  it("resolves exact declared engine IDs and preserves legacy equal-ID selection", () => {
    const resolve = (contextEngine: string) =>
      resolveSelectedContextEnginePluginId(
        {
          plugins: {
            ...(contextEngine !== "legacy-plugin" ? { allow: ["vendor-plugin"] } : {}),
            slots: { contextEngine },
          },
        },
        records,
      );
    expect(resolve("Canonical-Engine")).toBe("vendor-plugin");
    expect(resolve("second-engine")).toBe("vendor-plugin");
    expect(resolve("legacy-plugin")).toBe("legacy-plugin");
    expect(resolve("vendor-plugin")).toBeUndefined();
  });
  it("carries ownership into activation without changing the engine slot", () => {
    const config = withContextEngineOwner(
      normalizePluginsConfig({
        allow: ["vendor-plugin"],
        slots: { contextEngine: "Canonical-Engine" },
      }),
      records,
    );
    expect(config.slots.contextEngine).toBe("Canonical-Engine");
    expect(
      resolveEffectivePluginActivationState({ id: "vendor-plugin", origin: "workspace", config })
        .explicitlyEnabled,
    ).toBe(true);
    expect(
      resolveEffectivePluginActivationState({ id: "Canonical-Engine", origin: "workspace", config })
        .enabled,
    ).toBe(false);
  });
  it("activates a mixed-case equal-ID owner from its canonical policy identity", () => {
    const config = withContextEngineOwner(
      normalizePluginsConfig({
        allow: ["unrelated"],
        slots: { contextEngine: "MiXeD-demo" },
      }),
      [{ id: "MiXeD-demo", contextEngineIds: ["MiXeD-demo"] }],
    );
    expect(config.contextEngineOwnerId).toBe("mixed-demo");
    expect(
      resolveEffectivePluginActivationState({ id: "MiXeD-demo", origin: "workspace", config }),
    ).toMatchObject({ enabled: true, source: "explicit", reason: "selected context engine slot" });
  });
  it.each([
    { name: "default", normalizeId: undefined },
    { name: "exact supplied", normalizeId: (id: string) => id.trim() },
  ])("keeps exact selected owner with $name normalizer", ({ normalizeId }) => {
    const plugins = normalizePluginsConfig({
      allow: ["mixed-demo"],
      slots: { contextEngine: "canonical-engine" },
    });
    const mixedCaseRecords = [{ id: "MiXeD-demo", contextEngineIds: ["canonical-engine"] }];
    expect(
      resolveSelectedContextEnginePluginIdFromConfig(
        plugins,
        "canonical-engine",
        mixedCaseRecords,
        normalizeId,
      ),
    ).toBe("MiXeD-demo");
    expect(
      withContextEngineOwner(plugins, mixedCaseRecords, normalizeId).contextEngineOwnerId,
    ).toBe("mixed-demo");
  });
  it.each([false, true])(
    "retains both exact case-distinct eligible owners before import: declared=%s",
    (declared) => {
      const engineId = declared ? "canonical-engine" : "owner";
      const plugins = normalizePluginsConfig({
        allow: ["owner"],
        slots: { contextEngine: engineId },
      });
      const caseDistinctRecords = ["Owner", "owner"].map((id) =>
        declared ? { id, contextEngineIds: [engineId] } : { id },
      );
      expect(resolveEligibleContextEngineOwnerIds(plugins, engineId, caseDistinctRecords)).toEqual([
        "Owner",
        "owner",
      ]);
    },
  );
  it("does not choose a first owner or a same-named plugin over declared ownership", () => {
    const config = {
      plugins: { allow: ["vendor-plugin"], slots: { contextEngine: "Canonical-Engine" } },
    };
    expect(
      resolveSelectedContextEnginePluginId(config, [...records, { id: "canonical-engine" }]),
    ).toBe("vendor-plugin");
    expect(
      resolveSelectedContextEnginePluginId(config, [
        ...records,
        { id: "other", contextEngineIds: ["Canonical-Engine"] },
      ]),
    ).toBe("vendor-plugin");
    expect(
      resolveSelectedContextEnginePluginId(
        { plugins: { ...config.plugins, allow: ["vendor-plugin", "other"] } },
        [...records, { id: "other", contextEngineIds: ["Canonical-Engine"] }],
      ),
    ).toBeUndefined();
  });
  it("does not fall back to an incidental equal-ID plugin when declared owners are ineligible", () => {
    expect(
      resolveSelectedContextEnginePluginId(
        { plugins: { slots: { contextEngine: "Canonical-Engine" } } },
        [...records, { id: "canonical-engine" }],
      ),
    ).toBeUndefined();
  });
  it.each(["enabled", "allowlisted", "denied", "disabled", "incidental"] as const)(
    "requires independent approval for legacy fallback among ineligible declarations: %s",
    (policy) => {
      const plugins = normalizePluginsConfig({
        slots: { contextEngine: "legacy-plugin" },
        allow: policy === "allowlisted" ? ["legacy-plugin"] : ["unrelated"],
        ...(!["incidental", "allowlisted"].includes(policy)
          ? { entries: { "legacy-plugin": { enabled: policy !== "disabled" } } }
          : {}),
        ...(policy === "denied" ? { deny: ["legacy-plugin"] } : {}),
      });
      const resolved = withContextEngineOwner(plugins, [
        ...records,
        { id: "unapproved", contextEngineIds: ["legacy-plugin"] },
      ]);
      expect(resolved.contextEngineOwnerId).toBe(
        policy === "enabled" || policy === "allowlisted" ? "legacy-plugin" : null,
      );
    },
  );
  it("requires independent trust for a differently named declared owner", () => {
    const config = { plugins: { slots: { contextEngine: "Canonical-Engine" } } };
    expect(resolveSelectedContextEnginePluginId(config, records)).toBeUndefined();
    expect(
      resolveSelectedContextEnginePluginId(
        { plugins: { entries: { "vendor-plugin": { enabled: true } }, ...config.plugins } },
        records,
      ),
    ).toBe("vendor-plugin");
    expect(
      resolveSelectedContextEnginePluginId(
        { plugins: { allow: ["vendor-plugin"], ...config.plugins } },
        records,
      ),
    ).toBe("vendor-plugin");
  });
  it.each([false, true])(
    "preserves equal-ID slot authorization outside an unrelated allowlist: declared=%s",
    (declared) => {
      const config = withContextEngineOwner(
        normalizePluginsConfig({ allow: ["unrelated"], slots: { contextEngine: "legacy-plugin" } }),
        declared ? [{ id: "legacy-plugin", contextEngineIds: ["legacy-plugin"] }] : records,
      );
      expect(config.contextEngineOwnerId).toBe("legacy-plugin");
      expect(
        resolveEffectivePluginActivationState({ id: "legacy-plugin", origin: "workspace", config })
          .enabled,
      ).toBe(true);
    },
  );
  it.each([
    { enabled: false },
    { deny: ["vendor-plugin"] },
    { entries: { "vendor-plugin": { enabled: false } } },
    { allow: ["Canonical-Engine"] },
  ])("applies owner policy %j", (policy) => {
    expect(
      resolveSelectedContextEnginePluginId(
        { plugins: { ...policy, slots: { contextEngine: "Canonical-Engine" } } },
        records,
      ),
    ).toBeUndefined();
  });
});
