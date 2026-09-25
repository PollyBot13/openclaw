# Issue 157444 status recovery captures

Captured by OpenClaw macOS CI run 36103180308 at PR head d1e8068ff89. The original before/after PNGs from run 36102231363 have identical SHA-256 hashes in this passing current-head run.

- before.png reconstructs the original generic worker-error presentation with the same schema-mismatch diagnostic.
- after.png renders the candidate production StatusMenuProblemLineView with app-update guidance and an Update control.
- no-updater.png renders the same mismatch without an Update control when no updater callback is supplied.

These are inspected, sanitized, synthetic component captures, not screenshots of a signed running app, not Sparkle updater execution, and not command-recovery proof.

## Installed-app VM capture

`real-menu-development-signed.png` is an inspected 1024×768 capture of the **actual status menu** in a disposable macOS 15.7.7 Tart VM. The app was packaged from PR head `d1e8068ff898b796f9627e4149737b0df37b46d3` and signed with Apple Development. A VM-only state database at schema 20 causes its bundled worker (supports schema 19) to refuse startup. The menu visibly gives app-update guidance and, correctly for this signature, offers no disabled Sparkle Update action. The screenshot came from the VM framebuffer, not a synthetic component renderer. Its paths and background belong only to the disposable VM.

This does **not** reproduce the published 2026.9.5→2026.9.6 release split or prove Developer ID-signed Sparkle update and restored worker commands. That final acceptance remains with the signing/update environment owner.
