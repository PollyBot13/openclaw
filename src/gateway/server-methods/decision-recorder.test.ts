import { afterEach, expect, it, vi } from "vitest";
import { getDecisionFlightRecorder } from "../../decisions/flight-recorder.js";
import { resolveCoreOperatorGatewayMethodScope } from "../methods/core-method-policy.js";
import { decisionRecorderHandlers } from "./decision-recorder.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

afterEach(() => vi.restoreAllMocks());
function request(
  method: string,
  params: Record<string, unknown>,
  hasCurrentClientAuthority = () => true,
) {
  const respond = vi.fn();
  const options = {
    req: { type: "req", id: "recorder", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    context: {} as never,
    respond,
    hasCurrentClientAuthority,
  } satisfies GatewayRequestHandlerOptions;
  return { respond, run: () => decisionRecorderHandlers[method]!(options) };
}
it("classifies every recorder method admin-only and rejects unbounded/unknown export parameters", async () => {
  for (const name of Object.keys(decisionRecorderHandlers)) {
    expect(resolveCoreOperatorGatewayMethodScope(name)).toBe("operator.admin");
  }
  const spy = vi.spyOn(getDecisionFlightRecorder(), "export");
  const { run, respond } = request("decisionRecorder.export", {
    ids: ["one"],
    format: "json",
    preview: false,
    path: "/untrusted",
  });
  await run();
  expect(respond).toHaveBeenCalledWith(
    false,
    undefined,
    expect.objectContaining({ code: "INVALID_REQUEST" }),
  );
  expect(spy).not.toHaveBeenCalled();
});
it("never publishes private storage errors or exports after requester revocation", async () => {
  const owner = getDecisionFlightRecorder();
  const exportSpy = vi
    .spyOn(owner, "export")
    .mockRejectedValueOnce(new Error("PRIVATE INPUT /private/location"));
  const first = request("decisionRecorder.export", {
    ids: ["one"],
    format: "json",
    preview: false,
  });
  await first.run();
  expect(JSON.stringify(first.respond.mock.calls)).not.toContain("PRIVATE");
  expect(first.respond).toHaveBeenCalledWith(
    false,
    undefined,
    expect.objectContaining({ message: "Decision recorder unavailable; refresh and retry." }),
  );
  let current = true;
  exportSpy.mockImplementationOnce(async () => {
    current = false;
    return {
      formatVersion: 1,
      recordCount: 1,
      bytes: 13,
      format: "json",
      content: "PRIVATE INPUT",
    };
  });
  const second = request(
    "decisionRecorder.export",
    { ids: ["one"], format: "json", preview: false },
    () => current,
  );
  await second.run();
  expect(second.respond.mock.calls[0]?.[0]).toBe(false);
  expect(JSON.stringify(second.respond.mock.calls)).not.toContain("PRIVATE");
});
