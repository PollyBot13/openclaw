#!/bin/bash
set -euo pipefail
phase=$1
proof=.openclaw/tmp/issue-187607
case "$phase" in before|after) ;; *) exit 2 ;; esac
echo "$phase" > "$proof/proof-phase.txt"
rc=0
for mode in captures thinkingLevel-off thinkingLevel-high verboseLevel-off verboseLevel-on; do
  echo "$mode" > "$proof/proof-mode.txt"
  node scripts/test-macos-native.mts default --package-path apps/macos --build-system native --skip-build --filter Issue187607MenuProof > "$proof/$phase-$mode-menu-driver.log" 2>&1 || rc=$?
  cat "$proof/$phase-$mode-menu-driver.log"
done
test "$rc" = 0
python3 "$proof/aggregate-menu.py" "$proof/menu-proof" "$phase"
