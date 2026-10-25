import { stat } from "node:fs/promises";
import path from "node:path";
import { rawDataToString } from "@openclaw/gateway-client/websocket-data";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { getRuntimeConfig, setRuntimeConfigSnapshot } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { getDecisionFlightRecorder } from "../decisions/flight-recorder.js";
import * as sqliteWorkerStore from "../infra/sqlite-worker-store.js";
import { createDeferredCore } from "../shared/deferred.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { issueOperatorToken, openTrackedWs } from "./device-authz.test-helpers.js";
import { connectOk, installGatewayTestHooks, rpcReq, startServer } from "./test-helpers.js";

const privateInput = "SYNTHETIC PRIVATE RECORDER AUTHORITY FIXTURE";
let started: Awaited<ReturnType<typeof startServer>>;
const sockets = new Set<WebSocket>();
installGatewayTestHooks({
  scope: "suite",
  setup: async () => {
    started = await startServer("synthetic-recorder-gateway-token");
  },
  cleanup: async () => {
    await started.server.close();
    started.envSnapshot.restore();
  },
});
beforeEach(() => {
  setRuntimeConfigSnapshot({
    ...getRuntimeConfig(),
    decisionRecorder: { enabled: true, maxBytes: 2 * 1024 * 1024, fullInputWindowMs: 60_000 },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const ws of sockets) {
    ws.close();
  }
  sockets.clear();
  const owner = getDecisionFlightRecorder();
  await owner.delete();
  await owner.close();
});

async function client(name: string, scopes = ["operator.admin"]) {
  const device = await issueOperatorToken({
    name,
    approvedScopes: scopes,
    clientId: GATEWAY_CLIENT_NAMES.TEST,
    clientMode: GATEWAY_CLIENT_MODES.TEST,
  });
  const ws = await openTrackedWs(started.port);
  sockets.add(ws);
  await connectOk(ws, {
    skipDefaultAuth: true,
    deviceToken: device.token,
    deviceIdentityPath: device.identityPath,
    scopes,
  });
  return { ws, deviceId: device.deviceId };
}

async function seed() {
  const owner = getDecisionFlightRecorder();
  owner.window("start");
  owner.begin(
    { formatVersion: 1, version: 1, purpose: "gateway-authority-proof", rubricVersion: "1" },
    { state: privateInput, questions: { truth: { type: "boolean" } } },
  )?.({ status: "unavailable", reason: "disabled" });
  const pool = await owner.list();
  expect(pool.recordCount).toBe(1);
  expect(pool.records[0]?.input.completeness).toBe("complete");
  return { ids: pool.records.map((record) => record.id), format: "json" as const, preview: false };
}

it("exports real private SQLite records only to admin WebSocket callers", async () => {
  const params = await seed();
  const admin = await client("recorder-admin");
  const reader = await client("recorder-reader", ["operator.read"]);
  const allowed = await rpcReq<{ content: string; recordCount: number }>(
    admin.ws,
    "decisionRecorder.export",
    params,
  );
  expect(allowed.ok).toBe(true);
  expect(allowed.payload?.recordCount).toBe(1);
  expect(allowed.payload?.content).toContain(privateInput);
  const denied = await rpcReq(reader.ws, "decisionRecorder.export", params);
  expect(denied).toMatchObject({
    ok: false,
    error: { message: "missing scope: operator.admin" },
  });
  expect(JSON.stringify(denied)).not.toContain(privateInput);
  expect(await rpcReq(reader.ws, "decisionRecorder.delete", {})).toMatchObject({ ok: false });
  expect((await getDecisionFlightRecorder().list()).recordCount).toBe(1);
});

it("withholds an awaited real export and preserves a pool when its queued deleter is revoked", async ({
  signal,
}) => {
  const exported = createDeferredCore();
  const release = createDeferredCore();
  const resume = () => release.resolve();
  signal.addEventListener("abort", resume, { once: true });
  const originalOpen = sqliteWorkerStore.openSqliteWorkerStore;
  // Delay delivery, not execution: the actual SQLite worker creates the private export.
  // Its pending result holds the recorder FIFO so deletion is genuinely queued.
  vi.spyOn(sqliteWorkerStore, "openSqliteWorkerStore").mockImplementation(async (...args) => {
    const store = await originalOpen(...args);
    if (store && args[0].databasePath.endsWith("decision-recorder/pool.sqlite")) {
      const execute = store.execute.bind(store);
      vi.spyOn(store, "execute").mockImplementation(async (command, options) => {
        const result = await execute(command, options);
        if (command.type === "export") {
          exported.resolve();
          await release.promise;
        }
        return result;
      });
    }
    return store;
  });
  const params = await seed();
  const requester = await client("recorder-revoked-admin");
  const revoker = await client("recorder-revoker");
  const frames: string[] = [];
  requester.ws.on("message", (data) => frames.push(rawDataToString(data)));
  const closed = new Promise<number>((resolve) => {
    requester.ws.once("close", resolve);
  });
  const owner = getDecisionFlightRecorder();
  const exportCall = vi.spyOn(owner, "export");
  const deletionQueued = createDeferredCore();
  const remove = owner.delete.bind(owner);
  const deleteCall = vi.spyOn(owner, "delete").mockImplementation((...args) => {
    const pending = remove(...args);
    deletionQueued.resolve();
    return pending;
  });
  let deletion: Promise<unknown> | undefined;
  try {
    requester.ws.send(
      JSON.stringify({
        type: "req",
        id: "private-export",
        method: "decisionRecorder.export",
        params,
      }),
    );
    await exported.promise;
    requester.ws.send(
      JSON.stringify({
        type: "req",
        id: "queued-delete",
        method: "decisionRecorder.delete",
        params: {},
      }),
    );
    await deletionQueued.promise;
    deletion = deleteCall.mock.results[0]?.value;
    // Observe rejection before releasing the queue; no abandoned rejected promise.
    const deletionRejected = expect(deletion).rejects.toThrow();
    const revoked = await rpcReq(revoker.ws, "device.token.revoke", {
      deviceId: requester.deviceId,
      role: "operator",
    });
    expect(revoked.ok).toBe(true);
    expect(await closed).toBe(4001);
    release.resolve();
    await deletionRejected;
    const actualExport = await exportCall.mock.results[0]?.value;
    expect(actualExport?.content).toContain(privateInput);
    const pool = await rpcReq<{ recordCount: number }>(revoker.ws, "decisionRecorder.status", {});
    expect(pool).toMatchObject({ ok: true, payload: { recordCount: 1 } });
    expect(
      (await stat(path.join(resolveStateDir(), "decision-recorder/pool.sqlite"))).size,
    ).toBeGreaterThan(0);
    expect(frames.join("\n")).not.toContain(privateInput);
    expect(
      frames.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "res"),
    ).toEqual([]);
  } finally {
    release.resolve();
    await Promise.allSettled([deletion, ...exportCall.mock.results.map((result) => result.value)]);
    signal.removeEventListener("abort", resume);
  }
});
