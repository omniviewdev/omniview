---
"@omniviewdev/runtime": minor
"@omniviewdev/vite-plugin": patch
---

Add optional, namespaced connection/server metadata with generation-bound snapshots, per-key freshness, explicit refresh, and ordered updates. Export `useConnectionMetadata`, `useConnectionMetadataSelector`, and shared collection subscriptions. Regenerate development shims for the new runtime exports.

The host mirrors SDK-owned observations separately from connection configuration and resource catalogs. Unsupported providers and unavailable transports remain distinct from unobserved facts. Kubernetes can display server endpoint, version, and platform without storing resource counts or credentials in metadata. Rebuild the host and metadata-enabled plugins against the matching SDK source cohort.

Present Kubernetes server facts in a compact identity panel and overview strip. Move observation details into keyboard-accessible tooltips, distinguish stale observations visually, and show loading placeholders without repeating freshness prose.

Add conservative Kubernetes environment and distribution hints, provider badges, optional region/zone chips, and settings-only copyable cloud identifiers. Reuse connection configuration and the existing server-version request without resource inventory or cloud API calls. Expose inference provenance and stale state instead of presenting hints as verified hosting.
