import path from "node:path";
import { sanitizeForLog } from "../../packages/terminal-core/src/ansi.js";
import { resolveConfiguredAgentDatabaseTargets } from "../config/sessions/targets.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { formatErrorMessage } from "../infra/errors.js";
import { discoverAgentDatabaseMigrationTargets } from "../infra/state-migrations.media-persistence-targets.js";
import { listOpenClawRegisteredAgentDatabases } from "../state/openclaw-agent-db-registry.js";

function isDefaultAgentDatabasePath(pathname: string): boolean {
  const agentDir = path.dirname(path.dirname(pathname));
  return (
    path.basename(pathname) === "openclaw-agent.sqlite" &&
    path.basename(path.dirname(pathname)) === "agent" &&
    path.basename(path.dirname(agentDir)) === "agents"
  );
}

/** Report retained stores without turning roster absence into deletion authority. */
export function collectRetainedUnconfiguredAgentDatabaseWarnings(params: {
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const env = params.env ?? process.env;
  try {
    const registeredAgentDatabases = listOpenClawRegisteredAgentDatabases({
      env,
      includeIncompatibleSchemaVersions: true,
    });
    const configuredAgentDatabaseTargets = resolveConfiguredAgentDatabaseTargets(params.cfg, {
      env,
      registeredDatabases: registeredAgentDatabases,
    });
    const discovery = discoverAgentDatabaseMigrationTargets({
      configuredAgentDatabaseTargets,
      registeredAgentDatabases,
      env,
    });
    return discovery.targets.flatMap((target) => {
      if (target.source === "configured" || isDefaultAgentDatabasePath(target.realPath)) {
        return [];
      }
      return [
        `- Retained unconfigured agent database "${sanitizeForLog(target.agentId)}" at ${sanitizeForLog(target.path)}. Doctor will not remove it automatically because it may contain retired or manually managed agent state.`,
      ];
    });
  } catch (error) {
    return [
      `- Could not inspect retained unconfigured agent databases: ${sanitizeForLog(formatErrorMessage(error))}`,
    ];
  }
}
