import { z } from "zod";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { getDecisionFlightRecorder } from "../../decisions/flight-recorder.js";
import {
  captureGatewayRequestOperatorGuard,
  readGatewayRequestMutationAuthority,
} from "./session-mutation-guards.js";
import type { GatewayRequestHandler, GatewayRequestHandlers } from "./types.js";

const empty = z.strictObject({});
const safeMessages = new Set([
  "Selected records were evicted or deleted; refresh the list.",
  "Export exceeds 8 MiB; select fewer records.",
  "Enable basic recording before starting full-input capture.",
  "No active full-input window to renew.",
]);
function handler<T>(
  schema: z.ZodType<T>,
  run: (
    recorder: ReturnType<typeof getDecisionFlightRecorder>,
    params: T,
    assertCurrent: () => void,
  ) => Promise<unknown>,
): GatewayRequestHandler {
  return async (options) => {
    const params = schema.safeParse(options.req.params ?? {});
    if (!params.success) {
      options.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Invalid recorder parameters."),
      );
      return;
    }
    const operatorCurrent = captureGatewayRequestOperatorGuard(options);
    const authority = readGatewayRequestMutationAuthority(options);
    const assertCurrent = () => {
      authority.assertCurrent();
      operatorCurrent();
    };
    try {
      assertCurrent();
      const result = await run(getDecisionFlightRecorder(), params.data, assertCurrent);
      assertCurrent();
      options.respond(true, result, undefined);
    } catch (error) {
      options.respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          error instanceof Error && safeMessages.has(error.message)
            ? error.message
            : "Decision recorder unavailable; refresh and retry.",
        ),
      );
    }
  };
}
export const decisionRecorderHandlers: GatewayRequestHandlers = {
  "decisionRecorder.status": handler(empty, (owner) => owner.status()),
  "decisionRecorder.list": handler(
    z.strictObject({
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    }),
    (owner, params) => owner.list(params.limit, params.cursor),
  ),
  "decisionRecorder.export": handler(
    z.strictObject({
      ids: z.array(z.string().min(1).max(128)).min(1).max(200),
      format: z.enum(["json", "jsonl"]),
      preview: z.boolean(),
    }),
    (owner, params) => owner.export(params),
  ),
  "decisionRecorder.window": handler(
    z.strictObject({ action: z.enum(["start", "renew", "stop"]) }),
    async (owner, params, assertCurrent) => {
      owner.window(params.action, assertCurrent);
      return owner.status();
    },
  ),
  "decisionRecorder.delete": handler(empty, (owner, _params, assertCurrent) =>
    owner.delete(assertCurrent),
  ),
};
