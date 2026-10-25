import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import * as sqliteWorkerStore from "../infra/sqlite-worker-store.js";
import { DecisionFlightRecorder } from "./flight-recorder.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0)) {
    await close();
  }
});
const metadata = {
  formatVersion: 1 as const,
  version: 1 as const,
  purpose: "test",
  rubricVersion: "1",
};
const batch = { state: "PRIVATE INPUT", questions: { truth: { type: "boolean" as const } } };
const outcome = { status: "unavailable" as const, reason: "disabled" as const };
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "recorder-lifecycle-"));
  const settings = { enabled: false, maxBytes: 2 * 1024 * 1024, fullInputWindowMs: 1000 };
  let now = 100;
  const owner = new DecisionFlightRecorder(
    path.join(directory, "pool.sqlite"),
    () => settings,
    () => now,
  );
  cleanup.push(async () => {
    await owner.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    owner,
    settings,
    directory,
    advance: () => {
      now += 1001;
    },
  };
}
it("stays off by default, records basic outcomes, expires full inputs, and cannot revive them", async () => {
  const { owner, settings, directory, advance } = await fixture();
  expect(owner.begin(metadata, batch)).toBeUndefined();
  expect(await readdir(directory)).toEqual([]);
  settings.enabled = true;
  owner.begin(metadata, batch)?.(outcome);
  owner.window("start");
  const pending = owner.begin(metadata, batch);
  advance();
  expect((await owner.status()).fullInputUntil).toBeNull();
  owner.window("start");
  pending?.(outcome);
  owner.begin(metadata, batch)?.(outcome);
  const rows = (await owner.list()).records;
  expect(rows.map((row) => row.input.completeness)).toEqual([
    "complete",
    "window-ended",
    "not-enabled",
  ]);
  const exported = await owner.export({
    ids: rows.map((row) => row.id),
    format: "json",
    preview: false,
  });
  expect(exported.bytes).toBe(Buffer.byteLength(exported.content!));
  expect(
    JSON.parse(exported.content!).filter((row: { input: { batch?: unknown } }) => row.input.batch),
  ).toHaveLength(1);
  const beforeDisable = owner.begin(metadata, batch);
  settings.enabled = false;
  owner.configure(settings);
  settings.enabled = true;
  beforeDisable?.(outcome);
  expect((await owner.status()).fullInputUntil).toBeNull();
  expect((await owner.list()).recordCount).toBe(3);
  await owner.close();
  expect((await owner.status()).fullInputUntil).toBeNull();
});
it("deletes fenced in-flight records, reclaims physical files, and leaves future capture active", async () => {
  const { owner, settings, directory } = await fixture();
  settings.enabled = true;
  owner.window("start");
  owner.begin(metadata, batch)?.(outcome);
  await owner.list();
  const pending = owner.begin(metadata, batch);
  const deletion = owner.delete();
  pending?.(outcome);
  expect(await deletion).toMatchObject({ deletedRecords: 1 });
  expect(await readdir(directory)).toEqual([]);
  expect((await owner.status()).fullInputUntil).not.toBeNull();
  owner.begin(metadata, batch)?.(outcome);
  expect((await owner.list()).records).toMatchObject([{ input: { completeness: "complete" } }]);
});
it("shrinks a filled pool retaining newest fitting records and keeps cursor/export exact", async () => {
  const { owner, settings, directory } = await fixture();
  settings.enabled = true;
  owner.window("start");
  for (let i = 0; i < 20; i++) {
    owner.begin(
      { ...metadata, purpose: `call${i}` },
      { ...batch, state: "x".repeat(60_000) },
    )?.(outcome);
    await owner.list(1);
  }
  const old = await owner.list(1);
  const sampling = { active: true };
  let peak = 0;
  const sampler = (async () => {
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
        sizes.reduce((sum, size) => sum + size, 0),
      );
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
  })();
  try {
    settings.maxBytes--;
    await owner.list(1);
    settings.maxBytes = 1024 * 1024;
    await owner.list(1);
  } finally {
    sampling.active = false;
    await sampler;
  }
  expect(peak).toBeLessThanOrEqual(2 * 1024 * 1024);
  const page = await owner.list(1);
  expect(page.records[0]?.purpose).toBe("call19");
  expect(page.storageBytes).toBeLessThanOrEqual(settings.maxBytes);
  expect(page.recordCount).toBeLessThan(old.recordCount);
  const next = await owner.list(1, page.nextCursor);
  expect(next.records[0]?.purpose).toBe("call18");
  const ids = [page.records[0]!.id];
  const preview = await owner.export({ ids, format: "jsonl", preview: true });
  const exported = await owner.export({ ids, format: "jsonl", preview: false });
  expect(preview.bytes).toBe(Buffer.byteLength(exported.content!));
  expect(exported.formatVersion).toBe(1);
  await expect(owner.export({ ids: ["evicted"], format: "json", preview: true })).rejects.toThrow(
    "evicted or deleted",
  );
});

it("bounds simultaneously retained inputs and records omissions explicitly", async () => {
  const { owner, settings } = await fixture();
  settings.enabled = true;
  settings.maxBytes = 50 * 1024 * 1024;
  owner.window("start");
  const pending = Array.from({ length: 5 }, (_, i) =>
    owner.begin(
      { ...metadata, purpose: `parallel${i}` },
      { ...batch, state: "x".repeat(2_000_000) },
    ),
  );
  for (const finish of pending) {
    finish?.(outcome);
  }
  const rows = (await owner.list()).records;
  expect(rows).toHaveLength(5);
  expect(rows[0]).toMatchObject({ purpose: "parallel4", input: { completeness: "oversize" } });
  expect(rows.filter((row) => row.input.completeness === "complete")).toHaveLength(4);
});

it("does not invoke rejected input accessors while full capture is enabled", async () => {
  const { owner, settings } = await fixture();
  settings.enabled = true;
  owner.window("start");
  let reads = 0;
  const unsafe = { ...batch };
  Object.defineProperty(unsafe, "state", {
    enumerable: true,
    get() {
      reads++;
      return "PRIVATE";
    },
  });
  owner.begin(metadata, unsafe)?.(undefined);
  expect(reads).toBe(0);
  expect((await owner.list()).records[0]).toMatchObject({
    status: "failed",
    reason: "error",
    input: { completeness: "unsupported-input" },
  });
});

it("cleans a failed shrink before reverted-budget appends can spend journal headroom", async () => {
  const { owner, settings, directory } = await fixture();
  settings.enabled = true;
  owner.window("start");
  for (let i = 0; i < 20; i++) {
    owner.begin(
      { ...metadata, purpose: `before${i}` },
      { ...batch, state: "x".repeat(60_000) },
    )?.(outcome);
    await owner.list(1);
  }
  const originalOpen = sqliteWorkerStore.openSqliteWorkerStore;
  vi.spyOn(sqliteWorkerStore, "openSqliteWorkerStore").mockImplementation(async (...args) => {
    const store = await originalOpen(...args);
    if (store && args[0].databasePath.endsWith(".next")) {
      const close = store.close.bind(store);
      vi.spyOn(store, "close").mockImplementationOnce(async () => {
        await close();
        for (const suffix of ["-journal", "-wal", "-shm"]) {
          await writeFile(`${args[0].databasePath}${suffix}`, "x".repeat(4096));
        }
        throw new Error("synthetic candidate close failure");
      });
    }
    return store;
  });
  settings.maxBytes = 1_800_000;
  await expect(owner.list()).rejects.toThrow("synthetic candidate close failure");
  settings.maxBytes = 2 * 1024 * 1024;
  const sampling = { active: true };
  let peak = 0;
  const sampler = (async () => {
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
        sizes.reduce((sum, size) => sum + size, 0),
      );
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
  })();
  try {
    for (let i = 0; i < 8; i++) {
      owner.begin(
        { ...metadata, purpose: `after${i}` },
        { ...batch, state: "x".repeat(300_000) },
      )?.(outcome);
      await owner.list(1);
    }
  } finally {
    sampling.active = false;
    await sampler;
  }
  expect(peak).toBeLessThanOrEqual(settings.maxBytes);
  expect((await readdir(directory)).filter((name) => name.includes(".next"))).toEqual([]);
  expect((await owner.status()).maxBytes).toBe(settings.maxBytes);
  const beforeDelete = (await owner.list()).recordCount;
  settings.maxBytes = 1024 * 1024;
  expect((await owner.delete()).deletedRecords).toBe(beforeDelete);
});
it("reconciles a failed growth before reverted-budget appends", async () => {
  const { owner, settings, directory } = await fixture();
  settings.enabled = true;
  owner.begin(metadata, batch)?.(outcome);
  await owner.list();
  await owner.close();
  // Offline fixture custody: fail the real worker's budget update after its PRAGMA changed.
  const offline = openNodeSqliteDatabase(path.join(directory, "pool.sqlite"));
  try {
    offline.exec(
      "CREATE TRIGGER reject_growth BEFORE UPDATE ON budget WHEN NEW.max_bytes > OLD.max_bytes BEGIN SELECT RAISE(ABORT, 'synthetic growth budget failure'); END;",
    );
  } finally {
    offline.close();
  }
  settings.maxBytes = 8 * 1024 * 1024;
  await expect(owner.list()).rejects.toThrow("synthetic growth budget failure");
  settings.maxBytes = 2 * 1024 * 1024;
  owner.window("start");
  for (let i = 0; i < 80; i++) {
    owner.begin(
      { ...metadata, purpose: `after${i}` },
      { ...batch, state: "x".repeat(60_000) },
    )?.(outcome);
    const page = await owner.list();
    expect(page.maxBytes).toBe(settings.maxBytes);
    expect(page.storageBytes).toBeLessThanOrEqual(settings.maxBytes);
  }
  expect((await owner.list()).recordCount).toBeGreaterThan(0);
});
it("reclaims an unreadable pool without inventing its count, then records future calls", async () => {
  const { owner, settings, directory } = await fixture();
  settings.enabled = true;
  const corrupt = "synthetic broken sqlite";
  await writeFile(path.join(directory, "pool.sqlite"), corrupt);
  await writeFile(path.join(directory, "pool.sqlite.next-journal"), "synthetic");
  const deleted = await owner.delete();
  expect(deleted).toEqual({ deletedRecords: null, freedBytes: Buffer.byteLength(corrupt) + 9 });
  expect(await readdir(directory)).toEqual([]);
  owner.begin(metadata, batch)?.(outcome);
  expect((await owner.list()).recordCount).toBe(1);
});
it("reports the effective pool budget when config changes during a queued status read", async () => {
  const { owner, settings } = await fixture();
  settings.enabled = true;
  owner.begin(metadata, batch)?.(outcome);
  await owner.list();
  const status = owner.status();
  settings.maxBytes = 1024 * 1024;
  expect((await status).maxBytes).toBe(settings.maxBytes);
});
