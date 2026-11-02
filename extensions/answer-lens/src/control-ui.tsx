/** @jsxImportSource @solidjs/web */
import { render } from "@solidjs/web";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { defineControlUiPlugin, type ControlUiPanel } from "openclaw/plugin-sdk/control-ui";
import { createMemo, createSignal, For, Show } from "solid-js";
import { createPanelState, type Length, type Wording, type PanelState } from "./panel-state.js";
import "./control-ui.css";

const lengths: { value: Length; label: string }[] = [
  { value: "gist", label: "Gist" },
  { value: "condensed", label: "Shorter" },
  { value: "full", label: "Full" },
];
const wordings: { value: Wording; label: string }[] = [
  { value: "plain", label: "Simple" },
  { value: "clearer", label: "Clearer" },
  { value: "technical", label: "Technical" },
  { value: "original", label: "Original wording" },
];

const mount: ControlUiPanel["mount"] = (container, initialContext) => {
  let context = initialContext;
  const host = context.host;
  const [view, setView] = createSignal<PanelState>({
    answers: [],
    selected: "",
    text: "",
    derived: false,
    busy: false,
    error: "",
    coverage: "condensed",
    wording: "clearer",
  });
  const state = createPanelState((method, params) => host.request(method, params), setView);
  let identity = "";
  const sync = () => {
    const nextIdentity = JSON.stringify([
      context.props.sessionKey,
      context.props.agentId,
      host.connection.connected,
      host.connection.canRead,
      host.connection.canWrite,
    ]);
    if (identity === nextIdentity) {
      return;
    }
    identity = nextIdentity;
    state.reset(context.props, host.connection.connected && host.connection.canRead);
    void state.load();
  };
  const unsubscribe = host.subscribe(sync);
  sync();
  const disposeRender = render(() => {
    const html = createMemo(() =>
      DOMPurify.sanitize(marked.parse(view().text, { async: false }), {
        ALLOWED_TAGS: [
          "p",
          "br",
          "hr",
          "h1",
          "h2",
          "h3",
          "h4",
          "ul",
          "ol",
          "li",
          "strong",
          "em",
          "del",
          "blockquote",
          "pre",
          "code",
          "a",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
        ],
        ALLOWED_ATTR: ["href", "title", "start"],
        ALLOW_DATA_ATTR: false,
        ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:)/i,
      }),
    );
    return (
      <section class="answer-lens" aria-label="Answer Lens">
        <header>
          <span class="answer-lens-eyebrow">A different way to read</span>
          <h2>Answer Lens</h2>
          <p>Adjust an explanation without changing the conversation.</p>
        </header>
        <div class="answer-lens-source">
          <label>
            Answer
            <select
              aria-label="Answer"
              value={view().selected}
              onChange={(e) => state.select(e.currentTarget.value)}
              disabled={view().answers.length === 0}
            >
              <For each={view().answers}>
                {(answer, index) => (
                  <option value={answer.id}>
                    {index() + 1}. {answer.text.replace(/\s+/g, " ").slice(0, 85)}
                  </option>
                )}
              </For>
            </select>
          </label>
          <button
            type="button"
            class="btn"
            disabled={view().busy}
            onClick={() => void state.load()}
          >
            Refresh answers
          </button>
        </div>
        <fieldset>
          <legend>Length</legend>
          <div class="answer-lens-options">
            <For each={lengths}>
              {(option) => (
                <button
                  type="button"
                  disabled={!view().selected}
                  aria-pressed={view().coverage === option.value ? "true" : "false"}
                  onClick={() => state.configure(option.value, view().wording)}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </fieldset>
        <fieldset>
          <legend>Technical depth</legend>
          <div class="answer-lens-options">
            <For each={wordings}>
              {(option) => (
                <button
                  type="button"
                  disabled={!view().selected}
                  aria-pressed={view().wording === option.value ? "true" : "false"}
                  onClick={() => state.configure(view().coverage, option.value)}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </fieldset>
        <div class="answer-lens-actions">
          <button
            type="button"
            class="btn"
            disabled={!view().selected}
            onClick={() => state.original()}
          >
            Original
          </button>
          <button
            type="button"
            class="btn primary"
            disabled={view().busy || !view().selected || !host.connection.canWrite}
            onClick={() => void state.adjust()}
          >
            {view().busy ? "Working…" : "Adjust explanation"}
          </button>
        </div>
        <p class="answer-lens-note">
          Runs only when you click Adjust, using your default agent’s model. Nothing is sent to the
          conversation.
        </p>
        <Show when={view().error}>
          <p role="alert" class="answer-lens-error">
            {host.redact(view().error)}
          </p>
        </Show>
        <div role="status" class="answer-lens-status">
          {view().busy
            ? "Preparing your reading…"
            : view().selected
              ? view().derived
                ? "Adjusted reading · Original answer is unchanged"
                : "Original answer"
              : "No completed answers loaded. Refresh after an answer finishes."}
        </div>
        <article
          class="answer-lens-reading"
          aria-label="Answer reading"
          aria-busy={view().busy ? "true" : "false"}
          // oxlint-disable-next-line solid/no-innerhtml -- DOMPurify above owns this HTML sink with an explicit tag and URL allowlist.
          innerHTML={html()}
        />
      </section>
    );
  }, container);
  return {
    update(next) {
      context = next;
      sync();
    },
    dispose() {
      state.dispose();
      unsubscribe();
      disposeRender();
    },
  };
};

export default defineControlUiPlugin({
  id: "answer-lens",
  activate(host) {
    const panel = host.ui.registerPanel({ id: "reader", label: "Answer Lens", mount });
    const action = host.ui.registerAction({
      id: "open-reader",
      label: "Answer Lens",
      placement: "header",
      run: ({ sessionKey, agentId }) => host.ui.openPanel("reader", { sessionKey, agentId }),
    });
    return () => {
      action();
      panel();
    };
  },
});
