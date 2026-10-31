# Issue 187607 isolated proof execution

This is a task-only validation branch, NOT a product fix PR. Original supplied kit and SHA256SUMS are unchanged. The workflow checks out exact upstream baseline 4591070b2f4b1b043b57c306fcd6d235e56b04a2 into a disposable credentialless macos-26 worker. Read-only Actions permissions; checkout credential persistence disabled. No operator app/Gateway/config involved.

## Run

After the repository maintainer clears GitHub's fork-wide Actions pause:

    gh workflow run ci.yml --repo PollyBot13/openclaw --ref proof/issue-187607

Follow the returned run and download artifact `issue-187607-native-proof`. Actions was reenabled by the owner. First run 41204689948 verified baseline red and ten native before-state screenshots, then failed at proof-only mouse selection. Its runtime review is retained separately; subsequent own-process event variants also failed on the hosted worker. This revision keeps WindowServer session routing only on that disposable VM. Bounded real Swift Testing probes reproduced failure after capture/cancel history despite accepted fresh-menu clicks and existing input permissions. Returning to the outer default run-loop mode between tracked popups passed ten captures then a real click; a 500ms delay and non-animated cancellation did not. That lifecycle barrier did not transfer to the full harness in run 41237191886: both phases still timed out on the first selection despite active/trusted input and fired timers. This revision keeps capture/reuse in one native process but runs each actual action plus its readback in a fresh native invocation. Product logic is unchanged.

## Ordered proof gates

1. Verify original kit hashes, actual OS/Xcode/Swift/Node versions; install repository-pinned tooling/dependencies and prepare Apple assets.
2. Add original regression PATCH.diff, build all macOS tests, invoke original guarded run-native.sh red. A build failure, launcher/setup failure, zero tests, or unrelated assertion is NOT baseline red proof. Manually inspect both regression arguments false/true for incorrect Off checkmarks and sibling outcomes.
3. Before production patch, run Issue187607MenuProof via the SAME genuine repository launcher. Capture inherited, high/on, same-row reversion to inheritance, Off, and unrepresented xhigh/full for both submenus. Drive actual native popup tracking with staged WindowServer CGEvents on the disposable hosted VM with matching global pointer in a fresh process per action/readback case, then verify exact sessions.patch target/field, readback/checkmark, other preference unchanged, distinct B unchanged. Store actual composited popup PNGs and receipts.
4. Independently of a baseline menu-harness failure (which still fails the job), apply original minimal two-method PROPOSED-FIX.diff after successful baseline red. Rebuild/run original green helper: same regression/sibling suites plus pinned lint/format/whitespace checks.
5. Each phase uses run-menu.sh: one ten-scenario capture/reuse invocation and four independent action/readback invocations seeded to the original sequence predecessors. aggregate-menu.py retains and verifies raw per-case receipts, explicitly labels isolation, and does not claim continuous cross-process persistence. Repeat this visual/action harness on fixed source, retaining source/diff/workflow hashes and all logs. Inspect and sanitize every image/receipt. The server is synthetic over actual loopback WebSockets, not an operator or production Gateway; images/actions remain real AppKit paths.
6. Independent review of actual results and changed candidate; manually reconcile check counts, red cause, zero-test risk, screenshot checkmarks and all action receipts. Assemble result report, commands, versions, durations, SHA256SUMS and ZIP integrity result. Split ZIP if needed for Teams <5 MB. Deliver representative Before/After images and complete evidence ZIP to requester. Do not call preparation or static parse results native validation.

## Proof-only harness boundary

Issue187607MenuProof.swift is copied only into the CI checkout test target. It uses production configureSessionItem and real loopback server. It never changes product production code. Session-level CGEvent mouse input on the disposable hosted VM uses native tracking; it is not physical human input, direct target/action invocation, or direct RPC substitution. Composited screenshots use /usr/sbin/screencapture on the unique owned popup. If WindowServer/screen capture fails, repair supported runner setup and rerun; never replace with synthetic checkmarks.

Local checks completed: all original kit hashes; six workflow Bash blocks syntax; YAML parse; proof Swift syntax parse; selected AppKit event/accessibility APIs typecheck. The first hosted run compiled the complete test target and verified intended regression assertions and baseline screenshots. Run 41232693884 also established identical fixed suites and static checks; successful preference selection/readback receipts remain pending the corrected full runtime run. This file is execution guidance, not a proof verdict.
