---
"@omniviewdev/runtime": patch
"@omniviewdev/vite-plugin": patch
---

Consume the published Base UI 0.15.0, editors 6.2.0, and AI UI 6.1.9 cohort. Align the runtime's Base UI peer range with the host and share the standalone `@omniviewdev/base-ui/metrics` entry in production and generated development shims.

Release host/runtime/Vite plugin 0.30.2 before updating independent plugin consumers. Advance development compatibility to 0.30.2 so source builds accept plugins declaring this UI cohort's minimum IDE version. Keep independent Workspace Probe bootstrap pins on their compatible registry cohort until the runtime and Vite-plugin release publishes, then update its manifest and lockfile together.
