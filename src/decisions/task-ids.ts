/** Stable host-owned tasks; plugin tasks use their manifest owner as a prefix. */
export const CORE_DECISION_TASKS = {
  toolPrefilter: "core/tool-prefilter",
  decisionEvaluate: "core/decision-evaluate",
} as const;

export type DecisionTaskId =
  | (typeof CORE_DECISION_TASKS)[keyof typeof CORE_DECISION_TASKS]
  | `${string}/${string}`;

const TASK_NAME = /^[a-z][a-z0-9-]{0,63}$/;

export function isDecisionTaskId(value: unknown): value is DecisionTaskId {
  if (
    value === CORE_DECISION_TASKS.toolPrefilter ||
    value === CORE_DECISION_TASKS.decisionEvaluate
  ) {
    return true;
  }
  if (typeof value !== "string" || value !== value.trim()) {
    return false;
  }
  const separator = value.lastIndexOf("/");
  const owner = value.slice(0, separator);
  return (
    separator > 0 &&
    owner !== "core" &&
    owner === owner.trim() &&
    TASK_NAME.test(value.slice(separator + 1))
  );
}

export function isDecisionTaskOwnedBy(taskId: DecisionTaskId, consumerId?: string): boolean {
  if (
    taskId === CORE_DECISION_TASKS.toolPrefilter ||
    taskId === CORE_DECISION_TASKS.decisionEvaluate
  ) {
    return consumerId === undefined;
  }
  return consumerId !== undefined && taskId.slice(0, taskId.lastIndexOf("/")) === consumerId;
}
