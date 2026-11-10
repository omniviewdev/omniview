---
"@omniviewdev/runtime": minor
"@omniviewdev/vite-plugin": patch
---

Limit the render and allocation fan-out of resource, metric and activity updates.

A source view applies the patches of one frame to a single copy of its record map and keeps the object of every record a patch or a new generation repeats unchanged, matched by host key. A patch that changes nothing keeps the map itself and a status event that repeats the current status publishes nothing, while every change event still advances the snapshot revision. `useResources` collection pages no longer pair records by position, which after a delete replaced every later record with a copy that no decoded row, selection or metric target recognized. A notification that changes neither the records nor the status writes no query cache entry and re-renders nothing, and a page whose records are unchanged keeps the same `records` array, so a table can depend on `acquired.page.records` rather than on the page.

`useMetricObservation` serializes each target once, rebuilds its request identity only when an input changes instead of on every render, and keeps the object of each result that a newer frame repeats unchanged. Source-view generation fences, connection readiness fences, `RESET_REQUIRED` reacquisition and per-incarnation sample withholding are unchanged.

`useTableMetricObservation` keeps `metrics`, `register`, `tokenFor` and `isLoadingFor` as released and adds an optional, additive view of the same observation and registry: its `cells`, rendered with the new `useTableMetricCell(cells, body, metricID)` hook, which returns a cell's `sample`, `isLoading` and `error` by the same rules as those accessors. `cells` keeps one identity for the life of the owning hook, and a cell re-renders only when its own answer changes, so a table that shares `cells` through context no longer re-renders every metric cell for another row's sample, an offscreen record update or a swapped `recordsByBody` that changes no answer. Consumers of the existing accessors need no change. Regenerate the runtime development shim after building the runtime so source-linked plugins can import the new hook, and publish the runtime and matching Vite-plugin cohort before shipping a consumer of it.

`useNotifications` and `useActivityActions` read the provider's store-bound actions and the unread count apart from the rest of the activity state, so a task's progress no longer re-renders every component that only calls `notify`. Their signatures are unchanged.
