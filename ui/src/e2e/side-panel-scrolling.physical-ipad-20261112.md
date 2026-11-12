# Physical iPad recording of the November 12 touch-sizing experiment

The new recording shows a clear multi-widget improvement over the previous patch: the candidate reaches green final markers in split and expanded views, while the previous revision stops above them. The proof toolbar visibly confirms five marks on each build. This is new-head physical-device video evidence, separate from the prior November 10 grid failure.

## Exact comparison

- Before: `6ddce47fac561860377eaaea68b094db3986c211`.
- After: `c7decbdf1a06fef89346ec221f79bee44ec97453`.
- Two complete production Control UI builds, one from each exact revision; no stylesheet substitution. Identical synthetic mock Gateway content and native nested iframe sandbox. Test-only HTML injection supplies the mock, passive telemetry and toolbar. Its synthetic Gateway build identity was aligned with each built UI. Product source remained unchanged.
- Original recording: `ScreenRecording_11-12-2026 20-54-04_1.mp4`, 115.91 seconds, 2752 x 2064. Private browser tabs/bookmarks appear in the original; it is retained locally and must not be uploaded unchanged.
- Reporter used the established physical iPad Safari test. Exact model/OS, connected input accessories, numerical frame geometry and browser media-query results are not supplied by the video. Do not substitute the earlier desktop JSON for this session.

## Observed sequence

Approximate times below refer to the original recording, not the cropped clips.

| Original interval | Visible outcome |
| --- | --- |
| 0-13 s | BEFORE landing identifies the old revision, then the ordinary-grid test opens. |
| 18-24 s | BEFORE grid in split stops around lower sections, without the final marker; mark 1 appears. |
| 25-33 s | BEFORE grid expands to two columns; final markers are not reached; mark 2 appears. |
| 34-38 s | BEFORE restored split remains above the final marker; mark 3 appears. |
| 44-54 s | BEFORE tall-page check reaches green in split and expanded views; marks 4 and 5. |
| 58-69 s | Switch through AFTER landing into its ordinary grid. |
| 79-93 s | AFTER split grid shows final green marker(s); the compact Fixed control is visible and its content can reach its own green marker; marks 1 and 2. |
| 94-101 s | AFTER expanded grid shows both Auto cards' final markers and the Fixed control's final marker; mark 3. |
| 103-114 s | AFTER tall-page check shows green in split and expanded views; marks 4 and 5. |
| About 115 s | Safari displays its native download confirmation for the candidate JSON, with View and Download actions. Recording ends before a successful file save is shown. |

Touch indicators are absent. The user was instructed to mark after lifting their finger and observing whether the page stays or snaps back. Visible marks associate the test observations with times; the video does not independently expose the exact physical release instant. Do not infer unrecorded Auto-to-Fixed toggles, mouse/trackpad transitions, a complete nested-feed trial, exact unchanged Fixed-card geometry, or a separately marked candidate grid restored-split pass.

## Visible mark confirmations (UTC, read from the recording)

| Mark | BEFORE | AFTER |
| --- | --- | --- |
| 1 | 19:54:26 | 19:55:28 |
| 2 | 19:54:35 | 19:55:35 |
| 3 | 19:54:40 | 19:55:41 |
| 4 | 19:54:51 | 19:55:51 |
| 5 | 19:54:56 | 19:55:56 |

These are transcribed visible labels, not recovered JSON samples. No missing numerical telemetry is reconstructed. The reporter states the export was not working, but confirms marking. The terminal Safari prompt proves a download was offered, not that a file was successfully saved. Video evidence remains usable without that export.

## Sanitized clips

Each clip stacks a dashboard crop above the proof toolbar from the same source frame. This is a disclosed spatial composition, not a full-screen capture. Browser chrome, unrelated chats, audio and source metadata are excluded. Split crop x1840/y400/w880/h1500; expanded crop x640/y400/w2100/h1500; toolbar crop x0/y1900/w1200/h150. No intermediate layout is inferred from pixels omitted by these crops.

| Clip | Original range | SHA-256 |
| --- | --- | --- |
| `before-grid-split.mp4` | 18-24 s | `6b2d5a3dfec2f59f8b7758b91abd65aced5db621a2ce167258e10ef14660d202` |
| `before-grid-expanded.mp4` | 26-33 s | `4c48bbdac1f29185d65c69dffaeaee360b77cfde9a1493c714f3653125d95f7f` |
| `after-grid-split.mp4` | 76-93 s | `42617fa7f4bfdc4f5be0f8f6b1f7f2c85fd8782fea6e8812adb21672572aa577` |
| `after-grid-expanded.mp4` | 94-101 s | `fefa7a6c2e1df4e80315483dded8bab5d5eb538fc82d5d25a109da804a0d488c` |

The inspected grid comparison supports recording-observed improvement on the physical iPad for the new head. It is not a claim that every requested regression or device/input configuration passed. Keep any remaining checklist gaps explicit. No merge or production deployment is authorized by this evidence handoff.

