import type { DecisionBatchV2, DecisionOutcomeV2 } from "./types-v2.js";
import type { DecisionBatch, DecisionOutcome } from "./types.js";

export type DecisionRecording = {
  formatVersion: 1;
  id: string;
  startedAt: number;
  durationMs: number;
  version: 1 | 2;
  purpose: string;
  rubricVersion: string;
  agentId?: string;
  provider?: string;
  model?: string;
  status: "ok" | "unavailable" | "failed";
  reason?: string;
  outcome?: DecisionOutcome | DecisionOutcomeV2;
  input: {
    completeness: "not-enabled" | "complete" | "oversize" | "window-ended" | "unsupported-input";
    batch?: DecisionBatch | DecisionBatchV2;
  };
};
export type DecisionRecordingSummary = Omit<DecisionRecording, "outcome" | "input"> & {
  input: Omit<DecisionRecording["input"], "batch">;
  bytes: number;
};
export type DecisionRecorderStatus = {
  enabled: boolean;
  maxBytes: number;
  configuredMaxBytes: number;
  fullInputWindowMs: number;
  fullInputUntil: number | null;
  recordCount: number;
  storageBytes: number;
  droppedRecords: number;
  lastError: string | null;
};
export type RecorderStoreOperations = {
  append: { input: DecisionRecording; output: { retained: boolean; evicted: number } };
  list: {
    input: { limit: number; cursor?: number };
    output: {
      records: DecisionRecordingSummary[];
      recordCount: number;
      storageBytes: number;
      maxBytes: number;
      nextCursor?: number;
    };
  };
  export: {
    input: { ids: string[]; format: "json" | "jsonl"; preview: boolean };
    output: {
      formatVersion: 1;
      recordCount: number;
      bytes: number;
      format: "json" | "jsonl";
      content?: string;
    };
  };
};
