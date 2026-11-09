---
"@omniviewdev/runtime": minor
"@omniviewdev/vite-plugin": patch
---

Export the headless `useTableMetricObservation` hook and named option/state contracts for resource tables from any plugin. The runtime now owns mounted-cell reference counting, bounded target batching (demand publishes after 120 ms without change and no later than 250 ms after its first unpublished change, so continuous scrolling still publishes), document visibility pauses, result indexing, and per-cell loading state through `isLoadingFor(body, metricID)` beside the table-level `isLoading`. Targets retain admitted host membership, reference, and route; missing presentation-body membership never fabricates a target. Published targets and their samples survive a replaced `recordsByBody` until the replacement bodies publish, but never across another plugin, connection, or resource type, and a recreated resource never shows its previous incarnation's samples. An admitted cell without a sample reports loading while its registration awaits publication, a hidden document pauses collection, or its request has not answered; it stops once it holds any sample, its request settles without one, an error occurs, or collection is disabled. Registration cleanup is idempotent, no timer outlives the owning table's unmount or a StrictMode replay, and upstream source/catalog errors stop collection without leaving loading active.

Keep provider polling, admission, and result reuse in the host coordinator. Resource plugins retain source preferences, columns, physical bounds, and presentation; provider-specific endpoint failure handling remains in the provider. Regenerate the runtime development shim after building the runtime so source-linked plugins can import the new public hook.

Publish the runtime and matching Vite-plugin cohort before shipping consumers of this new export. Managed source builds do not establish that the export exists in previously published runtime releases.
