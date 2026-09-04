/** Reads the loaded LaunchAgent's stop deadline without depending on its plist. */
import { spawnSync } from "node:child_process";
import { parseStrictInteger } from "@openclaw/normalization-core/number-coercion";
import { resolveLaunchAgentLabel } from "./launchd-label.js";
import { parseKeyValueOutput } from "./runtime-parse.js";

const LAUNCHCTL_PRINT_TIMEOUT_MS = 2_000;

function parseLoadedLaunchAgentExitTimeoutSeconds(output: string): number | undefined {
  const value = parseKeyValueOutput(output, "=")["exit timeout"];
  if (value === undefined) {
    return undefined;
  }
  const seconds = parseStrictInteger(value);
  return seconds !== undefined && seconds >= 0 ? seconds : undefined;
}

export function readLoadedLaunchAgentExitTimeoutSecondsSync(
  env: Record<string, string | undefined> = process.env,
): number | undefined {
  try {
    const uid = typeof process.getuid === "function" ? process.getuid() : 501;
    const serviceTarget = `gui/${uid}/${resolveLaunchAgentLabel(env)}`;
    const probe = spawnSync("launchctl", ["print", serviceTarget], {
      encoding: "utf8",
      timeout: LAUNCHCTL_PRINT_TIMEOUT_MS,
    });
    if (probe.error || probe.status !== 0) {
      return undefined;
    }
    return parseLoadedLaunchAgentExitTimeoutSeconds(probe.stdout ?? probe.stderr ?? "");
  } catch {
    return undefined;
  }
}
