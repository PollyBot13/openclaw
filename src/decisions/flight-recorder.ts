import { randomUUID } from "node:crypto";
import { rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { getRuntimeConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { registerRuntimeConfigSnapshotPreparer } from "../config/runtime-snapshot.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveRuntimeProcessEntrypointUrl } from "../infra/runtime-process-url.js";
import { openSqliteWorkerStore, type SqliteWorkerStore } from "../infra/sqlite-worker-store.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type {
  DecisionRecording,
  DecisionRecorderStatus,
  RecorderStoreOperations,
} from "./flight-recorder.types.js";
import { finiteJson } from "./validation-common.js";

const poolFileSuffixes = ["", "-journal", "-wal", "-shm"];

type Settings = NonNullable<OpenClawConfig["decisionRecorder"]>;
type Batch = NonNullable<DecisionRecording["input"]["batch"]>;
export const decisionRecorderDefaults = {
  enabled: false,
  maxBytes: 52_428_800,
  fullInputWindowMs: 900_000,
};

/** One queue owns the dedicated pool, input window, and deletion boundary. */
export class DecisionFlightRecorder {
  private tail: Promise<unknown> = Promise.resolve();
  private store?: SqliteWorkerStore<RecorderStoreOperations>;
  private storeBudget?: number;
  private candidate?: SqliteWorkerStore<RecorderStoreOperations>;
  private generation = 0;
  private pendingBytes = 0;
  private fullInputUntil: number | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private inputs = new Map<string, { batch: Batch; bytes: number }>();
  private inputBytes = 0;
  private pendingRecords = new Set<DecisionRecording>();
  private droppedRecords = 0;
  private lastError: string | null = null;
  constructor(
    private databasePath: string,
    private config: () => Settings | undefined,
    private now = Date.now,
  ) {}
  private settings() {
    return { ...decisionRecorderDefaults, ...this.config() };
  }
  private stopWindow() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.fullInputUntil = null;
    this.inputs.clear();
    this.inputBytes = 0;
    for (const record of this.pendingRecords) {
      if (record.input.batch) {
        record.input = { completeness: "window-ended" };
      }
    }
  }
  configure(settings: Settings | undefined) {
    if (!settings?.enabled) {
      this.generation++;
      this.stopWindow();
    }
  }
  window(action: "start" | "renew" | "stop", assertCurrent = () => {}) {
    assertCurrent();
    if (action === "stop") {
      this.stopWindow();
      return;
    }
    const settings = this.settings();
    if (!settings.enabled) {
      throw new Error("Enable basic recording before starting full-input capture.");
    }
    if (action === "renew" && (!this.fullInputUntil || this.fullInputUntil <= this.now())) {
      throw new Error("No active full-input window to renew.");
    }
    if (this.fullInputUntil !== null && this.fullInputUntil <= this.now()) {
      this.stopWindow();
    }
    clearTimeout(this.timer);
    this.fullInputUntil = this.now() + settings.fullInputWindowMs;
    this.timer = setTimeout(() => this.stopWindow(), settings.fullInputWindowMs);
    this.timer.unref?.();
  }
  begin(
    metadata: Omit<DecisionRecording, "id" | "startedAt" | "durationMs" | "status" | "input">,
    batch: Batch,
  ) {
    const settings = this.settings();
    if (!settings.enabled) {
      this.stopWindow();
      return undefined;
    }
    const generation = this.generation;
    const id = randomUUID();
    const startedAt = this.now();
    let completeness: DecisionRecording["input"]["completeness"] = "not-enabled";
    if (this.fullInputUntil !== null && this.fullInputUntil > startedAt) {
      // Capture must not execute getters/proxies that the Decision contract rejects.
      const shape = finiteJson(batch, {
        maxBytes: Math.min(settings.maxBytes / 4, 8 * 1024 * 1024),
        rejectProxies: true,
      });
      completeness = shape === "invalid" ? "unsupported-input" : "oversize";
      if (shape === "valid") {
        const json = JSON.stringify(batch);
        const bytes = Buffer.byteLength(json);
        if (
          this.pendingBytes + this.inputBytes + bytes <=
          Math.min(settings.maxBytes, 8 * 1024 * 1024)
        ) {
          // SAFETY: finiteJson admitted this Batch; parsing its JSON preserves that shape.
          this.inputs.set(id, { batch: JSON.parse(json) as Batch, bytes });
          this.inputBytes += bytes;
          completeness = "complete";
        }
      }
    }

    return (outcome?: DecisionRecording["outcome"], aborted = false) => {
      const captured = this.inputs.get(id);
      const input = captured?.batch;
      this.inputs.delete(id);
      this.inputBytes -= captured?.bytes ?? 0;
      if (generation !== this.generation || !this.settings().enabled) {
        return;
      }
      const stillInWindow = this.fullInputUntil !== null && this.fullInputUntil > this.now();
      let record: DecisionRecording = {
        ...metadata,
        id,
        startedAt,
        durationMs: Math.max(0, this.now() - startedAt),
        status: outcome?.status ?? "failed",
        ...(outcome
          ? { outcome, ...(outcome.status === "unavailable" ? { reason: outcome.reason } : {}) }
          : { reason: aborted ? "aborted" : "error" }),
        input:
          input && stillInWindow
            ? { completeness: "complete", batch: input }
            : { completeness: completeness === "complete" ? "window-ended" : completeness },
      };
      const json = JSON.stringify(record);
      const bytes = Buffer.byteLength(json);
      if (
        this.pendingBytes + this.inputBytes + bytes >
        Math.min(settings.maxBytes, 8 * 1024 * 1024)
      ) {
        this.droppedRecords++;
        return;
      }
      // The returned provider outcome belongs to its caller; retain a snapshot.
      // SAFETY: json was serialized from the typed record immediately above.
      record = JSON.parse(json) as DecisionRecording;
      this.pendingBytes += bytes;
      this.pendingRecords.add(record);
      void this.enqueue(async () => {
        try {
          if (generation !== this.generation || !this.settings().enabled) {
            return;
          }
          if (record.input.batch && (!this.fullInputUntil || this.fullInputUntil <= this.now())) {
            record.input = { completeness: "window-ended" };
          }
          const store = await this.open(false);
          if (generation !== this.generation || !this.settings().enabled) {
            return;
          }
          if (record.input.batch && (!this.fullInputUntil || this.fullInputUntil <= this.now())) {
            record.input = { completeness: "window-ended" };
          }
          const result = await store?.execute({ type: "append", input: record });
          if (!result?.retained) {
            this.droppedRecords++;
          }
        } catch {
          this.lastError =
            "Recording failed; local storage unavailable. Decision evaluation was unaffected.";
          this.droppedRecords++;
        } finally {
          this.pendingBytes -= bytes;
          this.pendingRecords.delete(record);
        }
      });
    };
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation);
    this.tail = pending.catch(() => undefined);
    return pending;
  }
  private async discardCandidate() {
    await this.candidate?.close();
    this.candidate = undefined;
    for (const suffix of poolFileSuffixes) {
      await rm(`${this.databasePath}.next${suffix}`, { force: true });
    }
  }
  private async open(existingOnly: boolean, resize = true) {
    if (this.candidate) {
      await this.discardCandidate();
    }
    const { maxBytes } = this.settings();
    if (!this.store) {
      this.store = await openSqliteWorkerStore<RecorderStoreOperations>({
        moduleUrl: resolveRuntimeProcessEntrypointUrl("decisionRecorderStore"),
        databasePath: this.databasePath,
        input: { maxBytes },
        existingOnly,
      });
      this.storeBudget = undefined;
    }
    if (resize && this.store && this.storeBudget !== maxBytes) {
      let resized: RecorderStoreOperations["resize"]["output"];
      try {
        resized = await this.store.execute({ type: "resize", input: { maxBytes } });
      } catch (error) {
        // A failed resize may have changed SQLite's native cap before its budget commit.
        this.storeBudget = undefined;
        await this.store.close();
        this.store = undefined;
        throw error;
      }
      if (resized.replace) {
        const candidatePath = `${this.databasePath}.next`;
        try {
          await this.discardCandidate();
          this.candidate = await openSqliteWorkerStore<RecorderStoreOperations>({
            moduleUrl: resolveRuntimeProcessEntrypointUrl("decisionRecorderStore"),
            databasePath: candidatePath,
            input: { maxBytes, sourcePath: this.databasePath },
          });
          await this.candidate.close();
          this.candidate = undefined;
          await this.store.close();
          this.store = undefined;
          await rename(candidatePath, this.databasePath);
          this.store = await openSqliteWorkerStore<RecorderStoreOperations>({
            moduleUrl: resolveRuntimeProcessEntrypointUrl("decisionRecorderStore"),
            databasePath: this.databasePath,
            input: { maxBytes },
            existingOnly: true,
          });
        } catch (error) {
          // Retire original writes before reclaiming replacement/journal headroom.
          // A failed close stays owned and sealed for a later close/delete retry.
          this.storeBudget = undefined;
          try {
            await this.store?.close();
            this.store = undefined;
          } finally {
            await this.discardCandidate();
          }
          throw error;
        }
      }
      this.storeBudget = maxBytes;
    }
    return this.store;
  }
  async list(limit = 50, cursor?: number): Promise<RecorderStoreOperations["list"]["output"]> {
    return this.enqueue(
      async () =>
        (await this.open(true))?.execute({ type: "list", input: { limit, cursor } }) ?? {
          records: [],
          recordCount: 0,
          storageBytes: 0,
          maxBytes: this.settings().maxBytes,
        },
    );
  }
  async status(): Promise<DecisionRecorderStatus> {
    const settings = this.settings();
    if (!settings.enabled || (this.fullInputUntil !== null && this.fullInputUntil <= this.now())) {
      this.stopWindow();
    }
    const pool = await this.list(1);
    return {
      ...settings,
      maxBytes: pool.maxBytes,
      fullInputUntil: this.fullInputUntil,
      recordCount: pool.recordCount,
      storageBytes: pool.storageBytes,
      droppedRecords: this.droppedRecords,
      lastError: this.lastError,
    };
  }
  async export(input: RecorderStoreOperations["export"]["input"]) {
    return this.enqueue(async () => {
      const store = await this.open(true);
      if (!store) {
        if (input.ids.length) {
          throw new Error("Selected records were evicted or deleted; refresh the list.");
        }
        return {
          formatVersion: 1 as const,
          recordCount: 0,
          bytes: input.format === "json" ? 2 : 0,
          format: input.format,
          ...(input.preview ? {} : { content: input.format === "json" ? "[]" : "" }),
        };
      }
      return store.execute({ type: "export", input });
    });
  }
  async delete(assertCurrent = () => {}) {
    assertCurrent();
    this.generation++;
    this.inputs.clear();
    this.inputBytes = 0;
    return this.enqueue(async () => {
      assertCurrent();
      const files = poolFileSuffixes.flatMap((suffix) => [
        `${this.databasePath}${suffix}`,
        `${this.databasePath}.next${suffix}`,
      ]);
      let freedBytes = 0;
      for (const file of files) {
        try {
          freedBytes += (await stat(file)).size;
        } catch {
          // Missing pool files are already reclaimed.
        }
      }
      let deletedRecords: number | null = null;
      try {
        const store = await this.open(true, false);
        deletedRecords = store
          ? (await store.execute({ type: "list", input: { limit: 1 } })).recordCount
          : 0;
      } catch {
        // Reclamation must remain available when count/integrity reads fail.
      }
      await this.candidate?.close();
      this.candidate = undefined;
      await this.store?.close();
      this.store = undefined;
      this.storeBudget = undefined;
      for (const file of files) {
        assertCurrent();
        await rm(file, { force: true });
      }
      this.lastError = null;
      return { deletedRecords, freedBytes };
    });
  }
  async close() {
    this.generation++;
    this.stopWindow();
    await this.tail;
    await this.discardCandidate();
    await this.store?.close();
    this.store = undefined;
  }
}

export function getDecisionFlightRecorder() {
  return resolveGlobalSingleton(
    Symbol.for("openclaw.decisionFlightRecorder"),
    () => {
      const owner = new DecisionFlightRecorder(
        path.join(resolveStateDir(), "decision-recorder", "pool.sqlite"),
        () => getRuntimeConfig().decisionRecorder,
      );
      registerRuntimeConfigSnapshotPreparer((config) => owner.configure(config.decisionRecorder));
      return owner;
    },
    (owner) => owner.close(),
    "close-and-restart",
  );
}
