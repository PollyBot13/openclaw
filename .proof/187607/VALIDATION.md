# Retained validation evidence

## Evidence obtained here

- Workspace base: `4591070b2f4b1b043b57c306fcd6d235e56b04a2`; no commit made.
- Host: Linux. No Swift, Xcode, SwiftLint or SwiftFormat found on PATH. Available tools expose no node inventory/remote Mac executor or configured cloud-profile discovery; no qualified, authorized disposable Mac was established. This is a session capability limit, not a claim that the team has no Macs. No paid resource or CI run was allocated.
- Local Node: v24.20.0; below the current developer recommendation (24.22.1+ or 26.12.1+). No native launcher attempted here, no toolchain changed.
- `git diff --check`: exit 0.
- `bash -n run-native.sh`: exit 0. Linux invocation refuses with exit 2 before build/test/resource creation, as intended. This is a safety/syntax check, not native proof.
- `git apply --check --reverse PATCH.diff`: exit 0 against the edited working tree.
- `git apply --check --directory=<task-owned pristine source copy> PATCH.diff`: exit 0 against the base source.
- Test-only delta: 65 added / 4 removed lines; production delta: zero.
- `git diff --quiet HEAD -- apps/macos/Sources`: exit 0; production unchanged.
- `scripts/lint-swift.sh macos`: exit 1, required SwiftLint 0.65.1 missing; lint did not run.
- `scripts/format-swift.sh macos`: exit 1, required SwiftFormat 0.63.1 missing; formatting did not run.
- Native reproduction, test compilation, red/green runs, UI/action proof, screenshots, and wall-time/CI-cost measurement: **NOT EXECUTED**.
- The authored regression is runnable source for the native suite, not a claim that it compiled. Native runtime proof remains pending.

## Independent review

A fresh independent agent reviewed the complete source snapshots of the test/fixture, menu owner, loader, scoped instructions and testing guidance at the stated base. Outcome: **no actionable findings** in the test candidate. Reviewed PATCH.diff SHA-256: `60d81e6d170892503e51a556bda4593d381ebcebabc2be7e3dfead4aad19e1f9`. The parent verified this hash still matches the working-tree diff after review.

The initial review attempt lacked a repository mount; it was not counted as review. The continued review used exact complete source snapshots supplied by the parent. This was source review, not a native compile/run, a mounted-worktree verification by the reviewer, an autoreview/ClawSweeper run, or landing approval. It found the creation/reuse coverage, independent expected selections, fixture decoding, apparent types and cleanup coherent. A checked item without a value could escape the compactMap assertion, but the inspected owner always supplies nonnil preference payloads; this was not judged actionable for this scope. Final production-candidate review remains pending after native red and repair.

## Coordination-update checks

- Existing regression reused unchanged; its reviewed SHA-256 above still matches PATCH.diff and the working-tree diff. No native checks were rerun or claimed.
- PR #188635 current inspected head: `a690bafd75b5ac9bde7195d660971480df06111a`. Full shared source/test patches inspected. Regression application to its pinned fixture: exit 1 (adjacent fixture additions); reconciliation is documented in FINDINGS.md.
- PROPOSED-FIX.diff application checks against our untouched base source and pinned #188635 source: exit 0 in both cases. This is an unapplied textual proposal, not native proof or a working-tree production edit.
- Source-review result above covers the unchanged regression only. New handoff/proposed diff received parent inspection, not a new independent native/candidate review.
- Execution instructions now have one owner: MAC-EXECUTION.md. All native validation remains PENDING / NOT EXECUTED.
