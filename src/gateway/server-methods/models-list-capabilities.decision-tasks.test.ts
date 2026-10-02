import { describe, expect, it } from "vitest";
import { createPluginMetadataSnapshotFixture } from "../../plugins/plugin-metadata.test-support.js";
import { listDecisionTasks } from "./models-list-capabilities.js";

const snapshot = createPluginMetadataSnapshotFixture({
  plugins: [
    {
      id: "fixture",
      decisionTasks: [
        { id: "fixture/summarize", name: "Summarize", description: "Choose a summary strategy." },
      ],
    },
  ],
});

describe("Decision task discovery", () => {
  it("adds enabled plugin tasks without a hard-coded task row", () => {
    const tasks = listDecisionTasks({
      config: { plugins: { entries: { fixture: { enabled: true } } } },
      snapshot,
    });
    expect(tasks.map((task) => task.id)).toEqual([
      "core/tool-prefilter",
      "core/decision-evaluate",
      "fixture/summarize",
    ]);
    expect(tasks[2]).toMatchObject({ owner: "fixture", name: "Summarize" });
  });

  it("does not advertise a disabled plugin task", () => {
    expect(
      listDecisionTasks({
        config: { plugins: { entries: { fixture: { enabled: false } } } },
        snapshot,
      }).map((task) => task.id),
    ).toEqual(["core/tool-prefilter", "core/decision-evaluate"]);
  });
});
