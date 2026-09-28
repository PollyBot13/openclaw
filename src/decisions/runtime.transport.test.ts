import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, onTestFinished } from "vitest";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { runPluginRegisterSyncInRegistry } from "../plugins/loader-module-runtime.js";
import { createPluginRecord } from "../plugins/loader-records.js";
import { getPluginInstance } from "../plugins/plugin-instance-scope.js";
import { createTestPluginRegistry } from "../plugins/registry-runtime.test-helpers.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../plugins/runtime.js";
import { evaluateDecisionInRegistry, prepareDecisionProviderReload } from "./runtime.js";
import type { DecisionBatch, DecisionProviderV1, ProviderDecisionOutcome } from "./types.js";

const batch: DecisionBatch = {
  state: { evidence: "synthetic" },
  questions: {
    pick: { type: "choice", criteria: { yes: "supported", unclear: "not established" } },
    rank: { type: "score", criteria: ["low", "middle", "high"] },
    truth: { type: "boolean" },
  },
};
const answer = {
  status: "ok",
  result: {
    model: "fixture-v1",
    answers: {
      pick: { type: "choice", choice: "yes", probabilities: { yes: 0.8, unclear: 0.2 } },
      rank: { type: "score", score: 1.3, probabilities: [0.1, 0.5, 0.4] },
      truth: { type: "boolean", probabilityTrue: 0.7 },
    },
    usage: { inputTokens: 25, outputTokens: 4 },
  },
} satisfies ProviderDecisionOutcome;
const options = () => ({
  purpose: "test",
  rubricVersion: "1",
  timeoutMs: 1_000,
  signal: new AbortController().signal,
});

afterEach(() => {
  resetPluginRuntimeStateForTest();
  clearRuntimeConfigSnapshot();
});

it.each(["", "fixture/check-v2"] as const)(
  "does not send a provider request after task selection changes during Gateway authority preparation (%j)",
  async (nextModel) => {
    const requests: Array<{ model: string; state: DecisionBatch["state"] }> = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        requests.push(JSON.parse(body) as { model: string; state: DecisionBatch["state"] });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(answer));
      });
    });
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    onTestFinished(async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    });
    const address = server.address() as AddressInfo;
    const provider: DecisionProviderV1 = {
      id: "fixture",
      contractVersion: 1,
      async evaluate(_batch, { model }) {
        const response = await fetch(`http://127.0.0.1:${address.port}/decision`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, state: batch.state }),
        });
        return (await response.json()) as ProviderDecisionOutcome;
      },
    };
    const builder = createTestPluginRegistry();
    const record = createPluginRecord({
      id: "owner",
      source: "/synthetic/index.ts",
      origin: "global",
      enabled: true,
      configSchema: false,
      contracts: { decisionProviders: ["fixture"] },
    });
    const api = builder.createApi(record, { config: {} });
    runPluginRegisterSyncInRegistry(
      (registration) => registration.registerDecisionProvider(provider),
      api,
      builder.registry,
      record.id,
    );
    builder.registry.plugins.push(record);
    setActivePluginRegistry(builder.registry);
    onTestFinished(async () => {
      prepareDecisionProviderReload(builder.registry, new Set([record.id]));
      await getPluginInstance(record)?.dispose();
    });
    const selected: OpenClawConfig = {
      agents: { defaults: { decisionModelsByTask: { "owner/check": "fixture/check-v1" } } },
    };
    const run = () =>
      evaluateDecisionInRegistry(
        batch,
        { ...options(), taskId: "owner/check" },
        builder.registry,
        selected,
        "owner",
      );

    setRuntimeConfigSnapshot(selected);
    expect(await run()).toMatchObject({ status: "ok" });
    expect(requests).toEqual([{ model: "check-v1", state: batch.state }]);

    setRuntimeConfigSnapshot(selected);
    const pending = run();
    // Ambient authority preparation always yields; publish the new selection in that gap.
    setRuntimeConfigSnapshot({
      agents: { defaults: { decisionModelsByTask: { "owner/check": nextModel } } },
    });

    expect(await pending).toEqual({ status: "unavailable", reason: "retiring" });
    expect(requests).toHaveLength(1);
    expect(builder.registry.decisionProviders[0]!.host.inspect(selected)).toMatchObject({
      successCount: 1,
      activeRequests: 0,
    });
  },
);
