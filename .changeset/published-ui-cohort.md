---
"@omniviewdev/providers": patch
"@omniviewdev/runtime": patch
"@omniviewdev/vite-plugin": patch
---

Consume the published renderer cohort: Base UI 0.17.3, AI UI 6.1.14, and editors 6.2.5. Update the host and runtime build input together, with one matching lockfile graph and no local UI replacements or peer overrides. The runtime's existing `~0.17.0` Base UI peer range admits 0.17.3 and remains unchanged.

Base UI 0.17.3 starts the delayed pulse of loading metric cells from one shared timer and paints row divider lines behind the unrendered part of a fixed-row-height virtual table body.

Release host, providers, runtime, and Vite-plugin 0.36.1 as one cohort. Build providers, then runtime, then Vite-plugin so generated development shims use the current runtime exports. Source package versions remain workflow-stamped from the release input.
