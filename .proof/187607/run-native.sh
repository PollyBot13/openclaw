#!/bin/bash
# Run only inside an already-authorized disposable credentialless macOS CI worker.
set -euo pipefail
phase="${1:-}"
case "$phase" in red|green) ;; *) echo "Usage: /bin/bash run-native.sh red|green (from repository root)" >&2; exit 2;; esac
if [[ "$(uname -s)" != Darwin || "${CI:-}" != true || "${GITHUB_ACTIONS:-}" != true || "${RUNNER_OS:-}" != macOS || -z "${RUNNER_TEMP:-}" ]]; then
  echo "Requires the disposable macos-swift CI worker; do not forge CI markers on an operator desktop." >&2
  exit 2
fi
base=4591070b2f4b1b043b57c306fcd6d235e56b04a2
if [[ "$(git rev-parse HEAD)" != "$base" ]]; then
  echo "Expected handoff base $base. Reconcile source and re-review the handoff before using another base." >&2
  exit 2
fi
if [[ "$phase" == red ]]; then
  git diff --quiet HEAD -- apps/macos/Sources || { echo "Red proof requires untouched production sources." >&2; exit 2; }
fi
logs=".openclaw/tmp/issue-187607/native-${phase}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$logs"
run_step() {
  local name="$1"
  shift
  printf "%q " "$@" > "$logs/$name.command"
  printf "\n" >> "$logs/$name.command"
  set +e
  "$@" 2>&1 | tee "$logs/$name.log"
  local rc=${PIPESTATUS[0]}
  set -e
  printf "%s\n" "$rc" > "$logs/$name.exit"
  return "$rc"
}
{ git rev-parse HEAD; git status -sb; sw_vers; xcodebuild -version; xcrun swift --version; node --version; } > "$logs/environment.txt" 2>&1
git diff --binary > "$logs/candidate.diff"
run_step build swift build --package-path apps/macos --build-system native --build-tests
# These suites belong to CI default-profile partition, not the two named-profile suites.
# Coverage is intentionally absent from both build and test.
run_step tests node scripts/test-macos-native.mts default --package-path apps/macos --build-system native --skip-build --filter "StatusMenuSummariesTests|SessionDataTests"
if [[ "$phase" == green ]]; then
  run_step lint scripts/lint-swift.sh macos
  run_step format scripts/format-swift.sh macos
  run_step test-format swiftformat --lint apps/macos/Tests/OpenClawIPCTests/StatusMenuSummariesTests.swift --config config/swiftformat
  run_step whitespace git diff --check
fi
echo "Logs: $logs. Inspect results; successful commands alone do not complete native UI/action proof."
