# PR #116504 runtime evidence

## Current-head proof

- Tested application head: `7cefc4705e97175a3a5127ddef9e915e66b405c8`
- Rebased upstream main: `b252df88494e0bf1b5ea882fa7c74c1f786874e5`
- Environment: disposable iPhone 17 simulator, iOS 26.5, fresh install and privacy state
- Application launch PID: `43489`
- `current-head/calendar-system-prompt.png`: real Calendar full-access system sheet
- `current-head/calendar-after-grant.png`: Calendar row reconciled to a green check without relaunch
- `current-head/reminders-system-prompt.png`: real Reminders system sheet
- `current-head/both-after-grant.png`: Calendar and Reminders rows both reconciled to green checks without relaunch
- `current-head/terminal-proof.txt`: exact-head, process, TCC, test, build, and hash readback

The application bundle's embedded `OpenClawGitCommit` matched the tested head. After both grants, a read-only TCC query returned authorization value `2` for `kTCCServiceCalendar` and `kTCCServiceReminders`, while process `43489` still resolved the original OpenClaw executable. The focused current-head test lane passed 7 tests in 2 suites, native i18n reported `changed=false`, the iOS simulator build succeeded, and the final independent Codex review reported no introduced regression.

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
d000ff0058ed9e9448fff9db357009357f2452a21120275b26ae987d3e495217  calendar-system-prompt.png
8ed231cedc2f926aada81ca0e9f2289c41659258b444bfafa25914b9c09ae981  calendar-after-grant.png
9929b10d271d6d95a4e4e5eb50078545dd8d641885f6ebd802a5daf4694847a6  reminders-system-prompt.png
e135edabeea1346177147986fe624e9d533f5258bfd5d94467a725e4d494c7c2  both-after-grant.png
```
