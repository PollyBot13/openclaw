# November 17 physical iPad follow-up: remaining functional checks

The supplied recording and successful JSON export support PASS for the requested candidate restored-split trial, independent nested feeds, and Auto-to-Fixed-to-Auto sizing trial on this device. This completes the requested practical iPad follow-up for the existing candidate; it does not authorize merging or deploying it, certify every device/input configuration, or establish a WebKit root cause.

## Identity and evidence boundary

- Exact candidate/source head in the export: `c7decbdf1a06fef89346ec221f79bee44ec97453` (AFTER).
- Reporter states: **iPad Pro 13-inch M4, iPadOS 27.2.1, no mouse or trackpad connected**.
- Exported Safari UA reports `Version/27.2 Safari/605.1.15`, with desktop-style Macintosh/MacIntel identification. These do not contradict the reporter's iPad identity, but do not independently attest the hardware/OS version.
- All ten marks record `finePointer=false`, `maxTouchPoints=5`, viewport 1376 x 867 CSS px, visual scale 1, DPR 2.
- Full production candidate UI with the same synthetic mock Gateway, passive proof helper, and native nested sandbox used in the November 12 trial. No new product edits, stylesheet swaps, synthetic gesture injection, or forced scroll assignments in this physical trial.
- Original files: `ScreenRecording_11-17-2026 16-50-17_1.MP4` (117.39 s, 2752 x 2064) and `ipad-scroll-candidate-1794930765343.json` (1,958 samples; collected 2026-11-17T15:52:45.328Z). The latter is an actual Safari export, unlike the earlier Windows validation JSON.

## Marked observations

Times are UTC on November 17. Board values below are measured by the top-frame helper at the mark. Prior inner-widget readings are asynchronous messages with recorded ages in the accompanying readings; they must not be described as simultaneous cross-frame measurements.

| Mark | UTC | Observation and geometry |
| --- | --- | --- |
| 1 | 15:50:35.467 | Expanded grid at outer end: width1066, clientHeight756, scrollHeight5932, scrollTop5176, remaining0. Both Auto iframe heights5582. |
| 2 | 15:50:42.517 | **Restored split, first Auto footer visibly reachable.** Board width480, scrollTop5452; both Auto iframe heights6107. Latest first-widget touchend is1.034s before the mark; its root has no remaining range. |
| 3 | 15:50:48.994 | **Restored split, second Auto footer visible and outer board reaches its end.** Board clientHeight756, scrollHeight12664, scrollTop11908, remaining0. Latest second-widget touchend is3.137s before the mark, root remaining0. |
| 4 | 15:50:55.662 | Fixed control's inner content reaches its end: latest root scrollTop5887, remaining0; board remains at11908. Fixed iframe height220. |
| 5 | 15:51:02.017 | Expanded again at outer end5176/5176. Both Auto iframe heights5582; Fixed iframe220. Final markers shown. |
| 6 | 15:51:23.296 | **Both nested feeds reach their own end1658/1658 while the outer board and Auto document roots remain at0.** Video shows each feed moving independently. |
| 7 | 15:51:43.858 | **First Auto toggled off:** first iframe shrinks5582->1308; second remains5582. Fixed control remains220. |
| 8 | 15:51:49.753 | **Second Auto toggled off:** both iframe heights1308. Board scrollHeight1648. Fixed control remains220. |
| 9 | 15:51:58.812 | Both now-fixed documents scroll internally to root scrollTop4274, remaining0. Outer board remains0 with892 remaining. This is NOT a claim that fixed-card final markers are visible or that fixed mode eliminates nested scrolling. |
| 10 | 15:52:07.756 | **Auto restored on both:** iframe heights return5582, board scrollHeight5932, scrollTop5176, remaining0; final markers visible again. Fixed control remains220. |

### Independent feed measurement details

The first observed nonzero feed-scroll sample through the first feed-at-end sample occurs at15:51:16.940–15:51:18.516 for `grid-one` and15:51:14.190–15:51:16.566 for `grid-two`. In each range, all recorded outer-board offsets and inner-document-root offsets are0, while the feed advances to1658 with zero remaining distance. Mark6 records the completed state. This distinguishes feed scrolling from scrolling the whole dashboard.

### Fixed control and accepted pinning tradeoff

Every recorded visible `fixed-control` iframe geometry in this export has height220px, across split/expanded layouts and the Auto toggles. This is iframe geometry, not an independently measured total card-height assertion. The video also shows the control remaining compact. Pinning the very tall Auto cards to Fixed restores internal scrolling and the smaller bound, as explicitly accepted before implementation; restoring Auto removes the ordinary long documents' internal range again. Mark9 retains that distinction rather than treating fixed mode as a full-document-fit success.

## Sanitized files for Roboclaw

Three MP4s stack a dashboard crop above its proof toolbar from the SAME source frame. This disclosed spatial composition is not a full-screen capture. Browser tabs/bookmarks, unrelated chat, audio, source metadata and the terminal Control Center view are excluded. Split dashboard crop x1840/y400/w880/h1500; expanded x640/y400/w2100/h1500; toolbar x0/y1900/w1200/h150. Private originals remain local.

| File | Original video interval / contents | SHA-256 |
| --- | --- | --- |
| `restored-split.mp4` | 19–40s; marks2–4 | `28863b5e5610739d895340549630f6b6313fa8d1744f9ec774203e10128813e6` |
| `independent-feeds.mp4` | 54–70s; feed scrolling and mark6 | `f8ec4e5f6c19aadd62a5a5ba2c32f18ad93a516f998f14e2365462dede002300` |
| `auto-fixed-auto.mp4` | 74–113s; menus, marks7–10 and final restored Auto markers | `5ef3e7b80c43b4ce3b87c265560e27a90be1310ce98d09170424d4ee06f1ec33` |
| `ipad-candidate-nov17-redacted-compact.json` | All 1,958 sample values unchanged; only the two top-level private tailnet-origin values are redacted, with an explanatory field added; insignificant JSON whitespace removed for attachment size | `bdca6ad83a7559eb5dd31808d5cea4f086211f9b64aef41785832e4e41ebb438` |

The [companion marked-readings file](./side-panel-scrolling.physical-ipad-20261117.readings.json) contains the ten marked top-frame measurements, earlier widget readings with explicit ages, the independent-feed ranges and the fixed-control iframe-height set. It is a derived, selected evidence file; the full sample stream is attached separately in the existing Roboclaw conversation.

## Limits and handoff

The video and telemetry cover the remaining requested functional checks on the reporter's stated device. Touchend events are in the export; no touch indicators expose the exact physical finger-release instant independently in the video. There is no claim of all-device certification, pointer-accessory transition coverage, eliminated nested scrolling for Fixed cards, numerical total-card-height invariance, or a proven Safari root cause. Normal current-head CI/review and readiness remain Roboclaw's responsibility. This handoff grants no merge or production-deployment authority.

