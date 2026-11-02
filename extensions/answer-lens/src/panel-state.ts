export type Answer = { id: string; revision: string; text: string };
export type Length = "gist" | "condensed" | "full";
export type Wording = "plain" | "clearer" | "technical" | "original";
export type Target = { sessionKey: string; agentId?: string };
export type PanelState = {
  answers: Answer[];
  selected: string;
  text: string;
  derived: boolean;
  busy: boolean;
  error: string;
  coverage: Length;
  wording: Wording;
};

/** View-local reading state. No result or preference is written to the conversation. */
export function createPanelState(
  request: <T>(method: string, params: Record<string, unknown>) => Promise<T>,
  publish: (state: PanelState) => void,
) {
  let target: Target = { sessionKey: "" };
  let generation = 0;
  let pending: number | undefined;
  let active = true;
  let state: PanelState = {
    answers: [],
    selected: "",
    text: "",
    derived: false,
    busy: false,
    error: "",
    coverage: "condensed",
    wording: "clearer",
  };
  const update = (patch: Partial<PanelState>) => {
    state = { ...state, ...patch };
    publish(state);
  };
  const current = (id: number) => active && generation === id;
  const original = () => {
    ++generation;
    update({
      text: state.answers.find((a) => a.id === state.selected)?.text ?? "",
      derived: false,
      error: "",
    });
  };
  return {
    snapshot: () => state,
    reset(next: Target, available: boolean) {
      ++generation;
      pending = undefined;
      target = next;
      active = available;
      update({
        answers: [],
        selected: "",
        text: "",
        derived: false,
        busy: false,
        error: available ? "" : "Connect to the Gateway to read answers.",
      });
    },
    async load() {
      if (!active || state.busy) {
        return;
      }
      const id = ++generation;
      pending = id;
      update({ busy: true, error: "" });
      try {
        const result = await request<{ answers: Answer[] }>("answer-lens.sources", target);
        if (!current(id)) {
          return;
        }
        const selected =
          result.answers.find((a) => a.id === state.selected) ?? result.answers.at(-1);
        update({
          answers: result.answers,
          selected: selected?.id ?? "",
          text: selected?.text ?? "",
          derived: false,
        });
      } catch (error) {
        if (current(id)) {
          update({
            answers: [],
            selected: "",
            text: "",
            derived: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (active && pending === id) {
          pending = undefined;
          update({ busy: false });
        }
      }
    },
    select(id: string) {
      update({ selected: id });
      original();
    },
    configure(coverage: Length, wording: Wording) {
      if (!state.selected) {
        return;
      }
      ++generation;
      update({
        coverage,
        wording,
        error: "",
        derived: false,
        text: state.answers.find((a) => a.id === state.selected)?.text ?? "",
      });
    },
    original,
    async adjust() {
      const source = state.answers.find((a) => a.id === state.selected);
      if (!active || state.busy || !source) {
        return;
      }
      const id = ++generation;
      pending = id;
      update({ busy: true, error: "" });
      try {
        const result = await request<{ text: string }>("answer-lens.transform", {
          ...target,
          messageId: source.id,
          revision: source.revision,
          coverage: state.coverage,
          wording: state.wording,
        });
        if (current(id)) {
          update({ text: result.text, derived: true });
        }
      } catch (error) {
        if (current(id)) {
          update({ error: error instanceof Error ? error.message : String(error) });
        }
      } finally {
        if (active && pending === id) {
          pending = undefined;
          update({ busy: false });
        }
      }
    },
    dispose() {
      active = false;
      ++generation;
    },
  };
}
