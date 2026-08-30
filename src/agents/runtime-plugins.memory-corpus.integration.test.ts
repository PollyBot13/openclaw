// Verifies direct agent registry scopes retain root-owned memory corpus sidecars.
import { afterAll, afterEach, expect, it } from "vitest";
import { loadAndActivateRootPluginRegistry } from "../plugins/loader.js";
import {
  cleanupPluginLoaderFixturesForTest,
  makePluginLoaderTempDir,
  resetPluginLoaderTestStateForTest,
  useNoBundledPlugins,
  writePlugin,
} from "../plugins/loader.test-fixtures.js";
import { listMemoryCorpusSupplements } from "../plugins/memory-state.js";
import { withAgentPluginRegistry } from "./runtime-plugins.js";

afterEach(() => {
  resetPluginLoaderTestStateForTest();
});

afterAll(() => {
  cleanupPluginLoaderFixturesForTest();
});

it("keeps a root-owned memory corpus sidecar in a direct agent registry", async () => {
  useNoBundledPlugins();
  const pluginId = "memory-corpus-sidecar";
  const plugin = writePlugin({
    id: pluginId,
    body: `module.exports = {
  id: ${JSON.stringify(pluginId)},
  register(api) {
    api.registerMemoryCorpusSupplement({
      search: async () => [],
      get: async () => null,
    });
  },
};\n`,
  });
  const config = {
    plugins: {
      allow: [pluginId],
      entries: { [pluginId]: { enabled: true } },
      load: { paths: [plugin.dir] },
    },
  };
  const workspaceDir = makePluginLoaderTempDir();
  const root = loadAndActivateRootPluginRegistry({
    cache: false,
    config,
    onlyPluginIds: [pluginId],
    workspaceDir,
  });

  expect(root.memoryCorpusSupplements.map((entry) => entry.pluginId)).toEqual([pluginId]);
  const rootSupplement = root.memoryCorpusSupplements[0]?.supplement;
  await withAgentPluginRegistry({
    config,
    workspaceDir,
    run: async () => {
      expect(listMemoryCorpusSupplements().map((entry) => entry.pluginId)).toEqual([pluginId]);
      expect(listMemoryCorpusSupplements()[0]?.supplement).toBe(rootSupplement);
    },
  });
  await withAgentPluginRegistry({
    config,
    workspaceDir: makePluginLoaderTempDir(),
    run: async () => {
      expect(listMemoryCorpusSupplements()).toEqual([]);
    },
  });
  await withAgentPluginRegistry({
    config: { plugins: { enabled: false } },
    workspaceDir,
    run: async () => {
      expect(listMemoryCorpusSupplements()).toEqual([]);
    },
  });
});
