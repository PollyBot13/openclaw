import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  DecisionRecorderStatus,
  RecorderStoreOperations,
} from "../../../../src/decisions/flight-recorder.types.js";
import { createDeferred } from "../../../../test/helpers/promise.js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import * as downloads from "../../lib/download.ts";
import { installDialogPolyfill } from "../../test-helpers/modal-dialog.ts";
import { flush, waitForSolid } from "../../test-helpers/solid-settle.ts";
import { DecisionRecorderSettings } from "./decision-recorder.tsx";
import {
  clickSettings,
  mountConfigSettings,
  settingsButton,
  waitSettingsText,
} from "./settings-page.test-support.ts";

let restoreDialog: () => void;
beforeEach(() => {
  restoreDialog = installDialogPolyfill();
});
afterEach(() => restoreDialog());
async function mount(overrides: Partial<DecisionRecorderStatus> = {}, mutationDisabled = false) {
  let status: DecisionRecorderStatus = {
    enabled: false,
    maxBytes: 50 * 1048576,
    fullInputWindowMs: 900000,
    fullInputUntil: null,
    recordCount: 1,
    storageBytes: 4096,
    droppedRecords: 0,
    lastError: null,
    ...overrides,
  };
  let config = {
    decisionRecorder: {
      enabled: status.enabled,
      maxBytes: status.maxBytes,
      fullInputWindowMs: status.fullInputWindowMs,
    },
    untouched: "keep",
  };
  let hash = 1;
  const content = '[{"formatVersion":1,"id":"one","answer":"héllo"}]';
  const respond = async (method: string, params?: unknown): Promise<unknown> => {
    if (method === "decisionRecorder.status") {
      return { ...status };
    }
    if (method === "decisionRecorder.list") {
      return {
        records: status.recordCount
          ? [
              {
                id: "one",
                formatVersion: 1,
                startedAt: 123456,
                durationMs: 1,
                version: 2,
                purpose: "Synthetic choice",
                rubricVersion: "1",
                status: "ok",
                input: { completeness: "complete" },
                bytes: 100,
              },
            ]
          : [],
        recordCount: status.recordCount,
        storageBytes: status.storageBytes,
        maxBytes: status.maxBytes,
      };
    }
    if (method === "decisionRecorder.export") {
      // SAFETY: This test transport receives the production recorder's declared RPC input.
      const requestInput = params as RecorderStoreOperations["export"]["input"];
      const text = requestInput.format === "json" ? content : content.slice(1, -1) + "\n";
      return {
        formatVersion: 1,
        recordCount: 1,
        format: requestInput.format,
        bytes: new TextEncoder().encode(text).length,
        content: text,
      };
    }
    if (method === "decisionRecorder.window") {
      // SAFETY: Production only supplies the three recorder window actions.
      const requestInput = params as { action: string };
      status.fullInputUntil =
        requestInput.action === "stop" ? null : Date.now() + status.fullInputWindowMs;
      return { ...status };
    }
    if (method === "decisionRecorder.delete") {
      status.recordCount = 0;
      status.storageBytes = 0;
      return { deletedRecords: 1, freedBytes: 4096 };
    }
    if (method === "config.patch") {
      // SAFETY: Runtime config serializes its independently admitted patch as JSON.
      const patch = JSON.parse((params as { raw: string }).raw);
      config = {
        ...config,
        decisionRecorder: { ...config.decisionRecorder, ...patch.decisionRecorder },
      };
      status = { ...status, ...patch.decisionRecorder };
      if (!status.enabled) {
        status.fullInputUntil = null;
      }
      hash++;
      return { config: structuredClone(config), hash: String(hash) };
    }
    if (method === "config.get") {
      return {
        config: structuredClone(config),
        raw: JSON.stringify(config),
        hash: String(hash),
        configRevisionHash: String(hash),
        appliedConfigHash: String(hash),
        valid: true,
        issues: [],
      };
    }
    throw new Error(`Unexpected RPC ${method}`);
  };
  const request = vi.fn(respond);
  // SAFETY: The fixture only exercises the request transport of this client.
  const client = { request } as unknown as GatewayBrowserClient;
  const mounted = await mountConfigSettings(client, () => (
    <DecisionRecorderSettings mutationDisabled={mutationDisabled} />
  ));
  await waitSettingsText(mounted.page, "Synthetic choice");
  await waitForSolid(() => expect(settingsButton(mounted.page, "Refresh").disabled).toBe(false));
  return { ...mounted, request, respond, content };
}
function input(page: HTMLElement, selector: string, value: string) {
  const field = page.querySelector<HTMLInputElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
}
function selectRecord(page: HTMLElement) {
  const field = page.querySelector<HTMLInputElement>(
    'input[aria-label="Select Synthetic choice"]',
  )!;
  field.click();
  flush();
}
it("saves only capture duration before start and stops without saving a duration draft", async () => {
  const { page, request } = await mount({ enabled: true });
  input(page, "#decision-duration", "2");
  clickSettings(page, "Start capture", true);
  await waitSettingsText(page, "Stop capture");
  const patchIndex = request.mock.calls.findIndex(([method]) => method === "config.patch");
  const startIndex = request.mock.calls.findIndex(
    ([method]) => method === "decisionRecorder.window",
  );
  expect(patchIndex).toBeLessThan(startIndex);
  const patchCall = request.mock.calls[patchIndex];
  if (!patchCall) {
    throw new Error("Expected capture duration config patch");
  }
  expect(JSON.parse((patchCall[1] as { raw: string }).raw)).toEqual({
    decisionRecorder: { fullInputWindowMs: 120000 },
  });
  input(page, "#decision-duration", "7");
  clickSettings(page, "Stop capture", true);
  await waitSettingsText(page, "Start capture");
  expect(request.mock.calls.filter(([method]) => method === "config.patch")).toHaveLength(1);
  expect(page.querySelector<HTMLInputElement>("#decision-duration")?.value).toBe("7");
});
it("does not start full capture after its saved duration settles on a replaced connection", async () => {
  const { page, request, respond, publish, client } = await mount({ enabled: true });
  const held = createDeferred<unknown>();
  request.mockImplementation((method, params) =>
    method === "config.patch" ? held.promise : respond(method, params),
  );
  clickSettings(page, "Start capture", true);
  await waitForSolid(() =>
    expect(request.mock.calls.some(([method]) => method === "config.patch")).toBe(true),
  );
  publish(false, client);
  publish(true, client);
  held.resolve({
    config: { decisionRecorder: { enabled: true, fullInputWindowMs: 900000 } },
    hash: "2",
  });
  await held.promise;
  flush();
  await waitForSolid(() => expect(settingsButton(page, "Start capture").disabled).toBe(false));
  expect(
    request.mock.calls.filter(([method]) => method === "decisionRecorder.window"),
  ).toHaveLength(0);
});
it("shows exact prepared bytes and downloads that snapshot, then clears sensitive dialogs on disconnect", async () => {
  const { page, request, content, publish, client } = await mount();
  const download = vi.spyOn(downloads, "downloadTextFile").mockImplementation(() => {});
  selectRecord(page);
  clickSettings(page, "Export selected…", true);
  await waitSettingsText(page, "Download JSON");
  expect(page.textContent).toContain(`${new TextEncoder().encode(content).length} bytes`);
  clickSettings(page, "Download JSON", true);
  expect(download).toHaveBeenCalledWith("decision-recordings.json", content, "application/json");
  expect(
    request.mock.calls.filter(([method]) => method === "decisionRecorder.export"),
  ).toHaveLength(1);
  clickSettings(page, "Export selected…", true);
  await waitSettingsText(page, "Download JSON");
  publish(false, client);
  flush();
  expect(page.querySelector("openclaw-modal-dialog")).toBeNull();
  expect(settingsButton(page, "Export selected…").disabled).toBe(true);
});
it("ignores a delayed export after reconnect and retains default-off recording", async () => {
  const { page, request, respond, publish, client } = await mount();
  expect(page.querySelector<HTMLInputElement>('input[role="switch"]')?.checked).toBe(false);
  expect(settingsButton(page, "Start capture").disabled).toBe(true);
  const held = createDeferred<unknown>();
  request.mockImplementation((method, params) =>
    method === "decisionRecorder.export" ? held.promise : respond(method, params),
  );
  selectRecord(page);
  clickSettings(page, "Export selected…", true);
  publish(false, client);
  publish(true, client);
  held.resolve({ formatVersion: 1, recordCount: 1, bytes: 6, format: "json", content: "secret" });
  await held.promise;
  flush();
  await waitForSolid(() => expect(settingsButton(page, "Refresh").disabled).toBe(false));
  expect(page.querySelector("openclaw-modal-dialog")).toBeNull();
  expect(page.textContent).not.toContain("secret");
  expect(settingsButton(page, "Export selected…").disabled).toBe(true);
});
it("requires confirmation before reducing the budget above current usage and before deletion", async () => {
  const { page, request } = await mount({ storageBytes: 24 * 1048576 });
  input(page, 'input[aria-label="Total storage limit in MiB"]', "30");
  clickSettings(page, "Apply", true);
  await waitSettingsText(page, "Reduce limit");
  expect(request.mock.calls.filter(([method]) => method === "config.patch")).toHaveLength(0);
  clickSettings(page, "Cancel");
  clickSettings(page, "Delete stored decisions…", true);
  await waitSettingsText(page, "This cannot be undone");
  expect(
    request.mock.calls.filter(([method]) => method === "decisionRecorder.delete"),
  ).toHaveLength(0);
  clickSettings(page, "Delete stored decisions", true);
  await waitSettingsText(page, "Stored decisions deleted.");
  expect(
    request.mock.calls.filter(([method]) => method === "decisionRecorder.delete"),
  ).toHaveLength(1);
  expect(page.textContent).not.toContain("Synthetic choice");
});

it("changes JSON/JSONL format locally on one prepared snapshot and preserves unrelated drafts", async () => {
  const { page, request, content, runtimeConfig } = await mount({ enabled: true });
  const download = vi.spyOn(downloads, "downloadTextFile").mockImplementation(() => {});
  runtimeConfig.setRaw('{"untouched": "unsaved local edit",');
  input(page, "#decision-duration", "3");
  clickSettings(page, "Start capture", true);
  await waitSettingsText(page, "Stop capture");
  expect(runtimeConfig.state.configRaw).toBe('{"untouched": "unsaved local edit",');
  expect(runtimeConfig.state.configFormDirty).toBe(true);
  expect(request.mock.calls.some(([method]) => method === "config.set")).toBe(false);
  selectRecord(page);
  clickSettings(page, "Export selected…", true);
  await waitSettingsText(page, "Download JSON");
  const format = page.querySelector<HTMLSelectElement>('select[aria-label="Export format"]')!;
  format.value = "jsonl";
  format.dispatchEvent(new Event("change", { bubbles: true }));
  flush();
  await waitSettingsText(page, "Download JSONL");
  const jsonl = content.slice(1, -1) + "\n";
  expect(page.textContent).toContain(`${new TextEncoder().encode(jsonl).length} bytes`);
  clickSettings(page, "Download JSONL", true);
  expect(download).toHaveBeenCalledWith("decision-recordings.jsonl", jsonl, "application/x-ndjson");
  expect(
    request.mock.calls.filter(([method]) => method === "decisionRecorder.export"),
  ).toHaveLength(1);
});

it("shows a failed status read and recovers through Refresh without discarding a duration draft", async () => {
  const { page, request, respond } = await mount({ enabled: true });
  input(page, "#decision-duration", "4");
  request.mockImplementation((method, params) =>
    method === "decisionRecorder.status"
      ? Promise.reject(new Error("Recorder unavailable"))
      : respond(method, params),
  );
  clickSettings(page, "Refresh", true);
  await waitSettingsText(page, "Recorder unavailable");
  expect(settingsButton(page, "Start capture").disabled).toBe(true);
  request.mockImplementation(respond);
  clickSettings(page, "Refresh", true);
  await waitForSolid(() => expect(settingsButton(page, "Start capture").disabled).toBe(false));
  expect(page.textContent).not.toContain("Recorder unavailable");
  expect(page.querySelector<HTMLInputElement>("#decision-duration")?.value).toBe("4");
});

it.each([false, true])(
  "keeps unreadable-pool recovery deletion confirmed and guarded (mutations disabled: %s)",
  async (mutationDisabled) => {
    const { page, request, respond, publish, client } = await mount(
      { enabled: true },
      mutationDisabled,
    );
    const held = createDeferred<unknown>();
    request.mockImplementation((method, params) => {
      if (method === "decisionRecorder.status" || method === "decisionRecorder.list") {
        return Promise.reject(new Error("Recorder pool unreadable"));
      }
      return method === "decisionRecorder.delete" ? held.promise : respond(method, params);
    });
    clickSettings(page, "Refresh", true);
    await waitSettingsText(page, "Recorder pool unreadable");
    await waitForSolid(() => expect(settingsButton(page, "Refresh").disabled).toBe(false));
    expect(settingsButton(page, "Start capture").disabled).toBe(true);
    expect(settingsButton(page, "Delete stored decisions…").disabled).toBe(mutationDisabled);
    if (mutationDisabled) {
      clickSettings(page, "Delete stored decisions…");
      expect(page.querySelector("openclaw-modal-dialog")).toBeNull();
      expect(request.mock.calls.some(([method]) => method === "decisionRecorder.delete")).toBe(
        false,
      );
      return;
    }
    clickSettings(page, "Delete stored decisions…", true);
    await waitSettingsText(page, "Remove all stored decisions?");
    expect(page.textContent).toContain("The record count and recording state are unavailable.");
    expect(page.textContent).not.toContain("Recording is off.");
    expect(page.textContent).toContain("This cannot be undone");
    const staleConfirm = settingsButton(page, "Delete stored decisions");
    publish(false, client);
    flush();
    expect(settingsButton(page, "Delete stored decisions…").disabled).toBe(true);
    clickSettings(page, "Delete stored decisions…");
    staleConfirm.click();
    flush();
    expect(request.mock.calls.some(([method]) => method === "decisionRecorder.delete")).toBe(false);
    publish(true, client);
    await waitForSolid(() =>
      expect(settingsButton(page, "Delete stored decisions…").disabled).toBe(false),
    );
    clickSettings(page, "Delete stored decisions…", true);
    await waitSettingsText(page, "This cannot be undone");
    clickSettings(page, "Delete stored decisions", true);
    await waitForSolid(() =>
      expect(settingsButton(page, "Delete stored decisions").disabled).toBe(true),
    );
    expect(settingsButton(page, "Delete stored decisions…").disabled).toBe(true);
    clickSettings(page, "Delete stored decisions");
    expect(
      request.mock.calls.filter(([method]) => method === "decisionRecorder.delete"),
    ).toHaveLength(1);
    held.resolve({ deletedRecords: 1, freedBytes: 4096 });
    await waitSettingsText(page, "Stored decisions deleted.");
  },
);

it("a detached confirmation cannot delete records on a replacement connection", async () => {
  const { page, request, publish, client } = await mount();
  clickSettings(page, "Delete stored decisions…", true);
  await waitSettingsText(page, "This cannot be undone");
  const oldConfirm = settingsButton(page, "Delete stored decisions");
  publish(false, client);
  publish(true, client);
  await waitForSolid(() => expect(settingsButton(page, "Refresh").disabled).toBe(false));
  oldConfirm.click();
  flush();
  expect(request.mock.calls.some(([method]) => method === "decisionRecorder.delete")).toBe(false);
});

it("keeps selection while paging forward and back through server cursors with a held next-page read", async () => {
  const { page, request, respond } = await mount();
  const nextPage = createDeferred<RecorderStoreOperations["list"]["output"]>();
  request.mockImplementation(async (method, params) => {
    if (method !== "decisionRecorder.list") {
      return respond(method, params);
    }
    // SAFETY: The fixture receives the production list RPC's cursor input.
    const cursor = (params as { cursor?: number }).cursor;
    if (cursor === 42) {
      return nextPage.promise;
    }
    // SAFETY: The shared fixture returns the declared list response for this method.
    const firstPage = (await respond(method, params)) as RecorderStoreOperations["list"]["output"];
    return { ...firstPage, nextCursor: 42 };
  });
  clickSettings(page, "Refresh", true);
  await waitSettingsText(page, "Next");
  selectRecord(page);
  expect(settingsButton(page, "Previous").disabled).toBe(true);
  clickSettings(page, "Next", true);
  await waitForSolid(() =>
    expect(
      request.mock.calls.some(
        ([method, params]) =>
          method === "decisionRecorder.list" && (params as { cursor?: number }).cursor === 42,
      ),
    ).toBe(true),
  );
  expect(page.textContent).toContain("1 selected");
  // Retained page controls cannot admit another cursor move before this read settles.
  settingsButton(page, "Next").click();
  flush();
  expect(settingsButton(page, "Next").disabled).toBe(true);
  expect(settingsButton(page, "Previous").disabled).toBe(true);
  settingsButton(page, "Previous").click();
  flush();
  // SAFETY: The shared fixture returns the declared list response for this method.
  const firstPage = (await respond(
    "decisionRecorder.list",
  )) as RecorderStoreOperations["list"]["output"];
  const firstRecord = firstPage.records[0];
  if (!firstRecord) {
    throw new Error("Expected synthetic fixture record");
  }
  nextPage.resolve({
    ...firstPage,
    records: [{ ...firstRecord, id: "two", purpose: "Second choice" }],
  });
  await waitSettingsText(page, "Second choice");
  expect(settingsButton(page, "Next").disabled).toBe(true);
  const second = page.querySelector<HTMLInputElement>('input[aria-label="Select Second choice"]')!;
  second.click();
  flush();
  expect(page.textContent).toContain("2 selected");
  clickSettings(page, "Previous", true);
  await waitSettingsText(page, "Synthetic choice");
  expect(
    page.querySelector<HTMLInputElement>('input[aria-label="Select Synthetic choice"]')?.checked,
  ).toBe(true);
  expect(page.textContent).toContain("2 selected");
  expect(settingsButton(page, "Previous").disabled).toBe(true);
  const listCalls = request.mock.calls.filter(([method]) => method === "decisionRecorder.list");
  expect(listCalls.at(-1)?.[1]).toEqual({ limit: 50, cursor: undefined });
});

it("clears evicted selections so surviving records can be exported", async () => {
  const { page, request, respond } = await mount();
  selectRecord(page);
  request.mockImplementation(async (method, params) => {
    if (method === "decisionRecorder.list") {
      const first = (await respond(method, params)) as RecorderStoreOperations["list"]["output"];
      return {
        ...first,
        records: [{ ...first.records[0], id: "two", purpose: "Surviving choice" }],
      };
    }
    if (method === "decisionRecorder.export" && (params as { ids: string[] }).ids.includes("one")) {
      throw new Error("Selected records are missing. Refresh the list.");
    }
    return respond(method, params);
  });
  clickSettings(page, "Refresh", true);
  await waitSettingsText(page, "Surviving choice");
  clickSettings(page, "Export selected…", true);
  await waitSettingsText(page, "Selected records are missing");
  clickSettings(page, "Clear selection", true);
  expect(settingsButton(page, "Export selected…").disabled).toBe(true);
  page.querySelector<HTMLInputElement>('input[aria-label="Select Surviving choice"]')!.click();
  flush();
  clickSettings(page, "Export selected…", true);
  await waitSettingsText(page, "Download JSON");
  expect(
    request.mock.calls.findLast(([method]) => method === "decisionRecorder.export")?.[1],
  ).toEqual({ ids: ["two"], format: "json", preview: false });
});

it("retires cancelled and superseded confirmations on the same connection", async () => {
  const { page, request } = await mount();
  clickSettings(page, "Delete stored decisions…", true);
  await waitSettingsText(page, "This cannot be undone");
  const cancelled = settingsButton(page, "Delete stored decisions");
  clickSettings(page, "Cancel");
  cancelled.click();
  flush();
  expect(request.mock.calls.some(([method]) => method === "decisionRecorder.delete")).toBe(false);
  clickSettings(page, "Delete stored decisions…", true);
  await waitSettingsText(page, "This cannot be undone");
  const superseded = settingsButton(page, "Delete stored decisions");
  // Programmatic replacement exercises the existing imperative-callback contract.
  clickSettings(page, "Delete stored decisions…", true);
  superseded.click();
  flush();
  expect(request.mock.calls.some(([method]) => method === "decisionRecorder.delete")).toBe(false);
  clickSettings(page, "Delete stored decisions", true);
  await waitSettingsText(page, "Stored decisions deleted.");
});
