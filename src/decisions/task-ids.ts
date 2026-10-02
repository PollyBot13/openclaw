/** Stable host-owned Decision tasks. */
export const CORE_DECISION_TASKS = {
  toolPrefilter: "core/tool-prefilter",
  decisionEvaluate: "core/decision-evaluate",
} as const;

export type DecisionTaskId = (typeof CORE_DECISION_TASKS)[keyof typeof CORE_DECISION_TASKS];

export function isDecisionTaskId(value: unknown): value is DecisionTaskId {
  return (
    value === CORE_DECISION_TASKS.toolPrefilter || value === CORE_DECISION_TASKS.decisionEvaluate
  );
}

export function isDecisionTaskOwnedBy(taskId: DecisionTaskId, consumerId?: string): boolean {
  return isDecisionTaskId(taskId) && consumerId === undefined;
}
