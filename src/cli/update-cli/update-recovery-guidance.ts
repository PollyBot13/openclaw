import type { UpdateRunResult } from "../../infra/update-runner.js";

type UnsafeUpdateRecovery = Extract<
  NonNullable<UpdateRunResult["recovery"]>,
  { serviceRestartSafe: false }
>;

export function resolveUnsafeUpdateRecoveryGuidance(
  reason: UnsafeUpdateRecovery["reason"],
): string {
  if (reason === "rollback-checkout-dirty") {
    return "From the update root shown above, run `git status --short`, resolve the reported changes, then rerun `openclaw update`.";
  }
  return "Review the failed recovery step above, repair the checkout or installation, then rerun `openclaw update`.";
}
