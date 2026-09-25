# Issue 157444 synthetic status-row captures

Captured by OpenClaw CI run 36102231363 at PR head d7146083cf38e62fbb18a7b8a3058771f572c1df.

- before.png reconstructs the original generic worker-error presentation with the same schema-mismatch diagnostic.
- after.png renders the candidate production StatusMenuProblemLineView with app-update guidance and an Update control.

These are inspected, sanitized, synthetic component captures, not screenshots of a signed running app, not updater execution, and not command-recovery proof. The later PR head only changes the screenshot test's accessibility inspection, not production rendering.
