---
"@omniviewdev/runtime": minor
---

Add read-only `UiInspection.GetStatus(windowName)` for opt-in native WebKit inspection on macOS 13.3 or later. The host applies a default-off, restart-only policy to main, Settings, restored, and later native windows. Compact profiling status reports actual inspectability and Safari app/page labels, not inspector attachment or an active recording. Public AppKit/WebKit APIs require no remote-debugging port, private API tag, or sandbox change.

Document the verified Safari Timelines recording workflow, sensitive-data warning, unsupported platforms, initial-navigation and multiwindow-label limits, and observed zero-timestamp samples. Go host and plugin pprof behavior remains separate.
