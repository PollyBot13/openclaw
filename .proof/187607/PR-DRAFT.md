# Unpublished body draft — NOT ready to submit

Proposed future title: `fix(macos): inherited session preferences incorrectly show Off as selected`

Related: #187607. Separate from #187603 (PR #188635) and #187602 (PR #188683). Shared fixture insertion overlap with #188635 must be reconciled without absorbing its preview repair.

## What Problem This Solves

The macOS status menu checks Off for Thinking and Verbose when a session inherits its defaults, misleading users into believing an explicit Off override is already active.

## User Impact

The proposed fix would leave all choices unchecked for inherited or unrepresented overrides, while preserving explicit Off and represented non-Off selections. **The working-tree change is an unexecuted regression; production behavior is unchanged. The private handoff also includes an unapplied minimal production proposal.**

## Why This Change Was Made

The intended narrow repair removes the display-only Off fallback from initial menu construction and submenu reuse. It would not resolve defaults locally or change persistence, actions, protocol, or available choices. Apply it only after the native red step; the current patch is not an implementation PR.

## Evidence

- Source finding independently checked against current main `48df899f6f1684d85dbab88077bd7efce224e904`; affected owner/loader/test files matched preparation base `4591070b2f4b1b043b57c306fcd6d235e56b04a2`.
- Test preparation covers initial construction, same-submenu reuse, inherited nil, explicit Off/high/on, and unrepresented values. Uses real native owner/menu code with synthetic WebSocket I/O.
- Diff whitespace check passed. No native compiler/test execution was available. Swift lint/format were blocked by missing pinned tools.
- **Pending:** actual native red/green logs, compiled candidate, exact candidate SHA, action/persistence checks, inspected before/after native screenshots, timing/cost, and final candidate review.

Reporter credit: @anmol0b supplied the original reproduction in #187607. The existing ClawSweeper issue review is source evidence, not independent native execution. This preparation must not be attributed as native proof by the reporter, Mert, or Codex.

## Work sessions

Public session links are intentionally absent from this private handoff draft. Before any separately authorized publication, resolve shareable exact discussion and implementation URLs and the required human credit, respecting privacy. This draft is not publication-compliant until that requirement and all proof gaps are resolved.
