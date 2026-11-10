# Mergebeat live Chromium evidence — November 10, 2026

Investigation evidence only. No fix, merge, deployment, or Safari verdict.

## Source and execution boundary

- Owning draft: https://github.com/openclaw/openclaw/pull/196797
- Fetched and checked-out draft head: `023ef9b66c1e34a5be8d7e0b5f97908f4be4c1a9`.
- Pinned investigation source: `8569bd9edfadb9d08539083cae19b3680ef49b3c`.
- The draft differs from that source by one investigation Markdown packet only.
- Evidence below comes from the existing live Mergebeat dashboard, not a server running this checkout. The identity menu displayed `git@ecbad2e`; the complete served build SHA was not verified. Do not bind live behavior to the checkout SHA.
- Browser: Codex in-app Chromium, Windows host. Exact Chromium version and page zoom unavailable through the permitted inspection surface; neither was changed. Viewport: 1280 × 720 CSS pixels.
- Input: browser automation scroll commands, locator clicks with automatic scrolling into view, and Ctrl+End. No physical touch, mobile emulation, WebKit, or iPad Safari test.
- Read-only probes measured the top document and inner widget through the normal nested frame locator. They read geometry/styles only. No security settings, shared widget content, or permissions changed.

## Observed geometry

Offsets and dimensions are CSS pixels. `maximum = scrollHeight - clientHeight`.
Samples are ordered; individual action timestamps were not recorded. The chat/tool record retains the sequence. Do not infer velocity or inertia from these samples.

| State | Outer board | Outer iframe | Inner document | Outcome |
| --- | --- | --- | --- | --- |
| Dashboard in main/left split | 634px viewport; no outer remainder | 484 × 634 | 2535px scrollHeight; initially 0/1901 | Main presentation fits the iframe to the available height. This is different from dashboard in the right side panel. |
| Expanded dashboard | 634px viewport; no outer remainder | 970 × 634 | 1537px scrollHeight; after Ctrl+End, 903/903 | Footer bounds 563.84–603.84 inside 634px inner viewport. The inspected expanded screenshot shows the footer. |
| Dashboard swapped to right side | 634px viewport; scrollHeight 1376; maximum 742 | 434 × 1346 | Initially 903/1237 | The iframe exceeds the outer scrollport; two independent document/board ranges exist. |
| Right side after inner heading click and Ctrl+End | 369/742; 373 remaining | top -270, bottom 1076 | 1237/1237; zero remaining | Inner bottom does not imply outer bottom. Footer top 1247.05 in inner viewport projects to top-page y≈977.05, below the 720px viewport. |
| After scroll command in right outer gutter at (1260,580), down 3 pages | 742/742; zero remaining | top -643, bottom 703 | 1255/1255 after scrollHeight changed to 2601 | A sample reached both ends. Inner footer top 1247.05 projects to y≈604.05. This is a geometry observation, not stable native gesture proof. |
| Later sample | 369/742 | top -270, bottom 1076 | 210/1255 | Offsets differed from the preceding sample. Cause unresolved; no controlled release trace or proof of spontaneous snap-back. |
| Expanded from right side, after Ctrl+End | zero outer remainder | 970 × 634 | 903/903 | Expanded capture again shows footer. |
| Restored right split; locator clicked inner contentinfo | 742/742 | top -643, bottom 703 | 1255/1255 | Browser auto-scroll into view can reach this geometry. It does not prove wheel/touch handoff. |

The widget also has a nested PR-feed scrollport: 475px clientHeight, scrollHeight 4398, scrollTop 0 in the narrow right-side samples (3923px remaining). At expanded width its scrollHeight was 3690 (3215px remaining). Distinguish this feed from the inner document and outer board.

## Screenshot and tooling qualification

Three sanitized local crops were inspected: an initial lower split view, expanded footer, and restored split view. They contain only dashboard content; unrelated sidebar/chat/profile information was cropped out.

The expanded crop agrees with its footer geometry. The restored split crop still displays the PR feed and People section, whereas the adjacent DOM sample projects the footer into the visible area. The earlier split capture has the same limitation. Consequently these split crops are **not matched visual confirmation of both scrollports at bottom**. A rendering/capture/automation discrepancy remains unresolved. Do not use these images as proof of product clipping, Safari snap-back, or success of a native gesture.

Other tooling observations: an initial scroll command over widget content did not change the first samples; pressing Ctrl+End through a frame-root locator timed out, although a later read showed changed offsets. Subsequent input used the tab keyboard method. Locator clicks can auto-scroll ancestors, so later offset differences cannot establish automatic product reversal. An attempted browser metadata read was unavailable; no alternate security or private-state inspection was used.

## Conclusion and next proof

The measurements independently confirm different scroll ownership between main/expanded presentation and a dashboard in the right side panel. Right side mode can contain a 1346px iframe in a 634px outer board and an independently scrolling inner document. A browser-input gutter action produced a sample at the outer bottom. This supports investigating nested scrolling and input routing; it does not prove the reported iPad defect or justify changing the row cap.

Still needed: exact physical iPadOS/Safari version and live build, timestamped touch and release sequence over iframe versus gutter, synchronized top/inner/nested offsets, and visually aligned split/expanded captures. Exact Chromium version and zoom remain unrecorded here. The widget's changing content height and capture mismatch must remain part of any interpretation.

Local validation: fetched the requested PR head and verified the one-file investigation-only diff against its pinned base. No dependencies installed, product tests run, test assertions added, or runtime code changed. No claim that Chromium gestures pass or fail the Safari reproduction. Original PR ownership remains with Roboclaw.

The companion `side-panel-scrolling.chromium-readings.json` contains sanitized measured samples in collection order. Exploratory labels beginning `side-` refer to the dashboard in the main/left split, before it was swapped into the right side panel. Labels are descriptions of attempted actions, not passing assertions. Samples carry no individual timestamps.

