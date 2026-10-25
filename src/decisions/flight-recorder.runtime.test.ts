import { afterEach, expect, it, vi } from "vitest";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import { getDecisionFlightRecorder } from "./flight-recorder.js";
import { evaluateDecisionInRegistry, evaluateDecisionV2InRegistry } from "./runtime.js";
import { batch, options, config, registered } from "./runtime.test-support.js";

afterEach(() => {
  vi.restoreAllMocks();
  clearRuntimeConfigSnapshot();
});
it("records both runtime versions including skipped results and preserves evaluation under recorder failure", async () => {
  setRuntimeConfigSnapshot({});
  const finish = vi.fn();
  const begin = vi.spyOn(getDecisionFlightRecorder(), "begin").mockReturnValue(finish);
  const v1 = await evaluateDecisionInRegistry(batch, options(), null, {});
  const v2Batch = {
    state: { type: "text" as const, text: "SYNTHETIC" },
    questions: { truth: { type: "boolean" as const } },
  };
  const v2 = await evaluateDecisionV2InRegistry(v2Batch, options(), null, {});
  expect(begin.mock.calls.map((call) => call[0].version)).toEqual([1, 2]);
  expect(begin.mock.calls[0]?.[1]).toEqual(batch);
  expect(begin.mock.calls[1]?.[1]).toEqual(v2Batch);
  expect(finish.mock.calls).toEqual([[v1], [v2]]);
  begin.mockImplementationOnce(() => {
    throw new Error("storage failed");
  });
  await expect(evaluateDecisionInRegistry(batch, options(), null, {})).resolves.toEqual(v1);
  begin.mockReturnValueOnce(() => {
    throw new Error("storage failed");
  });
  await expect(evaluateDecisionInRegistry(batch, options(), null, {})).resolves.toEqual(v1);
});
it("records typed provider answers and only generic failure markers, never raw errors", async () => {
  setRuntimeConfigSnapshot(config);
  const finish = vi.fn();
  vi.spyOn(getDecisionFlightRecorder(), "begin").mockReturnValue(finish);
  const host = registered();
  const answer = await host.run();
  expect(answer.status).toBe("ok");
  expect(finish).toHaveBeenLastCalledWith(answer);
  const aborted = new AbortController();
  aborted.abort(new Error("PRIVATE INPUT"));
  await expect(host.run({ ...options(), signal: aborted.signal })).rejects.toThrow("PRIVATE INPUT");
  expect(finish).toHaveBeenLastCalledWith(undefined, true);
  expect(JSON.stringify(finish.mock.calls)).not.toContain("PRIVATE INPUT");
});

it("a committed disable/re-enable never revives the process-local full-input window", async () => {
  setRuntimeConfigSnapshot({ decisionRecorder: { enabled: true } });
  const owner = getDecisionFlightRecorder();
  owner.window("start");
  setRuntimeConfigSnapshot({ decisionRecorder: { enabled: false } });
  setRuntimeConfigSnapshot({ decisionRecorder: { enabled: true } });
  expect((await owner.status()).fullInputUntil).toBeNull();
});
