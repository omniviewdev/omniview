---
"@omniviewdev/runtime": minor
"@omniviewdev/vite-plugin": patch
---

Export the headless `useTableMetricObservation` hook and named option/state contracts for resource tables from any plugin. The runtime now owns mounted-cell reference counting, quiet-period target batching, document visibility pauses, result indexing, and initial-versus-background loading state. Targets retain admitted host membership, reference, and route; missing presentation-body membership never fabricates a target. Registration cleanup is idempotent, and upstream source/catalog errors stop collection without leaving loading active.

Keep provider polling, admission, and result reuse in the host coordinator. Resource plugins retain source preferences, columns, physical bounds, and presentation; provider-specific endpoint failure handling remains in the provider. Regenerate the runtime development shim after building the runtime so source-linked plugins can import the new public hook.

Publish the runtime and matching Vite-plugin cohort before shipping consumers of this new export. Managed source builds do not establish that the export exists in previously published runtime releases.
