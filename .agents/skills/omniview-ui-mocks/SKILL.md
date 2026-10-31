---
name: omniview-ui-mocks
description: Use when designing or proposing an Omniview UI change and the user wants mocks, screenshots, a clickable/interactive prototype, an animation GIF, or an issue/PR write-up with images of the proposed behavior.
---

# Build grounded, interactive UI mocks

A mock is a proposal reviewers judge against the real app. Make it look and behave like Omniview, prove it with real input, and publish images that stay put.

1. **Ground in the real app.** Capture the running instance's pixels, sample colors, read real sizes/shortcuts/routes/plugin metadata from source, and check existing filtering rules before inventing lists. See [grounding](references/grounding.md). Use **omniview-instance-verification** to select and observe the right instance read-only; use **omniview-repo-map** to route to the owning code.
2. **Build one self-contained HTML prototype.** No build step; CSS variables from sampled colors and base-ui tokens; a state machine driven by real keyboard/mouse input; URL params for variants (today's layout, single plugin, platform labels); realistic data; `window.__mock.freezeAt(ms)`. Extract real icons with [`scripts/extract-react-icons.mjs`](scripts/extract-react-icons.mjs). See [prototype](references/prototype.md).
3. **Drive it with real input and capture.** Headless Chromium at 1440x900, real key/mouse events, log and assert state after each step, numbered screenshots named by flow step. See [capture](references/capture.md).
4. **Review every screenshot and iterate.** Look at each image, fix what reads wrong, re-run the whole capture driver.
5. **Animations:** freeze frames at fixed offsets, assemble a GIF with ImageMagick, check frames with `montage` ([capture](references/capture.md#animation-gif)).
6. **Publish.** Orphan asset branch in the user's fork, SHA-pinned raw URLs each checked for HTTP 200, issue body with behavior table, captioned screenshots, real file paths and acceptance criteria. See [publishing](references/publishing.md).

Keep mocks and screenshots outside the repository (for example `~/omniview/mocks/<topic>/`, `~/omniview/screenshots/<topic>/`) unless the user asks to commit them. State design decisions explicitly so reviewers can push back. Report **prototype path → variants/URL params → screenshot list → GIF → published URLs/issue → what was not grounded or verified**.
