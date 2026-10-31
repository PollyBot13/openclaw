# #187607 — unpublished regression handoff

## Status and provenance

Prepared on 2026-10-30 in the task-owned managed checkout. Resumption first verified a clean tree: the earlier failed attempt had made no edits. Base: `4591070b2f4b1b043b57c306fcd6d235e56b04a2`. No candidate commit SHA exists: no commit or publication was authorized or performed. `PATCH.diff` is **test-only**, not a completed production fix. SHA256SUMS.txt identifies the exact delivered files.

The reporter anmol0b supplied the original native failing assertion in [#187607](https://github.com/openclaw/openclaw/issues/187607). The existing [ClawSweeper review](https://github.com/openclaw/openclaw/issues/187607#issuecomment-6495259567) supplied source analysis, not independent native execution. This preparation independently read current sources and authored a regression; it did not execute the reporter reproduction. No Mert/Codex native execution is claimed.

## Coordination update — 2026-10-30 21:11 UTC

Mert reports that Eisenh0rn40 handed #187607 to our team. Treat this as the current human coordination decision; the former ownership question is resolved and withdrawn. It is not a GitHub assignment mutation. Eisenh0rn40 continues #187603 in [PR #188635](https://github.com/openclaw/openclaw/pull/188635) and #187602 in [PR #188683](https://github.com/openclaw/openclaw/pull/188683). Do not take over or combine those fixes. No coordination message was sent.

The issue read at this update still reports open and the original review. Earlier public inspection found no assignee and labels P2, clawsweeper:no-new-fix-pr, clawsweeper:fix-shape-clear, clawsweeper:source-repro, issue-rating: 🦞 diamond lobster, impact:ux-friction, clawsweeper:bulk-filed. Those label/assignee facts were not refreshed by the limited issue reader and are historical observations, not renewed ownership uncertainty. The bulk-filed/no-new-fix-pr policy evidence is unchanged. Everything remains unpublished by instruction.

## Verified overlap with #188635

Read the current four-file PR diff at head `a690bafd75b5ac9bde7195d660971480df06111a` (draft). Both shared-file patches were complete, not truncated; raw files at this SHA were also inspected.

- StatusMenuSessions.swift: #188635 changes retained preview lifecycle, per-menu task ownership, constructor/cache injection, configureSessionItem reuse (now also checking sessionKey), prewarm/cancellation, and preview creation/refresh. It does **not** change buildPreferenceMenu or updatePreferenceMenu; both false-Off fallbacks remain. Our proposed two-method fix passes git apply --check against its pinned source.
- StatusMenuSummariesTests.swift: #188635 adds rendered preview tests, helpers, held-response state and cleanup to UsageGatewayFixture. Our regression body and sessions.list override fixture remain distinct, but the shared insertion context after previewFails and its initializer capture overlaps. The unchanged PATCH.diff **does not apply cleanly** to that head (git apply --check exit 1 at old fixture line 331). Do not force it or replace the whole file. Preserve their holdPreviews, previewText, previewResponsesChanged, pendingPreviewResponses and cleanup; add only our sessionPreferences property/capture and sessions.list payload, plus our unchanged checkmark test.
- The other PR files, SessionMenuPreviewView.swift and docs/platforms/mac/menu-bar.md, are outside our scope. No #187602 changes are included.

Keep the existing base for the first red/green run. There is no need to stack on #188635 just to prove checkmarks. If it lands first or an integrated check is requested later, reconcile the fixture additions in a separate task-owned checkout and repeat the affected native suites; baseline identity and proof must name that new base. Do not change Eisenh0rn40's branch or use whole-file replacement.

The PR's latest public proof comment reports native execution for **its preview fix** and supersedes its older body on that point. This is attributed third-party evidence only: it neither grants us VM access nor proves #187607. Mac VM access remains unconfirmed; no provisioning or runner dispatch performed.

## Current-source finding

During the earlier completed preparation, observed main `48df899f6f1684d85dbab88077bd7efce224e904`. Its StatusMenuSessions.swift, SessionData.swift, and pre-edit StatusMenuSummariesTests.swift were downloaded read-only and verified byte-identical to this base. No rebase was needed for these owners. The local checkout has shallow/projected history; its one available log entry does not establish introduction attribution.

`StatusMenuSessions.configureSessionItem` calls construction or reuse according to the existing menu/route lease. At lines 317 and 345–347, both preference paths synthesize `off` when no stored override is represented. `SessionLoader` copies optional thinking/verbose fields unchanged. The gateway separates stored thinking from effective thinking; verbose resolution falls through session, per-agent and global defaults. See `docs/tools/thinking.md`, `src/gateway/session-utils-model.ts`, and `src/auto-reply/reply/get-reply-directives.ts`.

Invariant: check only a represented explicit override; nil/unrepresented is not Off.

## Smallest production repair — deferred until native red

Production files are unchanged. PROPOSED-FIX.diff now contains the exact unapplied proposal. After the isolated native regression fails at the intended assertion:

1. In `buildPreferenceMenu`, delete `let selected = levels.contains(current ?? "") ? current ?? "off" : "off"`; compare `current == level` when setting item.state.
2. In `updatePreferenceMenu`, delete the three-line `selected` fallback; compare the existing payload `value == current` when setting item.state. All preference items are generated by the owner with a nonnil value.

This removes four fallback-definition lines and changes two comparisons. No new Default action, string, setting, protocol, persistence, model catalog, or gateway change. Preserve actions and route/lease validation. Do not change preview behavior: #187603 is a separate task even though it shares StatusMenuSessions.swift. Serialize later owner-file edits and re-run both affected suites if that work changes the shared fixture.

## Regression and simplification pass

The patch extends the existing StatusMenuSummariesTests fixture and reaches real ControlChannel → SessionLoader → StatusMenuSessions.configureSessionItem → NSMenu objects. Only external WebSocket I/O is synthesized by the existing GatewayTestWebSocketSession; no real loopback socket/server is launched. It is an owning-boundary regression, not live gateway, rendered screenshot, or native execution evidence.

One test has fresh/reused-menu cases; it checks nil, explicit high/on, return to nil, explicit off, and unrepresented xhigh/full. Reuse asserts the parent and both preference submenu identities remain identical. Fixed expected selections do not derive from production. Fixture effective thinking is high for inherited rows; real configured non-Off verbose-default/UI proof remains pending.

Self-review/pr-simplify: reused the existing owner suite, no production test hook, no new helper class, no duplicate unit probe, no #187603 preview changes. Added test/fixture growth is necessary to reach both display paths; no JS test-line allocation applies to these Swift files under the current ratchet. See VALIDATION.md for retained evidence and MAC-EXECUTION.md for the single consolidated execution procedure.
