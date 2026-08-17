import { runManagedCommand } from "./managed-child-process.mjs";

function usage(message?: string): never {
  if (message) {
    console.error(message);
  }
  console.error(
    "usage: node --import tsx scripts/lib/bounded-command.mts <timeout-ms> -- <command> [args...]",
  );
  process.exit(2);
}

const [timeoutMsRaw, separator, command, ...args] = process.argv.slice(2);
if (separator !== "--" || !command) {
  usage();
}
if (!timeoutMsRaw || !/^[1-9][0-9]*$/u.test(timeoutMsRaw)) {
  usage("timeout-ms must be a positive integer");
}
const timeoutMs = Number(timeoutMsRaw);
if (!Number.isSafeInteger(timeoutMs)) {
  usage("timeout-ms must be a safe integer");
}

try {
  process.exitCode = await runManagedCommand({
    args,
    bin: command,
    requireProcessTreeExit: true,
    timeoutKillGraceMs: 10_000,
    timeoutMs,
  });
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ETIMEDOUT") {
    process.exitCode = 124;
  } else {
    throw error;
  }
}
