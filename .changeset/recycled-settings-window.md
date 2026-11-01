---
"@omniviewdev/runtime": minor
---

Add `openSettings()` for the retained, application-instance Settings window and typed `omniview/settings/editor` contributions for plugin-owned field visuals. Settings opens through the native menu accelerator and application header without changing workspace tabs. Custom editors share host drafts, validation, accessibility, and Save/Discard, with generic fallback during failure or reload. Existing SDK descriptors and stored values remain unchanged.

Retain draft values and field focus while lazy custom editors load. Serialize retained navigation writes, restrict native targets to local Settings routes, and keep search shortcuts inside unsaved-change dialogs. AI Tools provides persistent draft actions and explicit partial-save feedback.
