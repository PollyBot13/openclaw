# #187607 - consolidated Mac execution handoff

**Status: native validation PENDING. Mac access is NOT confirmed. Do not provision an environment or dispatch a job.** This document supersedes the earlier scattered execution instructions. It is preparation for a possible later run by the owner of an existing isolated Mac VM, not a request sent to that owner.

## 1. Ownership, scope and pinned inputs

Per Mert's 2026-10-30 coordination update, Eisenh0rn40 handed #187607 to our team. He continues #187603 in PR #188635 and #187602 in PR #188683. Our scope is only Thinking/Verbose checkmarks. No preview lifecycle, cache, updater, Gateway, defaults resolution, persistence, protocol, or new menu-choice changes.

- Baseline checkout: `4591070b2f4b1b043b57c306fcd6d235e56b04a2`.
- Existing test-only `PATCH.diff` SHA-256: `60d81e6d170892503e51a556bda4593d381ebcebabc2be7e3dfead4aad19e1f9`. Reused unchanged, including completed source review and static checks.
- `PROPOSED-FIX.diff`: exact two-method proposal, **not applied** to production. Apply only after preserving native red evidence.
- #188635 inspected head: `a690bafd75b5ac9bde7195d660971480df06111a`. Production proposal applies textually to that source, but our test patch does not apply cleanly to its fixture. See section 7 before using any other base.
- No candidate commit exists; retain base SHA plus the exact diffs and SHA-256 hashes. Do not create commits or publish anything for this handoff.

## 2. Prerequisites and admission

Before any native run, the Mac owner must confirm availability and authority for this task on an **existing disposable, credentialless macOS VM/CI worker**, with task-owned checkout, no operator app/Gateway/config, and no personal Keychain/preferences. A temporary HOME or named profile alone is not isolation. Do not touch /Applications/OpenClaw.app, run restart-mac.sh, reset TCC, alter LaunchAgents, or change a global toolchain.

Use Xcode 26.4+/Swift 6.3 or a compatible newer toolchain on current macOS; patched Node 24.22.1+ or 26.12.1+; repository dependencies prepared through normal native setup; pinned SwiftFormat 0.63.1 and SwiftLint 0.65.1. Record actual versions, not just this minimum. Dependencies/tool setup must be confined to the approved disposable environment.

Read the selected checkout's root/macOS AGENTS.md, docs/platforms/mac/dev-setup.md (native isolation), scripts/test-macos-native.mts, and .github/workflows/ci.yml macos-swift partition. Before captures, read .agents/skills/openclaw-pr-maintainer/references/media.md. No publication authority is supplied by that guide.

**Launcher compatibility checkpoint:** the pinned repository launcher and run-native.sh require genuine CI/GITHUB_ACTIONS/RUNNER_OS/RUNNER_TEMP context. An arbitrary isolated Tart VM is not automatically admitted. Do not set fake CI markers, strip guards, or substitute raw swift test. If the offered VM is not already an approved runner for this launcher, stop native execution and ask its owner for the supported repository-approved execution route. Access and launcher compatibility remain unconfirmed. Do not provision a replacement. Ordinary PR CI or #188635's proof is not #187607 native validation.

## 3. Baseline / red - exact commands

The owner supplies a separate task-owned checkout at the pinned baseline. Do not switch a checkout used for #187603/#187602. Place this bundle under .openclaw/tmp/issue-187607, then run from repository root:

```bash
set -euo pipefail
test "$(git rev-parse HEAD)" = 4591070b2f4b1b043b57c306fcd6d235e56b04a2
git status -sb
(cd .openclaw/tmp/issue-187607 && shasum -a 256 -c SHA256SUMS.txt)
# Fresh clean checkout only: apply the existing regression once.
git apply --check .openclaw/tmp/issue-187607/PATCH.diff
git apply .openclaw/tmp/issue-187607/PATCH.diff
/bin/bash .openclaw/tmp/issue-187607/run-native.sh red
```

In our current task checkout PATCH.diff is **already applied**. Inspect the diff and use git apply --check --reverse to confirm it instead of applying it again. Do not blindly retry a partially completed patch/build.

The helper records environment, exact diff, command lines, logs and exit codes under a unique native-red directory. It builds then invokes the owning launcher:

```bash
swift build --package-path apps/macos --build-system native --build-tests
node scripts/test-macos-native.mts default --package-path apps/macos --build-system native --skip-build --filter 'StatusMenuSummariesTests|SessionDataTests'
```

These suites belong to the default partition at this base. The older review's named example is not the selected route. Coverage is deliberately absent from both commands; do not combine a coverage test invocation with a non-coverage build. Measure wall time around the helper with /usr/bin/time -p if desired and retain stderr.

Expected **unobserved** failure: test `session preference checkmarks distinguish inheritance from explicit Off` has checked payloads ["off"] instead of [] for missing/unrepresented overrides in Thinking and Verbose. The same-menu case checks parent and both submenu identities and transitions high/on back to inherited. Explicit Off/high/on controls should pass. Preserve actual assertions and exit codes. Build failures, zero tests, hangs, and unrelated failures are not native red proof. The script exits nonzero on the red test failure; inspect its saved logs before moving on.

The regression uses the real loader/menu owner with synthetic WebSocket I/O. It is not a live loopback Gateway, native menu-tracking screenshot harness, or persistence/action test. The separate real-menu checks below remain necessary.

## 4. Minimal proposed fix - only after red and Before capture

Capture the baseline UI states in section 6 before changing production. Then inspect PROPOSED-FIX.diff. It removes the false Off fallback in buildPreferenceMenu and updatePreferenceMenu, comparing each generated item's value directly to the optional current stored override. Missing/unrepresented values yield no selection; explicit represented values retain their checkmarks. Every generated preference item has a nonnil payload value.

No fallback resolution, new Default action, strings, protocol, persistence, available-level changes, or preview repair.

```bash
git apply --check .openclaw/tmp/issue-187607/PROPOSED-FIX.diff
git apply .openclaw/tmp/issue-187607/PROPOSED-FIX.diff
git diff -- apps/macos/Sources/OpenClaw/StatusMenuSessions.swift
git diff --check
```

This is an execution handoff, not a claim that these production edits or native red have already occurred.

## 5. Matching post-fix / green checks

```bash
/bin/bash .openclaw/tmp/issue-187607/run-native.sh green
```

The helper rebuilds and runs the **same** two suites with the same launcher/flags, then:

```bash
scripts/lint-swift.sh macos
scripts/format-swift.sh macos
swiftformat --lint apps/macos/Tests/OpenClawIPCTests/StatusMenuSummariesTests.swift --config config/swiftformat
git diff --check
```

Confirm both false/true regression cases ran and passed, explicit controls stayed selected, and loader/route-action siblings still pass. Keep any unrelated failures with exact attribution; do not weaken checks or claim another PR's lint exception applies here. No strings change, so no localization regeneration is required. Repeat section 6 on the fixed source. Native compilation, tests, timings, screenshots and real action checks are all still pending.

## 6. Real menu selections and Before/After evidence

On that same isolated Mac, use synthetic target session A and control session B in a task-owned Gateway/fixture with ephemeral loopback endpoint. Set the agent defaults to Thinking=high and Verbose=on. Omit A's per-session overrides; record the fixture/config and stored fields. Do not resolve those defaults inside the menu client. Prepare explicit Off and high/on states as controls.

The Mac executor needs an actual product menu or a proof-only AppKit harness that calls production configureSessionItem and displays its real NSMenu during tracking. The supplied regression does not include this visual/loopback harness. Reuse an existing safe harness only after checking its source, isolation and suitability for these preference submenus; never reuse #188635 screenshots as checkmark evidence. If the harness is unavailable, return test results with the UI/action gap still pending instead of claiming full proof.

Run the following matrix on baseline and fixed source, retaining the same synthetic content, theme and viewport:

| State/path | Baseline expected | Fixed expected |
| --- | --- | --- |
| Fresh A, overrides absent, defaults high/on | Off incorrectly checked in both | No item checked in either |
| A explicit high/on, then clear overrides and refresh same retained row | Reverts incorrectly to Off | Clears both checkmarks; retains submenu identities |
| Explicit Off controls | Off checked | Off remains checked |
| Explicit high/on controls | Correct represented items checked | Same |
| Stored xhigh/full, not represented by these menus | False Off checkmark | No item checked |

For **real selections**, click Thinking Off, Thinking High, Verbose Off, Verbose On through the native submenus; do not substitute a direct RPC as the action under test. For each click record the resulting sessions.patch target key and changed field, await its completion/refresh, and verify stored state/readback for A. Confirm B is unchanged and the other preference is untouched. Use a second session that is genuinely distinct, not two aliases of the same session. Clearing overrides between scenarios may use the fixture's existing setup path, but record that separately from menu-action evidence. Check initial creation and reopen/reuse after the transition.

Capture actual native Thinking and Verbose submenus before and after, including inherited non-Off defaults and explicit Off controls. Suggested names: before-thinking-inherited.png, after-thinking-inherited.png, before-verbose-inherited.png, after-verbose-inherited.png; retain additional reuse/control captures in the evidence bundle. Do not alter checkmarks in images. Inspect/sanitize every capture for credentials, personal desktop content and unrelated sessions. Keep captions outside images. Later chat delivery should say “Before”, show the image, then “After”, show the matching image; lead with a representative pair and keep the rest in the bundle. No public upload now.

## 7. Shared-file overlap and future integration

#188635 does not fix Thinking/Verbose. It changes preview lifecycle in StatusMenuSessions and adds fixture state/tests in StatusMenuSummariesTests. Our proposed production diff passes a textual application check on its pinned head. Our existing regression patch fails application at the fixture insertion context after previewFails. This is a **real textual overlap**, not competing ownership of this bug.

Keep the pinned baseline for this run. If #188635 lands before later integration, preserve all its preview tests, holdPreviews/previewText/previewResponsesChanged/pendingPreviewResponses state, captures and cleanup. Add our sessionPreferences property/capture and sessions.list fixture payload alongside them, retaining our regression unchanged. Do not overwrite the fixture or strip their fields to make our patch apply. Record the integrated base and rerun the affected suites with both changes; prior-base proof is not integrated-head proof. The base-pinned helper intentionally refuses another HEAD until its handoff is explicitly reconciled. No changes to #188683/#187602.

## 8. Return package and completion criteria

Return exact base SHA, final diffs/hashes (candidate SHA only if separately authorized later), toolchain/OS versions, commands/exit codes, native red assertions, green test counts, lint/format results, durations, action receipts/readback and sanitized before/after captures. Keep reporter evidence, #188635 third-party results and new #187607 execution separately attributed. Re-run simplification and independent review on the real production candidate before treating it as ready.

No commits, pushes, PRs, comments, label/assignee changes, external coordination messages, provisioning, installed-app changes or public uploads. Preserve the owner's unrelated workloads. Cleanup only identified task resources after retaining evidence; honor launcher cleanup failures. Until all native steps actually execute, status remains **PENDING**, not validated.
