import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteWorkerStore, type SqliteWorkerStore } from "../infra/sqlite-worker-store.js";
import type { DecisionRecording, RecorderStoreOperations } from "./flight-recorder.types.js";

const resources: { directory: string; store: SqliteWorkerStore<RecorderStoreOperations> }[] = [];
afterEach(async () => {
  for (const { directory, store } of resources.splice(0)) {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
async function open(maxBytes = 2 * 1024 * 1024) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "recorder-worker-"));
  const store = await openSqliteWorkerStore<RecorderStoreOperations>({
    moduleUrl: new URL("./flight-recorder-store.worker.ts", import.meta.url),
    databasePath: path.join(directory, "pool.sqlite"),
    input: { maxBytes },
  });
  resources.push({ directory, store });
  return { directory, store };
}
function record(id: string, bytes = 1): DecisionRecording {
  return {
    formatVersion: 1,
    id,
    startedAt: 100,
    durationMs: 5,
    version: 1,
    purpose: "synthetic",
    rubricVersion: "test",
    status: "unavailable",
    reason: "disabled",
    input: {
      completeness: "complete",
      batch: { state: randomBytes(bytes).toString("hex"), questions: {} },
    },
  };
}
const list = (store: SqliteWorkerStore<RecorderStoreOperations>) =>
  store.execute({ type: "list", input: { limit: 100 } });

describe("dedicated Decision recorder pool", () => {
  it("keeps native file sizes bounded across concurrent rotation, oversized input, restart, and deletion", async () => {
    const { directory, store } = await open();
    let peak = 0;
    const sampling = { active: true };
    const sample = async () => {
      while (sampling.active) {
        const files = await readdir(directory);
        const sizes = await Promise.all(
          files.map(async (name) => {
            try {
              return (await stat(path.join(directory, name))).size;
            } catch {
              return 0;
            }
          }),
        );
        peak = Math.max(
          peak,
          sizes.reduce((a, b) => a + b, 0),
        );
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
      }
    };
    const sampler = sample();
    try {
      const writes = await Promise.all(
        Array.from({ length: 32 }, (_, index) =>
          store.execute({ type: "append", input: record(`r${index}`, 90_000) }),
        ),
      );
      expect(writes.every((write) => write.retained)).toBe(true);
      expect(writes.reduce((sum, write) => sum + write.evicted, 0)).toBeGreaterThan(0);
      const before = await list(store);
      expect(before.records[0]?.id).toBe("r31");
      expect(before.records.some((row) => row.id === "r0")).toBe(false);
      await store.execute({ type: "append", input: record("oversize", 2_000_000) });
      const exported = await store.execute({
        type: "export",
        input: { ids: ["oversize"], format: "json", preview: false },
      });
      expect(JSON.parse(exported.content!)[0].input).toEqual({ completeness: "oversize" });
      expect((await stat(path.join(directory, "pool.sqlite"))).mode & 0o077).toBe(0);
      expect((await stat(directory)).mode & 0o077).toBe(0);
      await store.close();
      const reopened = await openSqliteWorkerStore<RecorderStoreOperations>({
        moduleUrl: new URL("./flight-recorder-store.worker.ts", import.meta.url),
        databasePath: path.join(directory, "pool.sqlite"),
        input: { maxBytes: 2 * 1024 * 1024 },
      });
      resources.push({ directory, store: reopened });
      expect((await list(reopened)).recordCount).toBeGreaterThan(0);
      await reopened.close();
    } finally {
      sampling.active = false;
      await sampler;
    }
    expect(peak).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(peak).toBeGreaterThan(0);
    await rm(path.join(directory, "pool.sqlite"));
    expect(await readdir(directory)).toEqual([]);
  });
});

it("rejects oversized selected exports before transmitting and preserves exact Unicode sizes", async () => {
  const { store } = await open(50 * 1024 * 1024);
  const ids = [];
  for (let i = 0; i < 9; i++) {
    ids.push(`large${i}`);
    await store.execute({ type: "append", input: record(`large${i}`, 500_000) });
  }
  await expect(
    store.execute({ type: "export", input: { ids, format: "json", preview: true } }),
  ).rejects.toThrow("exceeds 8 MiB");
  const unicode = record("unicode");
  unicode.purpose = "synthetic 🔱";
  await store.execute({ type: "append", input: unicode });
  const exported = await store.execute({
    type: "export",
    input: { ids: ["unicode"], format: "jsonl", preview: false },
  });
  expect(exported.bytes).toBe(Buffer.byteLength(exported.content!));
});
