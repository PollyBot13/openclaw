import { describe, expect, it, vi } from "vitest";
import { answerLensRevision } from "./answer.js";
import { createAnswerLensHandlers } from "./backend.js";

vi.mock("openclaw/plugin-sdk/gateway-method-runtime", () => ({ dispatchGatewayMethod: vi.fn() }));

function fixture() {
  const controller = new AbortController();
  const release = vi.fn();
  const assertCurrent = () => controller.signal.throwIfAborted();
  const source = {
    role: "assistant",
    stopReason: "stop",
    content: [{ type: "text", text: "Heat travels from warmer objects to colder ones." }] as [
      { type: string; text: string },
    ],
    __openclaw: { id: "answer-1" },
  };
  const page = { sessionId: "session-1", messages: [source] };
  const dispatch = vi.fn<NonNullable<Parameters<typeof createAnswerLensHandlers>[1]>>(async () => ({
    ok: true,
    payload: page,
  }));
  const complete = vi.fn<Parameters<typeof createAnswerLensHandlers>[0]>(async () => ({
    text: "Heat moves from hot to cold.",
    provider: "test-provider",
    model: "test-model",
    agentId: "default-agent",
    usage: {},
    execution: { mode: "isolated-agent-runtime", owner: { kind: "harness", id: "test" } },
    audit: { caller: { kind: "plugin", id: "answer-lens" } },
  }));
  const borrow = { signal: controller.signal, assertCurrent, release };
  const options = {
    params: {
      sessionKey: "agent:test:conversation",
      agentId: "test",
      messageId: "answer-1",
      revision: answerLensRevision(source.content[0].text),
      coverage: "gist",
      wording: "plain",
    },
    sessionAccessAuthority: {
      target: { agentId: "test", sessionKey: "agent:test:conversation", sessionId: "session-1" },
      sandboxRequired: false,
      assertCurrent,
      retain: () => borrow,
      retainSession: () => borrow,
      release: vi.fn(),
    },
  };
  return {
    controller,
    release,
    source,
    page,
    dispatch,
    complete,
    options,
    handlers: createAnswerLensHandlers(complete, dispatch),
  };
}

describe("Answer Lens backend", () => {
  it("rewrites only the authorized immutable source without a conversation write", async () => {
    const f = fixture();
    const before = structuredClone(f.page);
    const original = f.source.content[0].text;
    await expect(f.handlers.transform(f.options)).resolves.toMatchObject({
      text: "Heat moves from hot to cold.",
    });
    expect(f.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: JSON.stringify({ source: original }) }],
        execution: { mode: "isolated-agent-runtime", timeoutMs: 25_000 },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(f.complete).not.toHaveBeenCalledWith(
      expect.objectContaining({ agentId: expect.anything() }),
    );
    expect(f.dispatch.mock.calls.map(([method]) => method)).toEqual([
      "chat.history",
      "chat.history",
    ]);
    expect(f.page).toEqual(before);
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("returns Original without inference", async () => {
    const f = fixture();
    f.options.params.coverage = "full";
    f.options.params.wording = "original";
    expect(await f.handlers.transform(f.options)).toEqual({ text: f.source.content[0].text });
    expect(f.complete).not.toHaveBeenCalled();
  });

  it("bounds the whole transform below the panel's 30-second request deadline", async () => {
    const f = fixture();
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    try {
      const result = await f.complete({ messages: [] });
      f.complete.mockClear().mockImplementation(async (request) => {
        expect(request.execution?.timeoutMs).toBe(25_000);
        deadline.abort(new Error("Transform deadline reached"));
        expect(request.signal?.aborted).toBe(true);
        return result;
      });
      await expect(f.handlers.transform(f.options)).rejects.toThrow("Transform deadline reached");
      expect(timeout).toHaveBeenCalledWith(25_000);
      expect(f.release).toHaveBeenCalledOnce();
    } finally {
      timeout.mockRestore();
    }
  });

  it("does not dispatch inference after authority is revoked during source loading", async () => {
    const f = fixture();
    f.dispatch.mockImplementation(async () => {
      f.controller.abort(new Error("Access revoked"));
      return { ok: true, payload: f.page };
    });
    await expect(f.handlers.transform(f.options)).rejects.toThrow("Access revoked");
    expect(f.complete).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("rejects an in-flight result after revocation even if the model ignores abort", async () => {
    const f = fixture();
    const result = await f.complete({ messages: [] });
    f.complete.mockClear().mockImplementation(async () => {
      f.controller.abort(new Error("Access revoked"));
      return result;
    });
    await expect(f.handlers.transform(f.options)).rejects.toThrow("Access revoked");
    expect(f.release).toHaveBeenCalledOnce();
  });

  it.each(["before", "during"])("rejects source edits %s inference", async (timing) => {
    const f = fixture();
    if (timing === "before") {
      f.source.content[0].text = "Edited answer";
    } else {
      const result = await f.complete({ messages: [] });
      f.complete.mockClear().mockImplementation(async () => {
        f.source.content[0].text = "Edited answer";
        return result;
      });
    }
    await expect(f.handlers.transform(f.options)).rejects.toThrow("source answer changed");
    expect(f.complete).toHaveBeenCalledTimes(timing === "before" ? 0 : 1);
  });

  it("rejects missing access and invalid settings before reading or inference", async () => {
    const f = fixture();
    await expect(f.handlers.transform({ params: f.options.params })).rejects.toThrow(
      "write access",
    );
    await expect(
      f.handlers.transform({ ...f.options, params: { ...f.options.params, coverage: ["gist"] } }),
    ).rejects.toThrow("Select an answer");
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.complete).not.toHaveBeenCalled();
  });

  it("lists only untruncated assistant prose, never tool or thinking content", async () => {
    const f = fixture();
    f.page.messages.push({ ...f.source, role: "user" }, { ...f.source, stopReason: "toolUse" });
    f.dispatch.mockResolvedValue({
      ok: true,
      payload: {
        ...f.page,
        messages: [
          ...f.page.messages,
          { ...f.source, __openclaw: { id: "truncated", truncated: true } },
          { ...f.source, phase: "commentary" },
          { ...f.source, content: [{ type: "thinking", thinking: "Private reasoning" }] },
        ],
      },
    });
    await expect(f.handlers.sources(f.options)).resolves.toEqual({
      sessionId: "session-1",
      answers: [
        { id: "answer-1", revision: f.options.params.revision, text: f.source.content[0].text },
      ],
    });
    expect(f.complete).not.toHaveBeenCalled();
  });
});
