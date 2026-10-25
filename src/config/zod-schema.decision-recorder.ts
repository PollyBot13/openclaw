import { z } from "zod";
import { projectConfigFieldMetadata } from "./schema.field-metadata.js";
import { configUiMetadata } from "./zod-schema.sensitive.js";

export const DecisionRecorderConfigSchema = z
  .strictObject({
    enabled: z.boolean().optional().register(configUiMetadata, {
      label: "Decision Flight Recorder",
      help: "Opt in to private local Decision metadata and typed answers. Disabled by default. Full inputs require a separate finite capture window.",
    }),
    maxBytes: z
      .number()
      .int()
      .min(1024 * 1024)
      .max(1024 * 1024 * 1024)
      .optional()
      .register(configUiMetadata, {
        label: "Recording Pool Budget (bytes)",
        help: "Total dedicated SQLite pool and rollback-journal budget. Defaults to 50 MiB; about half is reserved for safe journal headroom. Fixed when the pool is created; delete the pool to apply a changed budget. Oldest records rotate out; there is no age expiry.",
      }),
    fullInputWindowMs: z
      .number()
      .int()
      .min(1000)
      .max(24 * 60 * 60 * 1000)
      .optional()
      .register(configUiMetadata, {
        label: "Full Input Capture Window (ms)",
        help: "Finite duration for an explicitly started or renewed full-input window. Defaults to 15 minutes. Stops automatically; never resumes after restart.",
      }),
  })
  .optional()
  .register(configUiMetadata, { label: "Decision recorder" });

export const { labels: DECISION_RECORDER_FIELD_LABELS, help: DECISION_RECORDER_FIELD_HELP } =
  projectConfigFieldMetadata(DecisionRecorderConfigSchema, "decisionRecorder");
