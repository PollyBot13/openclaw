import { sanitizeForLog } from "../../packages/terminal-core/src/ansi.js";
import { resolveConfiguredAgentDatabaseTargets } from "../config/sessions/targets.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { discoverAgentDatabaseMigrationTargets } from "../infra/state-migrations.media-persistence-targets.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  createOpenClawAgentDatabasePathMatcher,
  listOpenClawRegisteredAgentDatabases,
} from "../state/openclaw-agent-db-registry.js";

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
    const isSameDatabasePath = createOpenClawAgentDatabasePathMatcher();
    const discovery = discoverAgentDatabaseMigrationTargets({
      configuredAgentDatabaseTargets,
      registeredAgentDatabases,
      env,
    });
    return discovery.targets.flatMap((target) => {
      const agentId = normalizeAgentId(target.agentId);
      if (
        configuredAgentDatabaseTargets.some((configured) =>
          isSameDatabasePath(configured.path, target.path),
        )
      ) {
        return [];
      }
      return [
        `- Retained unconfigured agent database "${sanitizeForLog(agentId)}" at ${sanitizeForLog(target.path)}. Doctor will not remove it automatically because it may contain retired or manually managed agent state.`,
      ];
    });
  } catch {
    // Schema preflight and migration diagnostics own unreadable registry/store failures.
    return [];
  }
}
