import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { runPluginRegisterSyncInRegistry } from "../plugins/loader-module-runtime.js";
import { createPluginRecord } from "../plugins/loader-records.js";
import { resetPluginRuntimeStateForTest } from "../plugins/runtime.js";
import { evaluateDecisionInRegistry } from "./runtime.js";
import { answer, batch, config, options, registered } from "./runtime.test-support.js";
import { CORE_DECISION_TASKS } from "./task-ids.js";
import type { DecisionProviderV1 } from "./types.js";

afterEach(() => {
  resetPluginRuntimeStateForTest();
  clearRuntimeConfigSnapshot();
  vi.unstubAllGlobals();
});

describe("Decision task routing", () => {
  it("routes two core tasks to different host-owned providers without changing the scalar default", async () => {
    const primary = vi.fn<DecisionProviderV1["evaluate"]>(async () => answer);
    const alternate = vi.fn<DecisionProviderV1["evaluate"]>(async () => answer);
    const host = registered(primary);
    const routed: OpenClawConfig = {
      agents: { defaults: { decisionModel: "fixture/fixture-v1" } },
      plugins: {
        entries: {
          router: {
            enabled: true,
            config: { byTask: { [CORE_DECISION_TASKS.toolPrefilter]: "alternate/fast" } },
          },
        },
      },
    };
    const other = createPluginRecord({
      id: "other-provider",
      source: "/synthetic/alternate.ts",
      origin: "global",
      enabled: true,
      configSchema: false,
      contracts: { decisionProviders: ["alternate"] },
    });
    runPluginRegisterSyncInRegistry(
      (api) =>
        api.registerDecisionProvider({ id: "alternate", contractVersion: 1, evaluate: alternate }),
      host.createApi(other, { config: routed }),
      host.registry,
      other.id,
    );
    host.registry.plugins.push(other);
    host.registry.plugins.push(
      createPluginRecord({
        id: "router",
        source: "/synthetic/router.ts",
        origin: "global",
        enabled: true,
        configSchema: true,
        decisionRouter: { configMapProperty: "byTask" },
      }),
    );
    setRuntimeConfigSnapshot(routed);
    const selected = await evaluateDecisionInRegistry(
      batch,
      { ...options(), taskId: CORE_DECISION_TASKS.toolPrefilter },
      host.registry,
      routed,
    );
    const inherited = await evaluateDecisionInRegistry(
      batch,
      { ...options(), taskId: CORE_DECISION_TASKS.decisionEvaluate },
      host.registry,
      routed,
    );
    expect(selected).toMatchObject({ status: "ok", provenance: { providerId: "alternate" } });
    expect(inherited).toMatchObject({ status: "ok", provenance: { providerId: "fixture" } });
    expect(alternate.mock.calls[0]?.[1].model).toBe("fast");
    expect(primary.mock.calls[0]?.[1].model).toBe("fixture-v1");
  });

  it("does not dispatch a task switched off during operator preparation", async () => {
    const evaluate = vi.fn<DecisionProviderV1["evaluate"]>(async () => answer);
    const host = registered(evaluate);
    host.registry.plugins.push(
      createPluginRecord({
        id: "router",
        source: "/synthetic/router.ts",
        origin: "global",
        enabled: true,
        configSchema: true,
        decisionRouter: { configMapProperty: "byTask" },
      }),
    );
    const routed: OpenClawConfig = {
      agents: { defaults: { decisionModel: "fixture/default" } },
      plugins: {
        entries: {
          router: {
            enabled: true,
            config: {
              byTask: {
                [CORE_DECISION_TASKS.decisionEvaluate]: "fixture/override",
              },
            },
          },
        },
      },
    };
    setRuntimeConfigSnapshot(routed);
    const pending = evaluateDecisionInRegistry(
      batch,
      { ...options(), taskId: CORE_DECISION_TASKS.decisionEvaluate },
      host.registry,
      routed,
    );
    setRuntimeConfigSnapshot({
      ...routed,
      plugins: {
        entries: {
          router: {
            enabled: true,
            config: {
              byTask: {
                [CORE_DECISION_TASKS.decisionEvaluate]: { off: true },
              },
            },
          },
        },
      },
    });
    expect(await pending).toEqual({ status: "unavailable", reason: "retiring" });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it.each(["unchanged", "off", "reassigned"] as const)(
    "guards the final provider request when a task is %s during provider preparation",
    async (change) => {
      const request = vi.fn(async () => new Response("synthetic"));
      vi.stubGlobal("fetch", request);
      let releasePreparation!: () => void;
      const preparation = new Promise<void>((resolve) => {
        releasePreparation = resolve;
      });
      let guardChecked!: (admitted: boolean) => void;
      const firstGuard = new Promise<boolean>((resolve) => {
        guardChecked = resolve;
      });
      let releaseCleanup!: () => void;
      const cleanup = new Promise<void>((resolve) => {
        releaseCleanup = resolve;
      });
      const host = registered(async (_batch, context) => {
        await preparation;
        guardChecked(context.isAdmissible?.() ?? true);
        await cleanup;
        // A transport's final I/O fence must reject even if the task is restored
        // during cleanup. An absent guard would permit this old-destination POST.
        if (context.isAdmissible?.() ?? true) {
          await fetch("https://old-destination.example/v1/decision", { method: "POST" });
        }
        return answer;
      });
      host.registry.plugins.push(
        createPluginRecord({
          id: "router",
          source: "/synthetic/router.ts",
          origin: "global",
          enabled: true,
          configSchema: true,
          decisionRouter: { configMapProperty: "byTask" },
        }),
      );
      const routed: OpenClawConfig = {
        agents: { defaults: { decisionModel: "fixture/default" } },
        plugins: {
          entries: {
            router: {
              enabled: true,
              config: { byTask: { [CORE_DECISION_TASKS.decisionEvaluate]: "fixture/old" } },
            },
          },
        },
      };
      setRuntimeConfigSnapshot(routed);
      const pending = evaluateDecisionInRegistry(
        batch,
        { ...options(), timeoutMs: 5_000, taskId: CORE_DECISION_TASKS.decisionEvaluate },
        host.registry,
        routed,
      );
      await host.started;
      if (change !== "unchanged") {
        const next = structuredClone(routed);
        next.plugins!.entries!.router!.config = {
          byTask: {
            [CORE_DECISION_TASKS.decisionEvaluate]:
              change === "off" ? { off: true } : "fixture/new",
          },
        };
        setRuntimeConfigSnapshot(next);
      }
      releasePreparation();
      expect(await firstGuard).toBe(change === "unchanged");
      if (change === "off") {
        setRuntimeConfigSnapshot(routed);
      }
      releaseCleanup();
      if (change === "unchanged") {
        expect(await pending).toMatchObject({ status: "ok" });
        expect(request).toHaveBeenCalledExactlyOnceWith(
          "https://old-destination.example/v1/decision",
          { method: "POST" },
        );
      } else {
        expect(await pending).toEqual({ status: "unavailable", reason: "retiring" });
        expect(request).not.toHaveBeenCalled();
      }
      expect(host.registry.decisionProviders[0]!.host.inspect(routed)).toMatchObject({
        activeRequests: 0,
        successCount: change === "unchanged" ? 1 : 0,
      });
    },
  );

  it("rejects a plugin impersonating a core task", async () => {
    const host = registered();
    await expect(
      evaluateDecisionInRegistry(
        batch,
        { ...options(), taskId: CORE_DECISION_TASKS.toolPrefilter },
        host.registry,
        config,
        host.record.id,
      ),
    ).rejects.toThrow("Invalid decision contract");
  });

  it("accepts only a loaded plugin's declared task", async () => {
    const evaluate = vi.fn<DecisionProviderV1["evaluate"]>(async () => answer);
    const host = registered(evaluate);
    const consumer = createPluginRecord({
      id: "task-consumer",
      source: "/synthetic/task-consumer.ts",
      origin: "global",
      enabled: true,
      configSchema: true,
      decisionTasks: [
        { id: "task-consumer/check", name: "Check", description: "Declared Decision task" },
      ],
    });
    runPluginRegisterSyncInRegistry(
      () => {},
      host.createApi(consumer, { config }),
      host.registry,
      consumer.id,
    );
    host.registry.plugins.push(consumer);
    setRuntimeConfigSnapshot(config);
    expect(
      await evaluateDecisionInRegistry(
        batch,
        { ...options(), taskId: "task-consumer/check" },
        host.registry,
        config,
        consumer.id,
      ),
    ).toMatchObject({ status: "ok", provenance: { providerId: "fixture" } });
    expect(evaluate).toHaveBeenCalledOnce();
    await expect(
      evaluateDecisionInRegistry(
        batch,
        { ...options(), taskId: "task-consumer/undeclared" },
        host.registry,
        config,
        consumer.id,
      ),
    ).rejects.toThrow("Invalid decision contract");
    await expect(
      evaluateDecisionInRegistry(
        batch,
        { ...options(), taskId: "task-consumer/check", candidateModel: "fixture/candidate" },
        host.registry,
        config,
        consumer.id,
      ),
    ).rejects.toThrow("Invalid decision contract");
  });
});
