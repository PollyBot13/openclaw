import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { loadPluginManifest } from "./manifest.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function load(declaration: Record<string, unknown>) {
  const root = tempDirs.make("manifest-decision-routing-");
  fs.writeFileSync(path.join(root, "index.js"), "throw new Error('runtime must stay cold');");
  fs.writeFileSync(
    path.join(root, "openclaw.plugin.json"),
    JSON.stringify({
      id: "fixture",
      configSchema: {
        type: "object",
        properties: { byTask: { type: "object", additionalProperties: { type: "string" } } },
      },
      ...declaration,
    }),
  );
  return loadPluginManifest(root);
}

describe("Decision routing manifest", () => {
  it("discovers a static router and owner-declared tasks without loading JavaScript", () => {
    const result = load({
      decisionRouter: { configMapProperty: "byTask" },
      decisionTasks: [{ id: "fixture/example", name: " Example ", description: " Example task " }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.decisionRouter).toEqual({ configMapProperty: "byTask" });
      expect(result.manifest.decisionTasks).toEqual([
        { id: "fixture/example", name: "Example", description: "Example task" },
      ]);
    }
  });

  it("rejects foreign task ownership and undeclared config maps", () => {
    expect(
      load({ decisionTasks: [{ id: "other/example", name: "Foreign", description: "No" }] }),
    ).toMatchObject({ ok: false });
    expect(
      load({
        decisionTasks: [{ id: "fixture/nested/example", name: "Nested", description: "No" }],
      }),
    ).toMatchObject({ ok: false });
    expect(load({ decisionRouter: { configMapProperty: "missing" } })).toMatchObject({ ok: false });
  });
});
