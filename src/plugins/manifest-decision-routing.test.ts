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
  it("discovers a static router without loading JavaScript", () => {
    const result = load({
      decisionRouter: { configMapProperty: "byTask" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.decisionRouter).toEqual({ configMapProperty: "byTask" });
    }
  });

  it("rejects undeclared config maps", () => {
    expect(load({ decisionRouter: { configMapProperty: "missing" } })).toMatchObject({ ok: false });
  });
});
