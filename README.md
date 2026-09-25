# Issue 157444 synthetic status-row captures

Captured by OpenClaw macOS CI run 36103180308 at PR head d1e8068ff89. The original before/after PNGs from run 36102231363 have identical SHA-256 hashes in this passing current-head run.

- before.png reconstructs the original generic worker-error presentation with the same schema-mismatch diagnostic.
- after.png renders the candidate production StatusMenuProblemLineView with app-update guidance and an Update control.
- no-updater.png renders the same mismatch without an Update control when no updater callback is supplied.

These are inspected, sanitized, synthetic component captures, not screenshots of a signed running app, not Sparkle updater execution, and not command-recovery proof.
