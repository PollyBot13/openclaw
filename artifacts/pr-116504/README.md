# PR #116504 runtime evidence

## Current-head proof

- Tested application head: `7088a4712d3b69111581f3814c92f84e25bd7a71`
- Environment: disposable iPhone 17 simulator, iOS 26.5, fresh install and privacy state
- Application launch PID: `53526`
- `current-head/calendar-system-prompt.png`: real Calendar full-access system sheet
- `current-head/calendar-after-grant.png`: Calendar row reconciled to a green check without relaunch
- `current-head/reminders-system-prompt.png`: real Reminders system sheet
- `current-head/both-after-grant.png`: Calendar and Reminders rows both reconciled to green checks without relaunch
- `current-head/terminal-proof.txt`: exact-head, process, TCC, test, build, and hash readback

The application bundle's embedded `OpenClawGitCommit` matched the tested head. After both grants, a read-only TCC query returned authorization value `2` for `kTCCServiceCalendar` and `kTCCServiceReminders`, while `launchctl procinfo 53526` still resolved the original OpenClaw executable. The focused current-head test lane passed 7 tests in 2 suites, native i18n reported `changed=false`, and the iOS simulator build succeeded.

## Earlier proof

The original exact-head run at `b5c35dba3107e42b5824f555b2f80710a0a9d425` is retained in `reminders-system-prompt.png` and `reminders-after-grant.png`. It independently showed the same Reminders transition and unchanged-process result before the branch was rebased.

## Privacy and redaction contract

- Audience: public OpenClaw maintainers and reviewers.
- Proof goal: show real EventKit sheets completing and both onboarding rows reconciling without relaunch.
- Visible data: OpenClaw simulator UI, system permission copy, exact commit, process ID, authorization values, and test/build results.
- Private data: none. The simulator was disposable, contained no signed-in accounts, and was deleted after capture. Calendar's displayed birthday is Apple simulator sample data, not user data.
- Secrets/tokens/endpoints: none captured.

## SHA-256

```text
9f7258c9c04c8bac32075cf87805027d3a2cb8c85f4990bb2aa3fbfbd3da066b  calendar-system-prompt.png
d5ad142d757d1696c99f28bf7fc26697ecb47028875df47bcb0dc35c40afd79e  calendar-after-grant.png
3f9194f8382132d39cde3c466229c6060afc015206f19f8325c8e5ee1634a259  reminders-system-prompt.png
f3dcb9bd13898f3a9e5371f20376645aa9e26c08208a28deb25f0df05622fa3b  both-after-grant.png
```
