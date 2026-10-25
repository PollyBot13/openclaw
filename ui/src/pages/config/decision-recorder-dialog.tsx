import { Show } from "solid-js";
import type {
  DecisionRecorderStatus,
  RecorderStoreOperations,
} from "../../../../src/decisions/flight-recorder.types.js";
import { ModalDialog } from "../../components/modal-dialog.tsx";
import { SettingsRow } from "../../components/solid/settings-ui.tsx";
import { downloadTextFile } from "../../lib/download.ts";
type Export = RecorderStoreOperations["export"]["output"];
export type DecisionRecorderDialogState = (
  | { kind: "delete" }
  | { kind: "budget"; bytes: number }
  | { kind: "export"; snapshot: Export }
  | { kind: "detail"; content: string }
) & { isCurrent: () => boolean };

export function DecisionRecorderDialog(props: {
  dialog: DecisionRecorderDialogState | null;
  status: DecisionRecorderStatus | undefined;
  disabled: boolean;
  configDisabled: boolean;
  failure: string | null;
  onClose: () => void;
  onDelete: () => void;
  onBudget: (bytes: number) => void;
  onFormat: (snapshot: Export, format: "json" | "jsonl") => void;
}) {
  return (
    <Show when={props.dialog} keyed>
      {(current) => {
        const title =
          current.kind === "export"
            ? "Export selected decisions"
            : current.kind === "detail"
              ? "Decision details"
              : current.kind === "budget"
                ? "Reduce storage limit?"
                : "Delete stored decisions?";
        return (
          <ModalDialog
            open
            label={title}
            onOpenChange={(open) => {
              if (!open) {
                props.onClose();
              }
            }}
          >
            <div class="card">
              <h2 class="card-title">{title}</h2>
              <Show when={current.kind === "delete"}>
                <p>Remove {props.status?.recordCount ?? "all"} stored decisions?</p>
                <p>This cannot be undone. Downloaded exports are not affected.</p>
                <p>
                  {!props.status
                    ? "The record count and recording state are unavailable."
                    : props.status?.enabled
                      ? "Recording remains on. New calls can still be stored."
                      : "Recording is off."}
                </p>
              </Show>
              <Show when={current.kind === "budget"}>
                <p>Lowering the limit will remove the oldest records until the pool fits.</p>
              </Show>
              {current.kind === "detail" ? (
                <pre
                  class="mono"
                  style={{ "white-space": "pre-wrap", "overflow-wrap": "anywhere" }}
                >
                  {current.content}
                </pre>
              ) : undefined}
              {current.kind === "export" ? (
                <>
                  <p>Download selected answers and captured inputs to this device.</p>
                  <SettingsRow
                    title="Format"
                    control={
                      <select
                        class="settings-select"
                        aria-label="Export format"
                        value={current.snapshot.format}
                        disabled={props.disabled}
                        onChange={(event) =>
                          current.isCurrent() &&
                          props.onFormat(
                            current.snapshot,
                            event.currentTarget.value === "jsonl" ? "jsonl" : "json",
                          )
                        }
                      >
                        <option value="json">JSON</option>
                        <option value="jsonl">JSONL</option>
                      </select>
                    }
                  />
                  <SettingsRow
                    title="Selection"
                    control={<span>{current.snapshot.recordCount} records</span>}
                  />
                  <SettingsRow
                    title="Download size"
                    control={<span>{current.snapshot.bytes.toLocaleString()} bytes</span>}
                  />
                </>
              ) : undefined}
              <Show when={props.failure}>
                <p role="alert">{props.failure}</p>
              </Show>
              <openclaw-modal-actions>
                <button class="btn" autofocus onClick={() => props.onClose()}>
                  {current.kind === "detail" ? "Close" : "Cancel"}
                </button>
                {current.kind === "delete" ? (
                  <button
                    class="btn btn--danger"
                    disabled={props.disabled}
                    onClick={() => {
                      if (current.isCurrent()) {
                        props.onDelete();
                      }
                    }}
                  >
                    Delete stored decisions
                  </button>
                ) : undefined}
                {current.kind === "budget" ? (
                  <button
                    class="btn btn--danger"
                    disabled={props.configDisabled}
                    onClick={() => {
                      if (current.isCurrent()) {
                        props.onBudget(current.bytes);
                      }
                    }}
                  >
                    Reduce limit
                  </button>
                ) : undefined}
                {current.kind === "export" ? (
                  <button
                    class="btn btn--accent"
                    disabled={props.disabled}
                    onClick={() => {
                      if (
                        !props.disabled &&
                        current.isCurrent() &&
                        current.snapshot.content !== undefined
                      ) {
                        downloadTextFile(
                          `decision-recordings.${current.snapshot.format}`,
                          current.snapshot.content,
                          current.snapshot.format === "json"
                            ? "application/json"
                            : "application/x-ndjson",
                        );
                        props.onClose();
                      }
                    }}
                  >
                    Download {current.snapshot.format.toUpperCase()}
                  </button>
                ) : undefined}
              </openclaw-modal-actions>
            </div>
          </ModalDialog>
        );
      }}
    </Show>
  );
}
