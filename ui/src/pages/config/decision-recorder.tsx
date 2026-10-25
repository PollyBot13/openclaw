import {
  Errored,
  For,
  Loading,
  Show,
  action,
  createMemo,
  createOptimistic,
  createSignal,
  isPending,
  onSettled,
} from "solid-js";
import type {
  DecisionRecorderStatus,
  RecorderStoreOperations,
} from "../../../../src/decisions/flight-recorder.types.js";
import { hasOperatorAdminAccess } from "../../app/operator-access.ts";
import {
  SettingsEmpty,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsStatus,
  SettingsToggleRow,
} from "../../components/solid/settings-ui.tsx";
import { formatUiError } from "../../lib/format-error.ts";
import { formatByteSize, formatDateTimeMs } from "../../lib/format.ts";
import { useApplication } from "../../lib/reactive/context.ts";
import { liveValue } from "../../lib/reactive/live-value.ts";
import { createInterval } from "../../lib/reactive/timers.ts";
import {
  DecisionRecorderDialog,
  type DecisionRecorderDialogState,
} from "./decision-recorder-dialog.tsx";
import { createSettingsStatus } from "./settings-status.ts";

type Export = RecorderStoreOperations["export"]["output"];
type List = RecorderStoreOperations["list"]["output"];

const MIB = 1024 * 1024;
const size = (bytes: number) =>
  formatByteSize(bytes, {
    style: "iec",
    maxUnit: "tera",
    separator: " ",
    fractionDigits: (_value, unit) => (unit === "byte" ? 0 : 1),
  });

export function DecisionRecorderSettings(props: { mutationDisabled?: boolean }) {
  const context = useApplication();
  const status = createSettingsStatus<DecisionRecorderStatus>(context, {
    method: "decisionRecorder.status",
    access: hasOperatorAdminAccess,
    configHash: "appliedConfigHash",
    onConnectionChange: retire,
  });
  const [duration, setDuration] = createSignal<string | null>(null);
  const [budget, setBudget] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<string[]>([]);
  const [pages, setPages] = createSignal<(number | undefined)[]>([undefined]);
  const [revision, setRevision] = createSignal(0);
  const [dialog, setDialog] = createSignal<DecisionRecorderDialogState | null>(null);
  const [feedback, setFeedback] = createSignal<string | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [saving, setSaving] = createOptimistic(false);
  const [now, setNow] = createSignal(Date.now());
  let operation: AbortController | null = null;
  let retireOperation: (() => void) | undefined;
  function retire() {
    operation?.abort();
    retireOperation?.();
    operation = null;
    setDialog(null);
    setSelected([]);
    setPages([undefined]);
    setDuration(null);
    setBudget(null);
    setFeedback(null);
    setFailure(null);
    setRevision((value) => value + 1);
  }
  onSettled(() => () => {
    operation?.abort();
    retireOperation?.();
  });
  const currentStatus = () => {
    if (!status.client() || status.pending()) {
      return undefined;
    }
    const result = status.result();
    return result?.isCurrent() ? result.status : undefined;
  };
  const durationText = () =>
    duration() ?? String((currentStatus()?.fullInputWindowMs ?? 900000) / 60000);
  const budgetText = () => budget() ?? String((currentStatus()?.maxBytes ?? 50 * MIB) / MIB);
  const durationMs = () => Number(durationText()) * 60000;
  const budgetBytes = () => Number(budgetText()) * MIB;
  const validDuration = () =>
    Number.isSafeInteger(durationMs()) && durationMs() >= 1000 && durationMs() <= 86400000;
  const validBudget = () =>
    Number.isSafeInteger(budgetBytes()) && budgetBytes() >= MIB && budgetBytes() <= 1024 * MIB;
  const active = () => (currentStatus()?.fullInputUntil ?? 0) > now();
  function disabled(requireStatus = true) {
    status.configProjection.read();
    return (
      props.mutationDisabled ||
      saving() ||
      operation !== null ||
      !status.client() ||
      (requireStatus && !currentStatus())
    );
  }
  function configDisabled() {
    status.configProjection.read();
    const config = context.runtimeConfig;
    return (
      disabled() ||
      !config.canPatch ||
      config.state.configLoading ||
      config.state.configSaving ||
      config.state.configApplying
    );
  }
  function refreshRecords() {
    setRevision((value) => value + 1);
  }
  function refreshAll() {
    status.refresh();
    refreshRecords();
  }
  const records = createMemo(() => {
    revision();
    status.scopeKey();
    const client = status.client();
    const pageCursor = pages().at(-1);
    const isCurrent = status.capture();
    if (!client) {
      return undefined;
    }
    return client
      .request<List>("decisionRecorder.list", { limit: 50, cursor: pageCursor })
      .then((data) => (isCurrent() ? { data, isCurrent } : undefined));
  });
  const run = action(function* (
    task: (
      client: NonNullable<ReturnType<typeof status.client>>,
      isCurrent: () => boolean,
      signal: AbortSignal,
    ) => Promise<void>,
    requireStatus = true,
  ) {
    const client = status.client();
    const ownsConnection = status.capture();
    if (disabled(requireStatus) || !client || !ownsConnection()) {
      return;
    }
    const controller = new AbortController();
    operation = controller;
    const retired = Promise.withResolvers<void>();
    retireOperation = retired.resolve;
    const isCurrent = () => operation === controller && ownsConnection();
    setSaving(true);
    setFeedback(null);
    setFailure(null);
    try {
      yield Promise.race([task(client, isCurrent, controller.signal), retired.promise]);
    } catch (error) {
      if (isCurrent()) {
        setFailure(formatUiError(error));
      }
    } finally {
      if (operation === controller) {
        operation = null;
        retireOperation = undefined;
      }
    }
  });
  async function patch(values: Record<string, number | boolean>, isCurrent: () => boolean) {
    const saved = await context.runtimeConfig.patch({
      raw: { decisionRecorder: values },
      note: "Update Decision recorder",
      canDispatch: isCurrent,
    });
    if (!saved && isCurrent()) {
      throw new Error(
        context.runtimeConfig.state.lastError ?? "Could not save recorder settings. Try again.",
      );
    }
    return saved && isCurrent();
  }
  function toggle(enabled: boolean) {
    if (configDisabled()) {
      return false;
    }
    void run(async (_client, isCurrent) => {
      if (await patch({ enabled }, isCurrent)) {
        refreshAll();
      }
    });
    // The Gateway status, not the click, owns this switch.
    return false;
  }
  function captureWindow(windowAction: "start" | "renew" | "stop") {
    if (windowAction !== "stop" && (configDisabled() || !validDuration())) {
      return;
    }
    const milliseconds = durationMs();
    void run(async (client, isCurrent, signal) => {
      if (
        windowAction !== "stop" &&
        !(await patch({ fullInputWindowMs: milliseconds }, isCurrent))
      ) {
        return;
      }
      // Saving can outlive the originating connection; never start capture on its successor.
      if (!isCurrent()) {
        return;
      }
      await client.request("decisionRecorder.window", { action: windowAction }, { signal });
      if (isCurrent()) {
        if (windowAction !== "stop") {
          setDuration(null);
        }
        refreshAll();
      }
    });
  }
  function applyBudget(bytes: number) {
    void run(async (_client, isCurrent) => {
      if (await patch({ maxBytes: bytes }, isCurrent)) {
        setBudget(null);
        setDialog(null);
        setSelected([]);
        setPages([undefined]);
        refreshAll();
      }
    });
  }
  function prepareExport(ids: string[], detail = false) {
    void run(async (client, isCurrent, signal) => {
      // One prepared snapshot supplies both the displayed size and the downloaded bytes.
      const snapshot = await client.request<Export>(
        "decisionRecorder.export",
        { ids, format: "json", preview: false },
        { signal },
      );
      if (!isCurrent()) {
        return;
      }
      if (snapshot.content === undefined) {
        throw new Error("Export content is unavailable. Refresh and select the records again.");
      }
      setDialog(
        detail
          ? {
              kind: "detail",
              content: JSON.stringify(JSON.parse(snapshot.content), null, 2),
              isCurrent: status.capture(),
            }
          : { kind: "export", snapshot, isCurrent: status.capture() },
      );
    });
  }
  function changeExportFormat(snapshot: Export, format: "json" | "jsonl") {
    if (snapshot.content === undefined || snapshot.format === format) {
      return;
    }
    let lines: string[];
    if (snapshot.format === "json") {
      // SAFETY: The Gateway export contract supplies a JSON array of selected records.
      const exportedRecords = JSON.parse(snapshot.content) as unknown[];
      lines = exportedRecords.map((value) => JSON.stringify(value));
    } else {
      lines = snapshot.content.trimEnd().split("\n");
    }
    const content = format === "json" ? `[${lines.join(",")}]` : `${lines.join("\n")}\n`;
    setDialog({
      kind: "export",
      isCurrent: status.capture(),
      snapshot: { ...snapshot, format, content, bytes: new TextEncoder().encode(content).length },
    });
  }
  function deleteRecords() {
    // Recovery deletion must work even when the pool cannot supply readable status.
    void run(async (client, isCurrent, signal) => {
      await client.request("decisionRecorder.delete", {}, { signal });
      if (isCurrent()) {
        setDialog(null);
        setSelected([]);
        setPages([undefined]);
        refreshAll();
        setFeedback("Stored decisions deleted. Downloaded exports were not affected.");
      }
    }, false);
  }
  function RecordsList() {
    const list = () => {
      const result = records();
      return result?.isCurrent() ? result.data : undefined;
    };
    return (
      <Show when={list()} fallback={<SettingsEmpty message="No stored decisions." />}>
        {(data) => (
          <>
            <Show
              when={data().records.length}
              fallback={<SettingsEmpty message="No stored decisions." />}
            >
              <SettingsRow
                title={
                  <label>
                    <input
                      type="checkbox"
                      aria-label="Select visible records"
                      checked={data().records.every((row) => selected().includes(row.id))}
                      onChange={(event) => {
                        const visible = data().records.map((row) => row.id);
                        const checked = event.currentTarget.checked;
                        setSelected((ids) =>
                          checked
                            ? [...new Set([...ids, ...visible])]
                            : ids.filter((id) => !visible.includes(id)),
                        );
                      }}
                    />{" "}
                    Select visible records
                  </label>
                }
                control={<span>{selected().length} selected</span>}
              />
              <For each={data().records} keyed={(record) => record.id}>
                {(record) => (
                  <SettingsRow
                    title={
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`Select ${record().purpose}`}
                          checked={selected().includes(record().id)}
                          onChange={(event) => {
                            const id = record().id;
                            const checked = event.currentTarget.checked;
                            setSelected((ids) =>
                              checked ? [...ids, id] : ids.filter((value) => value !== id),
                            );
                          }}
                        />{" "}
                        {record().purpose}
                      </label>
                    }
                    description={
                      <>
                        {formatDateTimeMs(record().startedAt)} · {record().status} ·{" "}
                        {record().input.completeness === "complete"
                          ? "Input captured"
                          : record().input.completeness === "oversize"
                            ? "Input omitted · size limit"
                            : record().input.completeness === "unsupported-input"
                              ? "Input unavailable"
                              : "Input not captured"}
                      </>
                    }
                    control={
                      <button
                        class="btn"
                        disabled={disabled()}
                        onClick={() => prepareExport([record().id], true)}
                      >
                        View
                      </button>
                    }
                  />
                )}
              </For>
            </Show>
            <Show when={pages().length > 1 || data().nextCursor !== undefined}>
              <SettingsRow
                title="Pages"
                control={
                  <>
                    <button
                      class="btn"
                      disabled={isPending(records) || pages().length <= 1}
                      onClick={() => {
                        if (!isPending(records) && pages().length > 1) {
                          setPages((previous) => previous.slice(0, -1));
                        }
                      }}
                    >
                      Previous
                    </button>
                    <button
                      class="btn"
                      disabled={isPending(records) || data().nextCursor === undefined}
                      onClick={() => {
                        const next = data().nextCursor;
                        if (!isPending(records) && next !== undefined) {
                          setPages((previous) => [...previous, next]);
                        }
                      }}
                    >
                      Next
                    </button>
                  </>
                }
              />
            </Show>
          </>
        )}
      </Show>
    );
  }
  function RecorderContent() {
    createInterval(
      () => {
        setNow(Date.now());
        if ((currentStatus()?.fullInputUntil ?? 0) > 0 && !active() && !status.pending()) {
          status.refresh();
        }
      },
      () => (currentStatus()?.fullInputUntil ? 1000 : undefined),
    );
    const durationValue = liveValue(createMemo(durationText));
    const budgetValue = liveValue(createMemo(budgetText));
    return (
      <SettingsPage>
        <SettingsSection
          title="Recording"
          actions={
            <>
              <SettingsStatus
                kind={active() ? "accent" : currentStatus()?.enabled ? "ok" : "muted"}
                label={
                  !currentStatus()
                    ? "Status unavailable"
                    : active()
                      ? "Full-input capture"
                      : currentStatus()?.enabled
                        ? "Basic recording"
                        : "Recording off"
                }
              />
              <button
                class="btn"
                disabled={!status.client() || status.pending()}
                onClick={refreshAll}
              >
                Refresh
              </button>
            </>
          }
        >
          <SettingsToggleRow
            title="Record decisions"
            description="Store metadata and the typed answer for every Decision call."
            checked={currentStatus()?.enabled === true}
            disabled={configDisabled()}
            onChange={toggle}
          />
          <div class="settings-row settings-row--stacked">
            <div class="settings-row__text">
              <span class="settings-row__title">Full-input capture</span>
              <span class="settings-row__desc" id="decision-capture-help">
                Also store Decision state, questions, and rubric. Recorded answers and inputs may
                contain private data.
              </span>
            </div>
            <div class="settings-row__control">
              <SettingsStatus
                kind={active() ? "accent" : "muted"}
                label={
                  active()
                    ? `Active · ${Math.ceil(((currentStatus()?.fullInputUntil ?? 0) - now()) / 1000)}s remaining`
                    : "Off"
                }
              />
              <button
                class="btn"
                aria-describedby="decision-capture-help"
                disabled={configDisabled() || !currentStatus()?.enabled || !validDuration()}
                onClick={() => captureWindow(active() ? "renew" : "start")}
              >
                {active() ? `Renew for ${durationText()} min` : "Start capture"}
              </button>
              <Show when={active()}>
                <button class="btn" disabled={disabled()} onClick={() => captureWindow("stop")}>
                  Stop capture
                </button>
              </Show>
            </div>
            <Show when={!currentStatus()?.enabled}>
              <span class="settings-row__desc">Turn on recording first.</span>
            </Show>
            <div class="settings-row__control">
              <label for="decision-duration">Duration</label>
              <input
                id="decision-duration"
                class="settings-input"
                type="number"
                min={1 / 60}
                max="1440"
                step="any"
                required
                disabled={disabled()}
                ref={durationValue}
                onInput={(event) => setDuration(event.currentTarget.value)}
                aria-describedby="decision-duration-unit"
              />
              <span id="decision-duration-unit">minutes</span>
              <span class="settings-row__desc">For the next start or renewal.</span>
            </div>
          </div>
        </SettingsSection>
        <Errored fallback={(error) => <p role="alert">{formatUiError(error())}</p>}>
          <Show when={!status.pending() && !status.read()}>
            <p role="status">Connect with administrator access to manage recordings.</p>
          </Show>
        </Errored>
        <Show when={failure()}>
          <p role="alert">{failure()}</p>
        </Show>
        <Show when={feedback()}>
          <p role="status">{feedback()}</p>
        </Show>
        <SettingsSection
          title="Storage"
          notice={
            currentStatus()?.lastError ? (
              <p role="alert">Some decisions could not be stored: {currentStatus()?.lastError}</p>
            ) : undefined
          }
        >
          <SettingsRow
            title="Total storage limit"
            control={
              <>
                <input
                  class="settings-input"
                  type="number"
                  min="1"
                  max="1024"
                  step="1"
                  required
                  aria-label="Total storage limit in MiB"
                  disabled={disabled()}
                  ref={budgetValue}
                  onInput={(event) => setBudget(event.currentTarget.value)}
                />
                <span>MiB</span>
                <button
                  class="btn"
                  disabled={
                    configDisabled() ||
                    !validBudget() ||
                    budgetBytes() === currentStatus()?.maxBytes
                  }
                  onClick={() => {
                    const bytes = budgetBytes();
                    if (bytes < (currentStatus()?.maxBytes ?? 0)) {
                      setDialog({ kind: "budget", bytes, isCurrent: status.capture() });
                    } else {
                      applyBudget(bytes);
                    }
                  }}
                >
                  Apply
                </button>
              </>
            }
          />
          <SettingsRow
            title="Storage used"
            description="Oldest records are replaced when storage is full. Records are kept until then or until deleted."
            control={
              <>
                <meter
                  min="0"
                  max={currentStatus()?.maxBytes ?? 1}
                  value={currentStatus()?.storageBytes ?? 0}
                  aria-label="Stored bytes out of total storage limit"
                />
                <span>
                  {currentStatus()
                    ? `${currentStatus()?.recordCount} records · ${size(currentStatus()?.storageBytes ?? 0)} / ${size(currentStatus()?.maxBytes ?? 0)}`
                    : "Unavailable"}
                </span>
              </>
            }
          />
          <SettingsRow
            title="Clear stored decisions"
            control={
              <button
                class="btn btn--danger"
                disabled={disabled(false) || currentStatus()?.recordCount === 0}
                onClick={() => setDialog({ kind: "delete", isCurrent: status.capture() })}
              >
                Delete stored decisions…
              </button>
            }
          />
        </SettingsSection>
        <SettingsSection
          title="Stored decisions"
          actions={
            <>
              <button
                class="btn"
                disabled={disabled() || !selected().length}
                onClick={() => setSelected([])}
              >
                Clear selection
              </button>
              <button
                class="btn"
                disabled={disabled() || !selected().length}
                onClick={() => prepareExport([...selected()])}
              >
                Export selected…
              </button>
            </>
          }
        >
          <Errored
            fallback={(error) => (
              <SettingsEmpty
                message={<span role="alert">{formatUiError(error())} Refresh to try again.</span>}
              />
            )}
          >
            <Loading
              on={status.scopeKey()}
              fallback={<SettingsEmpty message="Loading decisions…" />}
            >
              <RecordsList />
            </Loading>
          </Errored>
        </SettingsSection>
        <DecisionRecorderDialog
          dialog={status.client() ? dialog() : null}
          status={currentStatus()}
          disabled={disabled(dialog()?.kind !== "delete")}
          configDisabled={configDisabled()}
          failure={failure()}
          onClose={() => setDialog(null)}
          onDelete={deleteRecords}
          onBudget={applyBudget}
          onFormat={changeExportFormat}
        />
      </SettingsPage>
    );
  }
  return (
    <Loading fallback={<SettingsEmpty message="Loading recorder…" />}>
      <RecorderContent />
    </Loading>
  );
}
