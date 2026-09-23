// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveDecisionModelSelection } from "../../../src/agents/decision-model-setting.ts";
import {
  decisionTaskEntries,
  resolveDecisionTaskSelection,
  resolveGlobalDecisionTaskSelection,
} from "./decision-task-rows.ts";

const task = "plugin/check" as const;

function runtimeProjection(
  config: Parameters<typeof resolveDecisionModelSelection>[0],
  agentId?: string,
) {
  const selection = resolveDecisionModelSelection(config, agentId, task);
  return {
    source: selection.source,
    disabled: selection.disabled,
    effectiveModel: selection.selection
      ? `${selection.selection.provider}/${selection.selection.model}`
      : undefined,
  };
}

describe("decision task UI precedence", () => {
  it("shows declared tasks before configuration and preserves unavailable saved tasks", () => {
    const declared = [
      { id: "decision_evaluate", title: "Decision model" },
      { id: "plugin/check", title: "Message triage", description: "Routes incoming messages." },
    ];
    expect(decisionTaskEntries(declared, { "retired/check": "old/model" })).toEqual([
      declared[1],
      { id: "retired/check", title: "retired/check", unavailable: true },
    ]);
  });
  it.each(["", "typesafe/jev-latest"])("retains an explicit built-in override (%s)", (value) => {
    expect(decisionTaskEntries([], { decision_evaluate: value })).toEqual([
      { id: "decision_evaluate", title: "Saved built-in task override" },
    ]);
  });
  it("stays in parity with the canonical runtime resolver", () => {
    const cases: Array<{
      config: Parameters<typeof resolveDecisionModelSelection>[0];
      agentId?: string;
    }> = [
      {
        config: {
          agents: {
            defaults: {
              decisionModel: "global/scalar",
              decisionModelsByTask: { [task]: "global/task" },
            },
            entries: {
              worker: {
                decisionModel: "agent/scalar",
                decisionModelsByTask: { [task]: "agent/task" },
              },
            },
          },
        },
        agentId: "worker",
      },
      {
        config: {
          agents: {
            defaults: { decisionModel: "global/scalar" },
            entries: { worker: { decisionModel: "" } },
          },
        },
        agentId: "worker",
      },
      {
        config: {
          agents: { defaults: { decisionModelsByTask: { [task]: "task/only" } } },
        },
      },
      {
        config: {
          agents: {
            defaults: {
              decisionModel: "global/scalar",
              decisionModelsByTask: { [task]: "" },
            },
            entries: {
              worker: {
                decisionModel: "agent/scalar",
                decisionModelsByTask: { [task]: "agent/task" },
              },
            },
          },
        },
        agentId: "worker",
      },
      {
        config: {
          agents: {
            defaults: {
              decisionModel: "global/scalar",
              decisionModelsByTask: { [task]: "global/task" },
            },
            entries: {
              worker: {
                decisionModel: "",
                decisionModelsByTask: { [task]: "agent/task" },
              },
            },
          },
        },
        agentId: "worker",
      },
    ];
    for (const item of cases) {
      const defaults = item.config.agents?.defaults;
      const entry = item.agentId ? item.config.agents?.entries?.[item.agentId] : undefined;
      const ui = resolveDecisionTaskSelection(defaults, entry, task);
      expect({
        source: ui.source,
        disabled: ui.disabled,
        effectiveModel: ui.effectiveModel,
      }).toEqual(runtimeProjection(item.config, item.agentId));
    }
  });

  it("matches the runtime order for agent task, global task, scalar agent, scalar default", () => {
    expect(
      resolveDecisionTaskSelection(
        {
          decisionModel: "global/scalar",
          decisionModelsByTask: { [task]: "global/task" },
        },
        {
          decisionModel: "agent/scalar",
          decisionModelsByTask: { [task]: "agent/task" },
        },
        task,
      ),
    ).toMatchObject({ source: "agent-task", value: "agent/task", effectiveModel: "agent/task" });
    expect(
      resolveDecisionTaskSelection(
        { decisionModel: "global/scalar", decisionModelsByTask: { [task]: "global/task" } },
        { decisionModel: "agent/scalar" },
        task,
      ),
    ).toMatchObject({ source: "global-task", effectiveModel: "global/task" });
    expect(
      resolveDecisionTaskSelection(
        { decisionModel: "global/scalar" },
        { decisionModel: "agent/scalar" },
        task,
      ),
    ).toMatchObject({ source: "agent", effectiveModel: "agent/scalar" });
    expect(
      resolveDecisionTaskSelection({ decisionModel: "global/scalar" }, undefined, task),
    ).toMatchObject({ source: "default", effectiveModel: "global/scalar" });
  });

  it("keeps an empty agent scalar authoritative while preserving its task override", () => {
    expect(
      resolveDecisionTaskSelection(
        { decisionModel: "global/scalar", decisionModelsByTask: { [task]: "global/task" } },
        { decisionModel: "", decisionModelsByTask: { [task]: "stored/task" } },
        task,
      ),
    ).toMatchObject({
      value: "stored/task",
      source: "agent",
      disabled: true,
      effectiveModel: undefined,
    });
  });

  it("supports task-only setup and global task inheritance", () => {
    expect(
      resolveGlobalDecisionTaskSelection({ decisionModelsByTask: { [task]: "task/only" } }, task),
    ).toMatchObject({
      source: "global-task",
      effectiveModel: "task/only",
      inheritedModel: undefined,
      disabled: false,
    });
    expect(
      resolveGlobalDecisionTaskSelection({ decisionModel: "global/scalar" }, task),
    ).toMatchObject({ source: "default", value: undefined, inheritedModel: "global/scalar" });
  });
});
