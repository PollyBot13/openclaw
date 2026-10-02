import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveDecisionSelection } from "../decisions/selection.js";
import { CORE_DECISION_TASKS } from "../decisions/task-ids.js";
import type { PluginRegistry } from "../plugins/registry-types.js";

/**
 * Outer eligibility only, over prepared config and a trusted owning agent ID.
 * Does not establish provider readiness, consumer mode, harness support, or
 * authority. Automatic consumers check this before preparing evidence and again
 * at provider dispatch. Opt-out does not invalidate admitted evaluations; model
 * selection and live authority remain independently checked for awaited results.
 * Explicit decision_evaluate and the shared Decision runtime remain independent.
 */
export function isDecisionAssistanceEligible(
  config: OpenClawConfig,
  agentId: string,
  registry?: PluginRegistry | null,
): boolean {
  return (
    config.agents?.defaults?.experimental?.decisionAssistance === true &&
    resolveDecisionSelection(config, agentId, CORE_DECISION_TASKS.toolPrefilter, registry) !==
      undefined
  );
}
