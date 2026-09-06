# Memory maintenance status — visual evidence

Control UI source in Chromium, macOS, light theme, 1280×900, isolated browser context and synthetic conversation. Gateway WebSocket transport is mocked with repository E2E helpers; no production account, conversation or memory data is used.

- Before: main at a5597cc69ed, existing preparing_context status (Preparing this turn…).
- After: proposed memory_flushing status (Saving conversation memory…).
- Reconnected: page reload restores the in-flight memory_flushing event.

The browser scenario also asserts transition to starting_model (Waiting for a response…) and removal of the indicator after final assistant output. These captures verify UI presentation, not a live provider or memory write. Separate memory-owner tests cover actual maintenance function status emission and cleanup on success/failure.
