---
"@omniviewdev/runtime": minor
"@omniviewdev/vite-plugin": patch
---

Discover installed supported native terminal applications through the macOS application registry and expose device-provided names and 64px PNG icons. Settings uses an icon-backed picker with explicit refresh, loading, unavailable, and error states while preserving saved adapter IDs and the existing draft/save/discard flow. Removed applications never trigger a silent fallback. Native launch resolves installed applications again without regenerating icons; supported launch adapters and built-in terminal behavior remain unchanged.

The runtime supports base-ui 0.10.x and 0.11.x so published plugins and the current host remain peer-compatible.
