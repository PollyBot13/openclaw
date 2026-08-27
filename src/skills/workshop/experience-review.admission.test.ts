import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferred, withTestTimeout } from "../../../test/helpers/promise.js";
import { resolveSessionLane } from "../../agents/embedded-agent-runner/lanes.js";
import type { EmbeddedForegroundPromptContext } from "../../agents/embedded-agent-runner/run/params.js";
import {
  clearActiveEmbeddedRun,
  queueEmbeddedAgentMessageWithOutcome,
  setActiveEmbeddedRun,
} from "../../agents/embedded-agent-runner/runs.js";
import {
  createEmbeddedRunHandle,
  testing as embeddedRunsTesting,
} from "../../agents/embedded-agent-runner/runs.test-support.js";
import { enqueueCommandInLane } from "../../process/command-queue.js";
import { resetCommandQueueStateForTest } from "../../process/command-queue.test-support.js";
import { runSkillExperienceReview } from "./experience-review.js";

const runEmbeddedAgent = vi.hoisted(() => vi.fn());

vi.mock("../../agents/embedded-agent.js", () => ({ runEmbeddedAgent }));
vi.mock("../../agents/run-session-target.js", () => ({
  resolveAgentRunSessionTarget: vi.fn(
    async (params: { agentId?: string; sessionId: string; sessionKey: string }) => ({
      agentId: params.agentId,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      storePath: "/tmp/session-store.json",
    }),
  ),
}));
vi.mock("../../agents/sessions/index.js", () => ({
  SessionManager: {
    open: vi.fn(() => ({ getEntries: () => [] })),
    fromEntries: vi.fn(() => ({})),
  },
}));

afterEach(() => {
  runEmbeddedAgent.mockReset();
  embeddedRunsTesting.resetActiveEmbeddedRuns();
  resetCommandQueueStateForTest();
});

describe("experience review foreground admission", () => {
  it("starts a foreground turn while review is active without steering user instructions", async () => {
    const foregroundSessionId = "foreground-session";
    const foregroundSessionKey = "agent:main:discord:channel:review-admission";
    const foregroundPromptCacheKey = "foreground-cache-prefix";
    const reviewStarted = createDeferred();
    const releaseReview = createDeferred();
    const foregroundStarted = createDeferred();
    const releaseForeground = createDeferred();
    const reviewInstructions: string[] = [];
    const foregroundInstructions: string[] = [];
    let reviewParams: Record<string, unknown> | undefined;

    runEmbeddedAgent.mockImplementation(async (params: Record<string, unknown>) => {
      reviewParams = params;
      const sessionId = String(params.admissionSessionId ?? params.sessionId);
      const sessionKey = String(params.admissionSessionKey ?? params.sessionKey);
      const reviewHandle = createEmbeddedRunHandle({
        runId: String(params.runId),
        queueMessage: async (text) => {
          reviewInstructions.push(text);
        },
      });
      return await enqueueCommandInLane(resolveSessionLane(sessionKey), async () => {
        reviewInstructions.push(String(params.prompt));
        setActiveEmbeddedRun(sessionId, reviewHandle, sessionKey);
        reviewStarted.resolve();
        try {
          await releaseReview.promise;
          return {};
        } finally {
          clearActiveEmbeddedRun(sessionId, reviewHandle, sessionKey);
        }
      });
    });

    const foregroundPromptContext: EmbeddedForegroundPromptContext = {
      agentId: "main",
      agentDir: "/tmp/workspace",
      workspaceDir: "/tmp/workspace",
      cwd: "/tmp/workspace",
      sandboxSessionKey: foregroundSessionKey,
      trigger: "user",
      promptCacheKey: foregroundPromptCacheKey,
    };
    const config = { skills: { workshop: { autonomous: { mode: "propose" as const } } } };
    const review = runSkillExperienceReview(
      {
        ctx: {
          agentId: "main",
          runId: "foreground-run",
          sessionId: foregroundSessionId,
          sessionKey: foregroundSessionKey,
          workspaceDir: "/tmp/workspace",
          modelProviderId: "openai",
          modelId: "gpt-test",
          foregroundPromptContext,
        },
        config,
      },
      { getCurrentConfig: () => config },
    );
    let reviewSettled = false;
    void review.then(
      () => {
        reviewSettled = true;
      },
      () => {
        reviewSettled = true;
      },
    );
    let foreground: Promise<unknown> | undefined;
    try {
      await reviewStarted.promise;
      const queueOutcome = queueEmbeddedAgentMessageWithOutcome(
        foregroundSessionId,
        "foreground-user-instruction",
      );
      foreground = enqueueCommandInLane(resolveSessionLane(foregroundSessionKey), async () => {
        foregroundInstructions.push("foreground-system-instruction");
        foregroundStarted.resolve();
        await releaseForeground.promise;
      });

      await withTestTimeout(
        foregroundStarted.promise,
        1_000,
        "foreground turn waited behind the active experience review",
      );

      expect(reviewSettled).toBe(false);
      expect(queueOutcome).toMatchObject({ queued: false, reason: "no_active_run" });
      expect(reviewInstructions).not.toContain("foreground-user-instruction");
      expect(foregroundInstructions).toEqual(["foreground-system-instruction"]);
      expect(reviewParams).toMatchObject({
        promptCacheKey: foregroundPromptCacheKey,
        sandboxSessionKey: foregroundSessionKey,
        sessionId: foregroundSessionId,
        sessionKey: foregroundSessionKey,
        sessionPersistence: "detached",
      });
      expect(reviewParams?.admissionSessionId).not.toBe(foregroundSessionId);
      expect(reviewParams?.admissionSessionKey).not.toBe(foregroundSessionKey);
    } finally {
      releaseForeground.resolve();
      releaseReview.resolve();
      await Promise.allSettled([review, ...(foreground ? [foreground] : [])]);
    }
  });
});
