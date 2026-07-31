# PR 116683 exact-head runtime evidence

OpenClaw head: `097303eadc594ef3d2fc23e2805abcd2e1b787e9`

Base used for the clean rebase: `db633878d7a34d2f9d3f44f6626485a08dbd6b4a`

The proof used a disposable ClickClack workspace, user, bot, and channel on a
loopback-only ClickClack server. No personal workspace or account data appears
in these artifacts. The ClickClack arm64 server binary SHA-256 was
`75193f733beeb2e3b0e46d50156f2935262e95bb6827f6efcbea1aafa4b93fe5`.

## Supported endpoint

`supported-final-transcript.jsonl` drove the real ClickClack REST and realtime
paths from the exact OpenClaw head. Fifty line updates were coalesced to three
accepted `agent.progress` requests: initial status, latest line, and clear.
The durable final reply completed in 8 ms, finalization in 1 ms, and a GET of
the created message matched the submitted body.

`active-progress-final.png` shows `Agent is responding` and the latest
`Exact-head progress 50/50` line in the real ClickClack web UI.
`final-after-cleanup-final.png` shows the durable final reply in the same fresh
channel with the progress line removed.

## Stalled endpoint

`degraded-final-transcript.jsonl` used a loopback reverse proxy that accepted
ordinary ClickClack requests but deliberately never answered
`/api/realtime/ephemeral`. Both progress requests reached their independent
15-second transport timeout, while the durable final reply completed in 16 ms,
read back successfully, and progress finalization returned after 1002 ms.

## SHA-256

```text
2e72d7511cef104b285a086c2ebbd0b61cedf7457dd70f98bb635d2d5b845cbb  active-progress-final.png
9265087ce50e6a6107e976facd22c39779fdb0ced498879a06fff1d0fd0fa9fc  final-after-cleanup-final.png
371ca8f34287a1a61048c0d21fdd4a348f9b5c44562eb2d4e61da586cd0db32f  supported-final-transcript.jsonl
7052e20b1a7ae0a76cd2540b3302272f44421b99052183ad4c99f118ffda0099  degraded-final-transcript.jsonl
```
