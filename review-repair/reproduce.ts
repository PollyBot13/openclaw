import assert from "node:assert/strict";
import { randomUUID, X509Certificate, createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
const repo = process.cwd();
const mode = process.env.PROOF_MODE ?? "local";
const token = randomUUID();
const out = path.join(repo, ".qa-artifacts", "answer-lens", "authority-proof", "output");
await fs.mkdir(out, { recursive: true });
const sourceHash = createHash("sha256")
  .update(await fs.readFile(repo + "/src/gateway/server-methods/chat-answer-transform.ts"))
  .digest("hex");
const state = await fs.mkdtemp(out + "/state-");
Object.assign(process.env, {
  OPENCLAW_STATE_DIR: state,
  OPENCLAW_CONFIG_PATH: state + "/openclaw.json",
  OPENCLAW_TMP_DIR: state + "/tmp",
  OPENCLAW_SKIP_BROWSER_CONTROL_SERVER: "1",
  OPENCLAW_SKIP_CANVAS_HOST: "1",
  OPENCLAW_SKIP_CHANNELS: "1",
  OPENCLAW_SKIP_CRON: "1",
  OPENCLAW_SKIP_GMAIL_WATCHER: "1",
  OPENCLAW_SKIP_PROVIDERS: "1",
  OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
  OPENCLAW_DISABLE_BONJOUR: "1",
});
for (const key of [
  "OPENCLAW_GATEWAY_TOKEN",
  "OPENCLAW_GATEWAY_PASSWORD",
  "OPENCLAW_TEST_MINIMAL_GATEWAY",
])
  delete process.env[key];
await fs.mkdir(state + "/workspace", { recursive: true });
const { TEST_TLS_CERT_PEM, TEST_TLS_KEY_PEM } =
  await import("../../../test/helpers/tls-fixture.js");
const { writeOpenAiResponsesText } = await import("../../../test/helpers/openai-responses-sse.js");
await fs.writeFile(state + "/cert.pem", TEST_TLS_CERT_PEM);
await fs.writeFile(state + "/key.pem", TEST_TLS_KEY_PEM, { mode: 0o600 });
const requests: any[] = [];
let prepHold:
  | {
      entered: ReturnType<typeof Promise.withResolvers<void>>;
      release: ReturnType<typeof Promise.withResolvers<void>>;
    }
  | undefined;
let hold:
  | {
      entered: ReturnType<typeof Promise.withResolvers<void>>;
      release: ReturnType<typeof Promise.withResolvers<void>>;
    }
  | undefined;
const provider = createServer((req, res) => {
  void (async () => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, body: JSON.parse(body) });
    const h = hold;
    h?.entered.resolve();
    if (h) await h.release.promise;
    writeOpenAiResponsesText(res, {
      text: "A catalyst makes a reaction faster without changing its final balance.",
      messageId: "msg_" + randomUUID(),
      responseId: "resp_" + randomUUID(),
    });
  })().catch((e) => {
    console.error("provider", String(e));
    res.end();
  });
});
await new Promise<void>((r) => provider.listen(8887, "127.0.0.1", r));
const scopes = ["operator.read", "operator.write"];
const users = ["owner@proof.example.test", "observer@proof.example.test"];
const modelRef = "proof/answer-lens";
const cfg = {
  agents: {
    ownership: "explicit",
    defaults: {
      workspace: state + "/workspace",
      skipBootstrap: true,
      model: { primary: modelRef },
      utilityModel: { primary: modelRef },
      models: {
        [modelRef]: {
          agentRuntime: { id: "openclaw" },
          params: { transport: "sse", openaiWsWarmup: false },
        },
      },
    },
    entries: { main: {} },
  },
  models: {
    mode: "replace",
    providers: {
      proof: {
        baseUrl: "http://127.0.0.1:8887/v1",
        apiKey: "synthetic-proof-key",
        api: "openai-responses",
        request: { allowPrivateNetwork: true },
        models: [
          {
            id: "answer-lens",
            name: "Answer Lens proof fixture",
            api: "openai-responses",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          },
        ],
      },
    },
  },
  plugins: { enabled: false, slots: { memory: "none" } },
  tools: { deny: ["*"] },
  gateway: {
    mode: "local",
    bind: "loopback",
    port: 8886,
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-forwarded-user",
        requiredHeaders: ["x-forwarded-proto"],
        allowUsers: users,
        allowLoopback: true,
        deviceAutoApprove: { enabled: true, scopes },
      },
    },
    trustedProxies: ["127.0.0.1"],
    controlUi: { enabled: false, allowedOrigins: ["https://proof.example.test"] },
    tls: {
      enabled: true,
      autoGenerate: false,
      certPath: state + "/cert.pem",
      keyPath: state + "/key.pem",
    },
    roles: {
      default: "viewer",
      definitions: { viewer: { sessions: { others: "view" }, agents: "*", scopes } },
    },
  },
  cron: { enabled: false },
  discovery: { mdns: { mode: "off" } },
  browser: { enabled: false },
};
if (mode === "local") {
  cfg.gateway.auth = { mode: "token", token } as any;
  delete (cfg.gateway as any).roles;
}
await fs.writeFile(process.env.OPENCLAW_CONFIG_PATH!, JSON.stringify(cfg), { mode: 0o600 });
if (mode === "member") {
  const { ensureProfileForEmail } = await import("../../../src/state/user-profiles.js");
  const { setUserProfileRole } = await import("../../../src/state/user-profile-writes.worker.js");
  for (const email of users) await setUserProfileRole(ensureProfileForEmail(email).id, "viewer");
}
const { mock } = await import("node:test");
const utility = await import("../../../src/agents/utility-completion.js");
mock.module(new URL("../../../src/agents/utility-completion.ts", import.meta.url), {
  namedExports: {
    ...utility,
    prepareUtilityCompletionForAgent: async (
      ...args: Parameters<typeof utility.prepareUtilityCompletionForAgent>
    ) => {
      const result = await utility.prepareUtilityCompletionForAgent(...args);
      const barrier = prepHold;
      barrier?.entered.resolve();
      if (barrier) await barrier.release.promise;
      return result;
    },
  },
});
const { startGatewayServer } = await import("../../../src/gateway/server.js");
const { GatewayClient } = await import("../../../src/gateway/client.js");
const { loadOrCreateDeviceIdentity } = await import("../../../src/infra/device-identity.js");
const server = await startGatewayServer(8886, { bind: "loopback", controlUiEnabled: false });
await server.startupSettled;
const clients: any[] = [];
const events: any[][] = [[], []];
async function connect(index: number) {
  return await new Promise<any>((resolve, reject) => {
    const c = new GatewayClient({
      url: "wss://127.0.0.1:8886",
      clientName: "openclaw-control-ui",
      mode: "webchat",
      origin: "https://proof.example.test",
      tlsFingerprint: new X509Certificate(TEST_TLS_CERT_PEM).fingerprint256,
      scopes,
      deviceIdentity: loadOrCreateDeviceIdentity({
        path: state + "/device-" + index + "/client/credentials.sqlite",
      }),
      ...(mode === "local"
        ? { token, clientName: "cli", mode: "cli", deviceIdentity: null, origin: undefined }
        : {
            edgeAuthHeaders: {
              "x-forwarded-for": "203.0.113." + (50 + index),
              "x-forwarded-proto": "https",
              "x-forwarded-user": users[index],
            },
          }),
      onHelloOk: (hello: any) => {
        assert(!hello.auth?.scopes?.includes("operator.admin"));
        resolve(c);
      },
      onConnectError: reject,
      onEvent: (e) => {
        if (e.event === "chat.answer.delta") events[index].push(e.payload);
      },
    });
    clients.push(c);
    c.start();
  });
}
try {
  const owner = await connect(0);
  const observer = await connect(1);
  const {
    appendTranscriptMessage,
    loadTranscriptEvents,
    replaceSessionEntry,
    patchSessionEntryCore,
  } = await import("../../../src/config/sessions/session-accessor.js");
  const { addSessionMember, removeSessionMember } =
    await import("../../../src/config/sessions/session-sharing-store.js");
  const { memorySessionActorOwners } =
    await import("../../../src/config/sessions/session-actor-memory-owner.js");
  const { resolveIncognitoOpenClawAgentSqlitePath } =
    await import("../../../src/state/openclaw-agent-db.paths.js");
  const profile = (await owner.request("users.self", {})).profile.id;
  async function seed(incognito: boolean, externalOwner = false) {
    const key = "agent:main:dashboard:" + (incognito ? "incognito-" : "") + randomUUID();
    const scope = { agentId: "main", sessionKey: key, sessionId: randomUUID() };
    const entry = {
      sessionId: scope.sessionId,
      updatedAt: Date.now(),
      status: "done",
      visibility: externalOwner ? "read-only" : "draft",
      createdActor: {
        type: "human",
        source: "profile",
        id: externalOwner ? "different-synthetic-owner" : profile,
      },
      ...(incognito ? { incognito: true } : {}),
    };
    if (incognito) {
      const memory = memorySessionActorOwners.get({
        agentId: "main",
        path: resolveIncognitoOpenClawAgentSqlitePath({ agentId: "main" }),
      });
      const actor = await memory.acquire(
        { sessionKey: key, database: memory.identity },
        { assertCurrent() {}, assertReadable() {} },
      );
      await actor.storage!.mutate(
        { type: "session.entry.create", input: { entry } },
        { assertCurrent() {}, authorize() {} },
      );
      await actor.release();
    } else await replaceSessionEntry(scope, entry);
    const answer = await appendTranscriptMessage(scope, {
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [
          {
            type: "text",
            text: "A catalyst lowers the activation energy of a reaction without changing its equilibrium constant. It accelerates the approach to equilibrium, not the equilibrium position.",
          },
        ],
      },
    });
    const params = {
      sessionKey: scope.sessionKey,
      messageId: answer.messageId,
      coverage: "full",
      wording: "original",
      requestId: randomUUID(),
    };
    const original = await owner.request("chat.answer.transform", params);
    return {
      scope,
      params: { ...params, sourceRevision: original.sourceRevision, wording: "plain" },
      original,
    };
  }
  const happy = await seed(mode === "local");
  const before = await loadTranscriptEvents(happy.scope);
  const result = await owner.request("chat.answer.transform", happy.params);
  assert(result.text.includes("catalyst"));
  assert(events[0].length > 0);
  assert.equal(events[1].length, 0);
  assert.deepEqual(await loadTranscriptEvents(happy.scope), before);
  const happyChunks = events[0].length;
  let profiledNonAdminIncognitoDenied: boolean | undefined;
  if (mode === "member") {
    const count = requests.length;
    profiledNonAdminIncognitoDenied = await seed(true).then(
      () => false,
      (e) => {
        assert.equal(e.code, "INVALID_REQUEST");
        return true;
      },
    );
    assert(profiledNonAdminIncognitoDenied);
    assert.equal(requests.length, count);
  }
  const cases: any[] = [];
  for (const stage of ["before-dispatch", "inflight"])
    for (const kind of mode === "local" ? ["incognito-close"] : ["sharing-revoke"]) {
      const f = await seed(kind === "incognito-close", kind === "sharing-revoke");
      if (kind === "sharing-revoke") {
        await addSessionMember(f.scope, {
          identityId: profile,
          addedBy: "different-synthetic-owner",
        });
        await removeSessionMember(f.scope, profile);
        await owner.request("chat.answer.transform", {
          ...f.params,
          wording: "original",
          coverage: "full",
          requestId: randomUUID(),
        });
        await addSessionMember(f.scope, {
          identityId: profile,
          addedBy: "different-synthetic-owner",
        });
      }
      const barrier = {
        entered: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
      };
      if (stage === "before-dispatch") prepHold = barrier;
      else hold = barrier;
      const oldCalls = requests.length,
        oldChunks = events[0].length;
      const operation = owner
        .request("chat.answer.transform", { ...f.params, requestId: randomUUID() })
        .then(
          (v: any) => ({ ok: true, value: v }),
          (e: any) => ({ ok: false, code: e.code, message: e.message }),
        );
      await Promise.race([
        barrier.entered.promise,
        operation.then(() => {
          throw Error("Operation settled before provider hold");
        }),
      ]);
      if (kind === "incognito-close") {
        const memory = memorySessionActorOwners.read({
          agentId: "main",
          path: resolveIncognitoOpenClawAgentSqlitePath({ agentId: "main" }),
        });
        assert(memory);
        memory.closeSession(f.scope.sessionKey);
      } else {
        await removeSessionMember(f.scope, profile);
        await patchSessionEntryCore(f.scope, () => ({ visibility: "draft" }));
      }
      barrier.release.resolve();
      hold = undefined;
      prepHold = undefined;
      const rejected = await operation;
      assert.equal(rejected.ok, false);
      assert.equal(events[0].length, oldChunks);
      assert.equal(events[1].length, 0);
      assert.equal(requests.length, oldCalls + (stage === "inflight" ? 1 : 0));
      const later = await owner
        .request("chat.answer.transform", { ...f.params, requestId: randomUUID() })
        .then(
          () => true,
          () => false,
        );
      assert.equal(later, false);
      assert.equal(requests.length, oldCalls + (stage === "inflight" ? 1 : 0));
      cases.push({
        scenario: kind,
        stage,
        providerCallsDuringOperation: stage === "inflight" ? 1 : 0,
        postRevocationChunks: 0,
        laterRequestDenied: true,
        laterProviderCalls: 0,
        error: rejected,
      });
    }
  const report = {
    boundary:
      "Real isolated Gateway, authenticated TLS WebSocket non-admin clients, real authority/storage/utility/HTTP adapter/broadcaster; local synthetic HTTP SSE provider only",
    sourceSha256: sourceHash,
    mode,
    profiledNonAdminIncognitoDenied,
    ...(mode === "member"
      ? {
          membershipOnlyRemoval:
            "Read authority remains under configured view policy; Original still succeeds before visibility is revoked to draft.",
        }
      : {}),
    happy: {
      sourceKind: mode === "local" ? "incognito" : "durable",
      requesterChunks: happyChunks,
      observerChunks: events[1].length,
      historyUnchanged: true,
    },
    cases,
    providerRequests: requests.length,
    limitations: [
      "No live model semantics claimed. Provider response barriers cover post-dispatch revocation; pre-dispatch uses a wrapper that awaits real utility preparation then pauses its return, without replacing any authority decisions or completion implementation.",
    ],
  };
  await fs.writeFile(out + "/report-" + mode + ".json", JSON.stringify(report, null, 2));
  console.log("AUTHORITY_PROOF", JSON.stringify(report));
} finally {
  hold?.release.resolve();
  prepHold?.release.resolve();
  await Promise.allSettled(clients.map((c) => c.stopAndWait()));
  await server.close({ reason: "authority proof complete" });
  await new Promise<void>((r) => provider.close(() => r()));
}
process.exit(0);
