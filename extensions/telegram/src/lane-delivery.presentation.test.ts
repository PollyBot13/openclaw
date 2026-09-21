// Telegram tests cover streamed final presentation rendering.
import { describe, expect, it, vi } from "vitest";
import { resolveFinalTelegramPresentationText } from "./interactive-fallback.js";
import {
  createHarness,
  deliverFinalAnswer,
  expectPreviewFinalized,
} from "./lane-delivery.test-support.js";

describe("createLaneTextDeliverer streamed presentation finals", () => {
  it("renders a structured presentation on the finalized stream message", async () => {
    const FALLBACK = "Status summary as plain text";
    const RENDERED = "Status summary as native table";
    const harness = createHarness({
      answerMessageId: 999,
      resolveFinalPresentationText: ({ payload, text }) => {
        expect(payload.presentationTextMode).toBe("fallback");
        expect(text).toBe(FALLBACK);
        return RENDERED;
      },
    });

    const result = await harness.deliverLaneText({
      laneName: "answer",
      text: FALLBACK,
      payload: {
        text: FALLBACK,
        presentationTextMode: "fallback",
        presentation: {
          blocks: [
            {
              type: "table",
              caption: "Status",
              headers: ["Key", "Value"],
              rows: [["Gateway", "running"]],
              rowHeaderColumnIndex: 0,
            },
          ],
        },
      },
      infoKind: "final",
    });

    const delivery = expectPreviewFinalized(result);
    expect(delivery.content).toBe(RENDERED);
    expect(harness.answer?.lastDeliveredText()).toBe(RENDERED);
    expect(harness.sendPayload).not.toHaveBeenCalled();
    expect(harness.lanes.answer.finalized).toBe(true);
  });

  it("keeps partial stream text plain and renders the presentation only at finalization", async () => {
    const RENDERED = "Final native table";
    const resolveFinalPresentationText = vi.fn(() => RENDERED);
    const harness = createHarness({
      answerMessageId: 999,
      resolveFinalPresentationText,
    });
    const payload = {
      text: "partial",
      presentationTextMode: "fallback" as const,
      presentation: {
        blocks: [
          {
            type: "table" as const,
            caption: "Status",
            headers: ["Key", "Value"],
            rows: [["Gateway", "running"]],
          },
        ],
      },
    };

    const blockResult = await harness.deliverLaneText({
      laneName: "answer",
      text: "partial",
      payload,
      infoKind: "block",
    });
    expect(blockResult.kind).toBe("preview-updated");
    expect(resolveFinalPresentationText).not.toHaveBeenCalled();
    expect(harness.answer?.lastDeliveredText()).toBe("partial");

    const finalResult = await harness.deliverLaneText({
      laneName: "answer",
      text: "partial",
      payload,
      infoKind: "final",
    });
    expectPreviewFinalized(finalResult);
    expect(harness.answer?.lastDeliveredText()).toBe(RENDERED);
  });

  it("preserves the authored fallback when rich messages are disabled", async () => {
    const FALLBACK = "Status summary as plain text";
    const harness = createHarness({
      answerMessageId: 999,
      resolveFinalPresentationText: ({ payload, text }) =>
        resolveFinalTelegramPresentationText({
          payload,
          text,
          richMessages: false,
        }),
    });

    const result = await harness.deliverLaneText({
      laneName: "answer",
      text: FALLBACK,
      payload: {
        text: FALLBACK,
        presentationTextMode: "fallback",
        presentation: {
          blocks: [
            {
              type: "table",
              caption: "Status",
              headers: ["Key", "Value"],
              rows: [["Gateway", "running"]],
            },
          ],
        },
      },
      infoKind: "final",
    });

    const delivery = expectPreviewFinalized(result);
    expect(delivery.content).toBe(FALLBACK);
    expect(harness.answer?.lastDeliveredText()).toBe(FALLBACK);
  });

  it("does not consult presentation rendering for text-only stream finals", async () => {
    const resolveFinalPresentationText = vi.fn(() => "unexpected");
    const harness = createHarness({
      answerMessageId: 999,
      resolveFinalPresentationText,
    });

    const result = await deliverFinalAnswer(harness, "Hello final");

    expectPreviewFinalized(result);
    expect(resolveFinalPresentationText).not.toHaveBeenCalled();
    expect(harness.answer?.lastDeliveredText()).toBe("Hello final");
  });
});

describe("streamed final canonical presentation text", () => {
  it.each([undefined, "fallback"] as const)(
    "preserves capability-degraded labels with mode %s",
    (presentationTextMode) => {
      const rendered = resolveFinalTelegramPresentationText({
        richMessages: true,
        text: "Summary",
        payload: {
          text: "Summary",
          presentationTextMode,
          presentation: {
            blocks: [
              { type: "table", caption: "Status", headers: ["Key"], rows: [["Gateway"]] },
              { type: "buttons", buttons: [{ label: "Unavailable", value: "x", disabled: true }] },
            ],
          },
        },
      });
      expect(rendered).toContain("<table>");
      expect(rendered).toContain("Unavailable");
      if (!presentationTextMode) {
        expect(rendered).toContain("Summary");
      }
    },
  );
  it("renders title-only presentations", () => {
    expect(
      resolveFinalTelegramPresentationText({
        richMessages: true,
        text: "Summary",
        payload: { text: "Summary", presentation: { title: "Status", blocks: [] } },
      }),
    ).toContain("Status");
  });
});
