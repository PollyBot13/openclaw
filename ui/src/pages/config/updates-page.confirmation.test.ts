/* @vitest-environment jsdom */

import { createComponent } from "solid-js";
import { expect, it, vi } from "vitest";
import type { ApplicationContext } from "../../app/context.ts";
import { client, type RequestFn } from "../../app/overlays-access.test-support.ts";
import { createApplicationOverlays } from "../../app/overlays.ts";
import { updateRunHarness } from "../../app/update-run.test-support.ts";
import { createModalDialogTestFixture } from "../../test-helpers/modal-dialog.ts";
import { mountSolid } from "../../test-helpers/mount-solid.ts";
import { flush } from "../../test-helpers/solid-settle.ts";
import { createUpdateRunFixture } from "../../test-helpers/update-run.ts";
import { reportFailureOnUpdatesRoute, UpdatesPage } from "./updates-page.tsx";

it("routes a confirmation failure report to Updates before reporting the captured attempt", async () => {
  const events: string[] = [];
  const context = {
    navigate: vi.fn((route: string) => events.push(`navigate:${route}`)),
    overlays: {
      reportUpdateFailure: vi.fn(async (attemptId: string) => {
        events.push(`report:${attemptId}`);
      }),
    },
  } as unknown as ApplicationContext;

  await reportFailureOnUpdatesRoute(context, "displayed-attempt");

  expect(events).toEqual(["navigate:updates", "report:displayed-attempt"]);
  expect(context.overlays.reportUpdateFailure).toHaveBeenCalledExactlyOnceWith("displayed-attempt");
});

it.each(["loading", "open"] as const)(
  "retires a Gateway update confirmation when its target changes while %s",
  async (stage) => {
    const dialog = createModalDialogTestFixture();
    const run = createUpdateRunFixture();
    const replies: Record<string, unknown> = {
      "update.run": { runId: run.runId },
      "update.runs.get": { run },
      "update.status": {
        updateAvailable: { channel: "stable", currentVersion: "1.0.0", latestVersion: "2.0.0" },
      },
    };
    const request = () =>
      dialog.mockRequest<Parameters<RequestFn>, unknown>(async (method) =>
        Object.hasOwn(replies, method) ? replies[method] : {},
      );
    const requestA = request();
    const requestB = request();
    const harness = updateRunHarness(requestA);
    harness.update({
      hello: {
        ...harness.gateway.snapshot.hello!,
        features: { methods: ["update.run", "update.status"] },
      },
    });
    const overlays = createApplicationOverlays(harness.gateway);
    const context = {
      gateway: harness.gateway,
      overlays,
      config: {
        current: { serverVersion: "1.0.0" },
        subscribe: () => () => undefined,
      },
      nativeDeviceSettings: null,
    } as unknown as ApplicationContext;
    const mounted = mountSolid(() =>
      createComponent(UpdatesPage, {
        context,
        configObject: {},
        configBusy: false,
        updateBusy: false,
        statusRead: null,
        onCheckStatus: () => overlays.refreshUpdateStatus(),
        captureCommandPresentation: () => ({
          retired: new Promise<void>(() => {}),
          isCurrent: () => true,
        }),
      }),
    );
    const updateButton = () => {
      const button = mounted.getByRole<HTMLButtonElement>("button", { name: "Update" });
      expect(button).toMatchObject({ disabled: false });
      return button;
    };
    const confirmButton = () =>
      document.body.querySelector<HTMLButtonElement>(
        "openclaw-modal-dialog .exec-approval-actions .btn.danger",
      );
    const updateCalls = (calls: typeof requestA.mock.calls) =>
      calls.filter(([method]) => method === "update.run");
    try {
      await overlays.refreshUpdateStatus();
      flush();
      updateButton().click();
      if (stage === "open") {
        await dialog.waitFor(() => expect(confirmButton()).not.toBeNull());
      }
      // No await in the loading case: retire A before the lazy import can resume.
      harness.gateway.connection.gatewayUrl = "ws://other-gateway.test";
      harness.update({ client: client(requestB) });
      await vi.dynamicImportSettled();
      confirmButton()?.click();
      await vi.dynamicImportSettled();
      expect([requestA, requestB].map((rpc) => updateCalls(rpc.mock.calls))).toEqual([[], []]);
      expect(document.body.querySelector("openclaw-modal-dialog")).toBeNull();

      await overlays.refreshUpdateStatus();
      flush();
      updateButton().click();
      await dialog.waitFor(() => expect(confirmButton()).not.toBeNull());
      confirmButton()!.click();
      await dialog.waitFor(() => expect(updateCalls(requestB.mock.calls)).toHaveLength(1));
      expect(updateCalls(requestA.mock.calls)).toEqual([]);
    } finally {
      mounted.unmount();
      await dialog.cleanup();
      overlays.dispose();
    }
  },
);
