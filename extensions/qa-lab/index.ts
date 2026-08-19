// Qa Lab plugin entrypoint registers its OpenClaw integration.
import { setTimeout as sleep } from "node:timers/promises";
// Keep plugin registration independent of private QA transports, which packaged runtimes omit.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { jsonResult } from "openclaw/plugin-sdk/tool-results";
import { registerQaLabCli } from "./src/cli.js";
import { createQaLabWebSearchProvider } from "./src/qa-web-search-provider.js";
import { createStaticSshWorkerProvider } from "./src/static-ssh-worker-provider.js";

const EMPTY_TOOL_PARAMETERS = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const QA_PRE_DISPATCH_STALL_ONCE_MS_ENV = "OPENCLAW_QA_PRE_DISPATCH_STALL_ONCE_MS";
const QA_PRE_DISPATCH_STALL_MARKER_ENV = "OPENCLAW_QA_PRE_DISPATCH_STALL_MARKER";
const stalledQaPreDispatches = new Set<string>();

async function stallQaBeforeDispatchOnce(
  event: { channel?: string; content?: string },
  context: { accountId?: string; conversationId?: string },
) {
  const marker = process.env[QA_PRE_DISPATCH_STALL_MARKER_ENV]?.trim();
  const delayMs = Number(process.env[QA_PRE_DISPATCH_STALL_ONCE_MS_ENV]);
  if (!marker || !event.content?.includes(marker) || !Number.isFinite(delayMs) || delayMs <= 0) {
    return;
  }
  const key = [event.channel, context.accountId, context.conversationId, event.content].join(
    "\u0000",
  );
  if (stalledQaPreDispatches.has(key)) {
    return;
  }
  stalledQaPreDispatches.add(key);
  // Deliberately ignore the ingress abort: the QA scenario verifies that a late
  // first attempt cannot adopt after the watchdog releases its durable claim.
  await sleep(Math.floor(delayMs));
}

export default definePluginEntry({
  id: "qa-lab",
  name: "QA Lab",
  description: "Private QA automation harness and debugger UI",
  register(api) {
    api.on("before_dispatch", stallQaBeforeDispatchOnce);
    api.registerTool(
      {
        name: "qa_restart_wait",
        label: "QA Restart Wait",
        description: "Hold a replay-safe QA call pending until restart aborts the run.",
        parameters: EMPTY_TOOL_PARAMETERS,
        async execute(_toolCallId, _params, signal) {
          await sleep(30_000, undefined, { signal });
          return jsonResult({ status: "released" });
        },
      },
      { name: "qa_restart_wait" },
    );
    api.registerTool(
      {
        name: "qa_restart_unsafe_probe",
        label: "QA Restart Unsafe Probe",
        description: "Detect whether restart recovery permits a non-replay-safe plugin call.",
        parameters: EMPTY_TOOL_PARAMETERS,
        async execute() {
          return jsonResult({ status: "unsafe-probe-executed" });
        },
      },
      { name: "qa_restart_unsafe_probe" },
    );
    api.registerWorkerProvider(createStaticSshWorkerProvider());
    api.registerWebSearchProvider(createQaLabWebSearchProvider());
    api.registerCli(
      async ({ program }) => {
        registerQaLabCli(program);
      },
      {
        descriptors: [
          {
            name: "qa",
            description: "Run QA scenarios and launch the private QA debugger UI",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
