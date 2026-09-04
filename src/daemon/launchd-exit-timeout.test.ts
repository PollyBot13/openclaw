import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawnSync }));

import { readLoadedLaunchAgentExitTimeoutSecondsSync } from "./launchd-exit-timeout.js";

describe("readLoadedLaunchAgentExitTimeoutSecondsSync", () => {
  beforeEach(() => {
    spawnSync.mockReset();
  });

  it.each([
    { output: "exit timeout = 20\n", expected: 20 },
    { output: "\texit timeout = 0\n", expected: 0 },
    { output: "exit timeout = -1\n", expected: undefined },
    { output: "state = running\n", expected: undefined },
    { output: "exit timeout = nope\n", expected: undefined },
  ])("parses loaded ExitTimeOut from $output", ({ output, expected }) => {
    spawnSync.mockReturnValue({ error: undefined, status: 0, stdout: output, stderr: "" });

    expect(
      readLoadedLaunchAgentExitTimeoutSecondsSync({
        OPENCLAW_LAUNCHD_LABEL: "ai.openclaw.gateway.test",
      }),
    ).toBe(expected);
    expect(spawnSync).toHaveBeenCalledWith(
      "launchctl",
      ["print", expect.stringMatching(/^gui\/\d+\/ai\.openclaw\.gateway\.test$/)],
      { encoding: "utf8", timeout: 2_000 },
    );
  });

  it.each([
    { error: new Error("timed out"), status: null },
    { error: undefined, status: 1 },
  ])("fails closed when launchctl cannot read the loaded job", ({ error, status }) => {
    spawnSync.mockReturnValue({ error, status, stdout: "", stderr: "unavailable" });

    expect(
      readLoadedLaunchAgentExitTimeoutSecondsSync({
        OPENCLAW_LAUNCHD_LABEL: "ai.openclaw.gateway.test",
      }),
    ).toBeUndefined();
  });
});
