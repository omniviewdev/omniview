---
"@omniviewdev/runtime": patch
---

The curated `useConnectionMetadata` now reads the current `enabled` when its `refresh` is called: a `refresh` callback kept across a disable resolves without a request and without any change to the shared cache, even while another consumer of the same connection listens. Calling it while enabled still refreshes, and re-enabling restores it. The root hook is unchanged.
