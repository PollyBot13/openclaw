import { describe, expect, it, vi } from "vitest";
import { createPanelState } from "./panel-state.js";

function harness() {
  const calls: {
    method: string;
    params: Record<string, unknown>;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }[] = [];
  const request = <T>(method: string, params: Record<string, unknown>) =>
    new Promise<T>((resolve, reject) => {
      calls.push({
        method,
        params, // SAFETY: each test resolves the response shape requested by the panel.
        resolve: (value) => resolve(value as T),
        reject,
      });
    });
  const panel = createPanelState(request, vi.fn());
  panel.reset({ sessionKey: "agent:example:one", agentId: "example" }, true);
  const source = { id: "one", revision: "rev-one", text: "An immutable original answer." };
  const load = async () => {
    const pending = panel.load();
    calls.at(-1)!.resolve({ answers: [source] });
    await pending;
  };
  return { panel, calls, source, load };
}

describe("Answer Lens reading state", () => {
  it("does not discard a source load when settings are unavailable", async () => {
    const { panel, calls, source } = harness();
    const pending = panel.load();
    panel.configure("gist", "plain");
    calls[0]!.resolve({ answers: [source] });
    await pending;
    expect(panel.snapshot()).toMatchObject({ selected: source.id, busy: false });
  });

  it("loads originals without inference; each adjustment uses the same source identity", async () => {
    const { panel, calls, source, load } = harness();
    await load();
    expect(calls.map((c) => c.method)).toEqual(["answer-lens.sources"]);
    panel.configure("gist", "plain");
    const first = panel.adjust();
    expect(calls.at(-1)?.params).toMatchObject({
      messageId: source.id,
      revision: source.revision,
      coverage: "gist",
      wording: "plain",
    });
    calls.at(-1)!.resolve({ text: "Short reading." });
    await first;
    expect(panel.snapshot()).toMatchObject({ text: "Short reading.", derived: true });
    panel.configure("full", "technical");
    const second = panel.adjust();
    expect(calls.at(-1)?.params).toMatchObject({ messageId: source.id, revision: source.revision });
    expect(calls.at(-1)?.params).not.toHaveProperty("text");
    calls.at(-1)!.resolve({ text: "Technical reading." });
    await second;
    panel.original();
    expect(panel.snapshot()).toMatchObject({ text: source.text, derived: false });
  });

  it.each(["original", "configure", "reset", "dispose"] as const)(
    "ignores a late result after %s",
    async (action) => {
      const { panel, calls, source, load } = harness();
      await load();
      const pending = panel.adjust();
      if (action === "original") {
        panel.original();
      }
      if (action === "configure") {
        panel.configure("full", "technical");
      }
      if (action === "reset") {
        panel.reset({ sessionKey: "agent:example:two" }, true);
      }
      if (action === "dispose") {
        panel.dispose();
      }
      if (action === "original" || action === "configure") {
        expect(panel.snapshot().busy).toBe(true);
        const count = calls.length;
        await panel.adjust();
        expect(calls).toHaveLength(count);
      }
      calls.at(-1)!.resolve({ text: "A stale reading." });
      await pending;
      expect(panel.snapshot().text).not.toBe("A stale reading.");
      if (action === "original" || action === "configure") {
        expect(panel.snapshot().text).toBe(source.text);
      }
    },
  );

  it("clears private source and ignores a pending load on disconnect", async () => {
    const { panel, calls } = harness();
    const pending = panel.load();
    panel.reset({ sessionKey: "agent:example:one" }, false);
    calls[0]!.resolve({ answers: [{ id: "private", revision: "old", text: "Unavailable" }] });
    await pending;
    expect(panel.snapshot().answers).toEqual([]);
    await panel.adjust();
    expect(calls).toHaveLength(1);
  });

  it("retains the original and reports an inference error, then permits retry", async () => {
    const { panel, calls, source, load } = harness();
    await load();
    const pending = panel.adjust();
    calls.at(-1)!.reject(new Error("Model unavailable"));
    await pending;
    expect(panel.snapshot()).toMatchObject({
      text: source.text,
      error: "Model unavailable",
      busy: false,
    });
    const retry = panel.adjust();
    calls.at(-1)!.resolve({ text: "Recovered" });
    await retry;
    expect(panel.snapshot()).toMatchObject({ text: "Recovered", error: "" });
  });
});
