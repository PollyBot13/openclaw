# PR #139023 real-Gateway visual proof

These captures use disposable loopback OpenClaw Gateways and synthetic session data only.

- `upstream-main-background-loading.png`: exact upstream UI and Gateway at `41651036f27f672e17dfb0f2b81aa084f7715805`; a background managed-list refresh disables the manual control and labels it `Loading…`.
- `pr-background-stable-refresh.png`: PR head `02630a3e77a978678786d3eb3698bb212b0b1c16`; the same background refresh leaves the manual `Refresh` control enabled.
- `pr-manual-refresh-loading.png`: PR head while an explicit manual refresh is in flight; the control is disabled and labels itself `Loading…`.
- `pr-manual-refresh-complete.png`: PR head after that manual request completes; the control returns to enabled `Refresh`.

For each capture, the isolated browser delayed resolution of the real `sessions.list` response by 1.5 seconds so the transient state remained visible. No Gateway response or roster payload was mocked.
