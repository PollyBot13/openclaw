/** Core reserves decision_evaluate; plugin task IDs are scoped to their consumer owner. */
export const CORE_DECISION_TASK_ID = "decision_evaluate" as const;

export type DecisionTaskId = typeof CORE_DECISION_TASK_ID | `${string}/${string}`;

const PLUGIN_TASK_ID_PATTERN = /^(?=.{1,128}$)[a-z][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63}$/;

export function isDecisionTaskId(value: unknown): value is DecisionTaskId {
  return (
    value === CORE_DECISION_TASK_ID ||
    (typeof value === "string" && PLUGIN_TASK_ID_PATTERN.test(value))
  );
}

/** Core callers omit consumerId; plugin callers may use only their namespace. */
export function isDecisionTaskOwnedBy(taskId: DecisionTaskId, consumerId?: string): boolean {
  if (taskId === CORE_DECISION_TASK_ID) {
    return consumerId === undefined;
  }
  return consumerId !== undefined && taskId.startsWith(`${consumerId}/`);
}
