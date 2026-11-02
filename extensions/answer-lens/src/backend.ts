import { dispatchGatewayMethod } from "openclaw/plugin-sdk/gateway-method-runtime";
import type { GatewayRequestHandlerOptions } from "openclaw/plugin-sdk/gateway-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  answerLensPrompt,
  answerLensRevision,
  readAnswerLensSource,
  record,
  type AnswerLensSettings,
} from "./answer.js";

type Request = Pick<GatewayRequestHandlerOptions, "params" | "signal" | "sessionAccessAuthority">;
type Answer = { id: string; revision: string; text: string };

export function createAnswerLensHandlers(
  complete: OpenClawPluginApi["runtime"]["llm"]["complete"],
  dispatch = dispatchGatewayMethod,
) {
  async function sources({ params, signal }: Request) {
    if (
      typeof params.sessionKey !== "string" ||
      !params.sessionKey.trim() ||
      (params.agentId !== undefined && typeof params.agentId !== "string")
    ) {
      throw new Error("Select an existing conversation before opening Answer Lens.");
    }
    signal?.throwIfAborted();
    const response = await dispatch("chat.history", {
      sessionKey: params.sessionKey,
      ...(params.agentId === undefined ? {} : { agentId: params.agentId }),
      ...(params.messageId === undefined ? {} : { messageId: params.messageId }),
      limit: 100,
      maxChars: 32_000,
      maxBytes: 400_000,
    });
    signal?.throwIfAborted();
    if (!response.ok) {
      throw new Error(response.error?.message ?? "This conversation is no longer accessible.");
    }
    const page = record(response.payload);
    if (!page || typeof page.sessionId !== "string" || !Array.isArray(page.messages)) {
      throw new Error("Conversation history is unavailable. Reopen the conversation and retry.");
    }
    const answers: Answer[] = [];
    for (const value of page.messages) {
      const message = record(value);
      const metadata = record(message?.["__openclaw"]);
      const text = readAnswerLensSource(message);
      if (text && typeof metadata?.id === "string" && metadata.truncated !== true) {
        answers.push({ id: metadata.id, revision: answerLensRevision(text), text });
      }
    }
    return { answers, sessionId: page.sessionId };
  }

  async function transform(options: Request) {
    const { params, sessionAccessAuthority: access } = options;
    if (
      typeof params.messageId !== "string" ||
      !params.messageId ||
      typeof params.revision !== "string" ||
      !/^[a-f0-9]{64}$/.test(params.revision) ||
      typeof params.coverage !== "string" ||
      !["gist", "condensed", "full"].includes(params.coverage) ||
      typeof params.wording !== "string" ||
      !["plain", "clearer", "technical", "original"].includes(params.wording)
    ) {
      throw new Error("Select an answer, length, and wording before applying Answer Lens.");
    }
    if (!access) {
      throw new Error("Answer Lens requires write access to a non-incognito conversation.");
    }
    access.assertCurrent();
    const retained = access.retain();
    // Native panel requests time out after 30 seconds; stop this work before the viewer gives up.
    const signal = AbortSignal.any([
      retained.signal,
      AbortSignal.timeout(25_000),
      ...(options.signal ? [options.signal] : []),
    ]);
    const assertCurrent = () => {
      signal.throwIfAborted();
      access.assertCurrent();
      retained.assertCurrent();
    };
    const readSource = async () => {
      assertCurrent();
      const page = await sources({ ...options, signal });
      assertCurrent();
      const answer = page.answers.find((candidate) => candidate.id === params.messageId);
      if (
        page.sessionId !== access.target.sessionId ||
        !answer ||
        answer.revision !== params.revision
      ) {
        throw new Error("The source answer changed or is unavailable. Refresh Answer Lens.");
      }
      return answer;
    };
    try {
      const answer = await readSource();
      if (params.coverage === "full" && params.wording === "original") {
        return { text: answer.text };
      }
      const settings: AnswerLensSettings = {
        coverage: params.coverage as AnswerLensSettings["coverage"],
        wording: params.wording as AnswerLensSettings["wording"],
      };
      assertCurrent();
      const result = await complete({
        messages: [{ role: "user", content: JSON.stringify({ source: answer.text }) }],
        systemPrompt: answerLensPrompt(settings),
        purpose: "answer-lens",
        signal,
        execution: { mode: "isolated-agent-runtime", timeoutMs: 25_000 },
      });
      assertCurrent();
      // The answer can be edited while inference runs; never attach an old rewrite to new prose.
      await readSource();
      if (!result.text.trim() || result.stopReason === "error" || result.stopReason === "aborted") {
        throw new Error("The model did not return a completed explanation. Try again.");
      }
      return { text: result.text, model: result.model, provider: result.provider };
    } finally {
      retained.release();
    }
  }

  return { sources, transform };
}
