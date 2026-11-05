# PR #193600 native layout comparison

These are privacy-cropped screenshots of the New session options sheet only, captured manually in Device Hub on the same iPhone 17 simulator, iOS 27.2, at accessibility XXXL. The fixture agent is Molty, with `workspaceGit=false`; the keyboard was hidden and Separate working copy was off. The crop deliberately excludes the chat behind the sheet.

- `main-iphone17-xxxl.png`: production Swift files at current-main `9f07ae4789dc727d992b61208ed06601633cb013`; title is above the fixed medium sheet, the toggle label is truncated, and Cancel is below the visible sheet.
- `candidate-iphone17-xxxl.png`: layout commit `eef431bac6f8442085edcfc82c7a45dd8079bda2`; title, explanation, full toggle label and actions are visible in the large sheet. A manual Cancel tap dismissed the sheet, but that action is not depicted in this still image.

The later task tip `612140c312ec5bb1f8cb8619b587fb67f4b8e9a4` and Robo integration `a604622ab3873981ab007e3f2e1e4ffbaa6be8b6` preserve the same production layout blob. These images do **not** establish working-copy ON, keyboard, Create Thread effects, or an XCTest pass.
