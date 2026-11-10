# Physical iPad Safari evidence, November 10, 2026

Reporter outcome: the tall-page dashboard worked with the candidate; the ordinary multi-widget control FAILED, unchanged versus unpatched. The reporter explicitly clarified: "no change versus unpatched." The recordings support the narrow tall-page improvement and the unchanged grid failure. The remaining grid bug/root cause is unresolved; the test outcome is a failure, not unknown. Additional telemetry is diagnostic only and is not needed to accept the reported failure. These recordings do not establish a new candidate regression.

## Versions and fixture

- Candidate/source head: `6ddce47fac561860377eaaea68b094db3986c211`.
- Baseline stylesheet: `8569bd9edfadb9d08539083cae19b3680ef49b3c`.
- The baseline fixture uses the candidate runtime with the exact baseline `ui/src/styles/board.css`; the candidate fixture uses the candidate stylesheet. This is a stylesheet-isolated comparison, not a full historical baseline build.
- Synthetic real Control UI dashboards, mock gateway, native iframe isolation, physical iPad Safari operated by the reporter. No touch emulation or gesture interception.
- Exact iPad model and OS version were not supplied. A partial candidate export reports Safari Version/27.0.1, desktop-style Macintosh/MacIntel identification, 1376 x 867 CSS viewport, devicePixelRatio 2. Physical-device identity is reporter-supplied, not inferred from that UA.

## Recordings and approximate review timestamps

Times are relative to the original recordings, not tester marks. The reporter could not see confirmation after pressing Mark moment and stopped trying; the helper records a mark silently. Touch release is not visible in the recordings, so exact release timing cannot be independently claimed.

| Original recording | Approximate interval | Observation |
| --- | --- | --- |
| `ScreenRecording_11-10-2026 21-16-54_1.MP4` (baseline, 77.8 s) | 19-38 s | Tall page in split view reaches sections near the bottom without the green final marker. |
| Baseline | 40-42 s | Expanded tall page shows the green final marker. |
| Baseline | 43-47 s | Restored split view does not show the final marker. |
| Baseline | 52-77 s | Ordinary grid tested in split and expanded views; final markers are not shown. |
| `ScreenRecording_11-10-2026 21-18-37_1.MP4` (candidate, 52.12 s) | 16-20 s | Tall page reaches the green final marker in split view. |
| Candidate | about 22-24 s | Expanded tall page shows the green final marker. |
| Candidate | 25-32 s | Final marker remains visible after returning to split view. |
| Candidate | 36-52 s | Ordinary grid tested in split and expanded views; final markers are not shown. |

## Dashboard-only clips

Four clips were prepared for the existing Roboclaw conversation, with browser tabs, bookmarks, chat, sidebar, audio and source metadata excluded. Fixed crop: source x=1840, y=520, width=880, height=1470, output 440 x 736. In expanded views this shows only the right portion of the dashboard; use it with that limitation. The private originals were retained locally.

| Clip | Original range | SHA-256 |
| --- | --- | --- |
| `baseline-tall.mp4` | baseline 18-48 s | `68a1c3243e4f1c02346aa8fd8225364dbb8711d4a6b714712f60d85f4722239a` |
| `candidate-tall.mp4` | candidate 15-33 s | `2d1ad9e04a721f38db284eae432398ca3b3441b078f2c531e7b88a6e2a502b75` |
| `baseline-grid.mp4` | baseline 52-77 s | `a8e84ceb62be8c7012bf58faaf4c75957e87d3bb7a6abb6f782c39dfc3366788` |
| `candidate-grid.mp4` | candidate 36-52 s | `dcbab139bab045797e4027c889782b9452f3999dc87b004dfb7dbb9f339f086d` |

## Telemetry qualification

The first attached `ipad-scroll-candidate-1794341532973.json` is the earlier Windows Chrome validation export, collected at 20:12:12.973Z. It must not be described as physical iPad telemetry.

The later one-page PDF screenshot of the candidate export is partial: collectedAt 20:25:33.610Z, with samples beginning at 20:18:42.675Z and cutting off around 20:18:53.830Z. It contains initial touch events and early tall-page scrolling, not the grid trial. It shows board clientHeight=scrollHeight=756, overflowY=hidden, iframe height=726 in split view. Its final JSON object is incomplete; do not treat reconstructed text as a complete machine-readable export or invent missing samples. Full exports from the still-open iPad test tabs are pending. Private tailnet addresses are omitted here.

## Acceptance status

- Physical reporter-confirmed tall-page improvement, supported by before/after recordings.
- Ordinary multi-widget scrolling FAILED, unchanged versus baseline, per the reporter and paired recordings. The bug/root cause and exact input routing remain unestablished; the failure outcome itself is established.
- No claim of complete iPad telemetry, exact release timing, all dashboard cases passing, or production deployment. PR #196797 should retain these qualifications and remain draft pending its owner's decision.

