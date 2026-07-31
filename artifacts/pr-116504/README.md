# PR #116504 runtime evidence

## Current-head proof

- Tested application head: `db6f8a6d9a6a0202824bc3588a37d5f60a0446c9`
- Environment: disposable iPhone 17 simulator, iOS 26.5, fresh install and privacy state
- Application launch PID: `26981`
- `current-head/calendar-system-prompt.png`: real Calendar full-access system sheet
- `current-head/calendar-after-grant.png`: Calendar row reconciled to a green check without relaunch
- `current-head/reminders-system-prompt.png`: real Reminders system sheet
- `current-head/both-after-grant.png`: Calendar and Reminders rows both reconciled to green checks without relaunch
- `current-head/terminal-proof.txt`: exact-head, process, TCC, test, build, and hash readback

The application bundle's embedded `OpenClawGitCommit` matched the tested head. After both grants, a read-only TCC query returned authorization value `2` for `kTCCServiceCalendar` and `kTCCServiceReminders`, while process `26981` still resolved the original OpenClaw executable. The focused current-head test lane passed 7 tests in 2 suites, native i18n reported `changed=false`, the iOS simulator build succeeded, and the final independent Codex review reported no introduced regression.

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
8f3ee6ea548be3e1a6be143baac9bedce0e1b6f39c34e609c7f4c26a18932f6b  calendar-system-prompt.png
fda66f2e3536d5652e65e5ea20e0f5f47f570c3f3deebec4822f5cf73d546be9  calendar-after-grant.png
1f4093ed9f5e18a8a1cdbffc4e37fcd17e0eafeda24c95c02a4e1206dcbb88c1  reminders-system-prompt.png
ffc4e627f0ae24434f96685a2c03bce4873229e018bcd63dc7c0d6e3f2bb9cc6  both-after-grant.png
```
