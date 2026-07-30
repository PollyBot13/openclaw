# PR #116504 runtime evidence

- Tested application head: `b5c35dba3107e42b5824f555b2f80710a0a9d425`
- Environment: disposable iPhone 17 simulator, iOS 26.5, fresh install and privacy state
- Application launch PID: `83559`
- `reminders-system-prompt.png`: the real EventKit Reminders authorization sheet before choosing Allow
- `reminders-after-grant.png`: the onboarding Reminders row showing a green check two seconds after choosing Allow, without relaunch

The same run also completed the Calendar full-access prompt and updated its row to a green check without relaunch. A read-only query of the disposable simulator's TCC database then returned authorization value `2` for both `kTCCServiceCalendar` and `kTCCServiceReminders`; `launchctl procinfo 83559` still resolved the original OpenClaw process.

These screenshots contain only the disposable simulator UI and no physical-device or private user data.
