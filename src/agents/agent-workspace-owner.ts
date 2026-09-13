import { normalizeAgentId } from "@openclaw/normalization-core/agent-id";
import { getRetainedLegacyDefaultAgentId } from "../config/legacy.default-agent-owner-state.js";

/**
 * Selects the compatibility owner allowed to inherit a shared workspace.
 * Callers project their supported roster shapes without cloning the config:
 * read-time migration retains its owner on that exact object's identity.
 * Roster ids retain duplicates, because two entries are not a sole agent.
 */
export function tryResolveAgentWorkspaceOwner(
  config: object,
  roster: {
    agentIds: readonly string[];
    hasAgentRoster: boolean;
    legacyDefaultAgentId?: string;
  },
): string | undefined {
  const retained = getRetainedLegacyDefaultAgentId(config);
  if (retained && roster.agentIds.includes(retained)) {
    return retained;
  }
  if (roster.legacyDefaultAgentId) {
    return roster.legacyDefaultAgentId;
  }
  if (roster.agentIds.length === 1) {
    return roster.agentIds[0];
  }
  // Raw pre-roster configs retain the implicit main-agent compatibility path.
  return !roster.hasAgentRoster && roster.agentIds.length === 0
    ? normalizeAgentId(undefined)
    : undefined;
}
