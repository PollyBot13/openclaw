# PR #193600 native layout comparison

These are privacy-cropped screenshots of the New session options sheet only, captured manually in Device Hub on the same iPhone 17 simulator, iOS 27.2, at accessibility XXXL. The fixture agent is Molty, with `workspaceGit=false`; the keyboard was hidden and Separate working copy was off. The crop deliberately excludes the chat behind the sheet.

- `main-iphone17-xxxl.png`: production Swift files at current-main `9f07ae4789dc727d992b61208ed06601633cb013`; title is above the fixed medium sheet, the toggle label is truncated, and Cancel is below the visible sheet.
- `candidate-iphone17-xxxl.png`: layout commit `eef431bac6f8442085edcfc82c7a45dd8079bda2`; title, explanation, full toggle label and actions are visible in the large sheet. A manual Cancel tap dismissed the sheet, but that action is not depicted in this still image.

The later task tip `612140c312ec5bb1f8cb8619b587fb67f4b8e9a4` and Robo's published PR head `e767a466cd5691b82b27dec8d58c2ec4fed82369` preserve the same production layout blob.

`candidate-xcuitest-iphone17-xxxl.png` is the screenshot attachment from a separate, exact-source `xcodebuild test` run on iPhone 17 / iOS 27.2 at accessibility XXXL. The focused `AdaptiveLayoutUITests.testNewSessionOptionsRemainReachableAtAccessibilitySize` passed 1/1 on 5 November 2026 at 20:50 CET after recompiling the test target from task tip `612140c312ec5bb1f8cb8619b587fb67f4b8e9a4`. Its geometry attachment recorded window `(0,0,402,874)`, title `(41,82,208.7,50.3)`, hittable Cancel `(64.7,738.3,116,46)`, and Create Thread `(190.7,708.3,170.3,106)`; the test tapped Cancel and observed dismissal. The local result bundle is `exact-source-ui-test.xcresult` under Engineering's private `pr193600-native-20261105` artifact. This is a focused simulator test, not a full suite or real Gateway effect.

These images and the focused test do **not** establish real working-copy ON, keyboard entry, or Create Thread effects against a Gateway. Separate local synthetic-fixture observations cover ON and keyboard layout only.

## Matching automated baseline red

At 21:05 CET, Engineering restored **only the two production Swift files** to current-main `9f07ae4789dc727d992b61208ed06601633cb013`, keeping the same focused UI test source, device, runtime, accessibility size and Xcode 27.2 setup. A fresh `xcodebuild test` failed **1/1 on the original visual behavior**: `New Thread title is not visible` at `AdaptiveLayoutUITests.swift:48`. The baseline attachment recorded window `(0,0,402,874)`, title `(47.4,335.3,200.4,48.3)` with `isHittable=false`, and Cancel starting at `y=840.1` with height `44.2`, extending past the 874-point window. The local result bundle is `exact-source-baseline-red.xcresult` under the same private artifact. The test and production sources were restored to the candidate tip afterward; the worktree was clean. The uncropped XCTest screenshot includes unrelated fixture chat and is **not public**.

Together with the rebuilt candidate green above, this is a matching focused automated red/green for the iPhone 17 accessibility XXXL sheet. It does not broaden the scenario or prove real Gateway effects.

## Smaller iPhone automated check

`candidate-xcuitest-se3-xxxl-initial.png` is the initial screenshot attachment from the same exact-source focused test on an iPhone SE (3rd generation), iOS 27.2, accessibility XXXL, at 21:11 CET. The 375×667-point viewport initially shows the title, explanation and toggle; Cancel/Create Thread start below the visible window (Cancel `y=696.5`, not initially hittable). The test then swiped the form until both actions were contained and Cancel was hittable, tapped Cancel, observed dismissal, and **passed 1/1 in 16.57 seconds**. This is smaller-viewport reachability proof, not a claim that all controls fit without scrolling. It remains fixture-only and does not verify real Gateway effects.
