import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
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
it("keeps the pool budget and records across config changes/restart, applying a new limit only after deletion", async () => {
  const { owner, settings } = await fixture();
  settings.enabled = true;
  for (let i = 0; i < 3; i++) {
    owner.begin({ ...metadata, purpose: `call${i}` }, batch)?.(outcome);
  }
  const original = await owner.list(1);
  for (const maxBytes of [1024 * 1024, 8 * 1024 * 1024]) {
    settings.maxBytes = maxBytes;
    await owner.close();
    expect(await owner.status()).toMatchObject({
      maxBytes: 2 * 1024 * 1024,
      configuredMaxBytes: maxBytes,
    });
    const page = await owner.list(1);
    expect(page.records[0]?.id).toBe(original.records[0]?.id);
    expect((await owner.list(1, page.nextCursor)).records[0]?.purpose).toBe("call1");
    const ids = [page.records[0]!.id];
    const preview = await owner.export({ ids, format: "jsonl", preview: true });
    const exported = await owner.export({ ids, format: "jsonl", preview: false });
    expect(preview.bytes).toBe(Buffer.byteLength(exported.content!));
    expect(exported.formatVersion).toBe(1);
  }
  await expect(owner.export({ ids: ["evicted"], format: "json", preview: true })).rejects.toThrow(
    "evicted or deleted",
  );
  settings.maxBytes = 1024 * 1024;
  owner.window("start");
  owner.begin(
    { ...metadata, purpose: "fixed-budget-input" },
    { ...batch, state: "x".repeat(300_000) },
  )?.(outcome);
  const captured = (await owner.list(1)).records[0]!;
  expect(captured.input.completeness).toBe("complete");
  const capturedExport = await owner.export({
    ids: [captured.id],
    format: "json",
    preview: false,
  });
  expect(JSON.parse(capturedExport.content!)[0].input.batch.state).toHaveLength(300_000);
  expect((await owner.delete()).deletedRecords).toBe(4);
  owner.begin(metadata, batch)?.(outcome);
  expect(await owner.status()).toMatchObject({ maxBytes: settings.maxBytes, recordCount: 1 });
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

it("reclaims an unreadable pool without inventing its count, then records future calls", async () => {
  const { owner, settings, directory } = await fixture();
  settings.enabled = true;
  const corrupt = "synthetic broken sqlite";
  await writeFile(path.join(directory, "pool.sqlite"), corrupt);
  const deleted = await owner.delete();
  expect(deleted).toEqual({ deletedRecords: null, freedBytes: Buffer.byteLength(corrupt) });
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
  expect(await status).toMatchObject({
    maxBytes: 2 * 1024 * 1024,
    configuredMaxBytes: 2 * 1024 * 1024,
  });
});
