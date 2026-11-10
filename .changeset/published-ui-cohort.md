---
"@omniviewdev/providers": minor
"@omniviewdev/runtime": minor
"@omniviewdev/vite-plugin": minor
---

Consume the published renderer cohort: Base UI 0.17.2, AI UI 6.1.13, and editors 6.2.4. Update the host and runtime build input together, with one matching lockfile graph and no local UI replacements or peer overrides. The runtime's existing `~0.17.0` Base UI peer range admits 0.17.2 and remains unchanged.

Release host, providers, runtime, and Vite-plugin 0.35.0 as one cohort. The latest desktop tag is v0.33.0, but npm 0.34.0 already exists; changed producer build inputs require a fresh version, not reuse of those immutable artifacts. Advance development and nightly compatibility to 0.35.0 so source builds accept plugins declaring this cohort's minimum IDE version.

After verification and merging, freeze the host commit and dispatch the existing release workflow at that ref with `version=v0.35.0` to publish npm packages only. Build providers, then runtime, then Vite-plugin so generated development shims use the current runtime exports. Validate independent plugin consumers against those published packages, then tag that same frozen host commit v0.35.0 for the desktop release. Do not change host sources or build inputs between npm publication and desktop tagging. Source package versions remain workflow-stamped from the release input.

These renderer and dependency changes do not establish that scrolling smoothness is solved; retain workload-specific production verification and release-artifact checks.
