---
"@omniviewdev/runtime": patch
---

Limit the render and allocation fan-out of resource, metric and activity updates.

A source view applies the patches of one frame to a single copy of its record map and keeps the object of every record a patch or a new generation repeats unchanged, matched by host key. A patch that changes nothing keeps the map itself and a status event that repeats the current status publishes nothing, while every change event still advances the snapshot revision. `useResources` collection pages no longer pair records by position, which after a delete replaced every later record with a copy that no decoded row, selection or metric target recognized. A notification that changes neither the records nor the status writes no query cache entry and re-renders nothing, and a page whose records are unchanged keeps the same `records` array, so a table can depend on `acquired.page.records` rather than on the page.

`useMetricObservation` serializes each target once, rebuilds its request identity only when an input changes instead of on every render, and keeps the object of each result that a newer frame repeats unchanged. Source-view generation fences, connection readiness fences, `RESET_REQUIRED` reacquisition and per-incarnation sample withholding are unchanged.

`useTableMetricObservation` keeps its released API and delivers samples in the owning React update. Remove the unreleased per-cell store: publishing it from a layout effect forced a second synchronous commit after sample delivery. Keep stable target identities, repeated-result reuse and per-cell loading through the existing accessors.

`useNotifications` and `useActivityActions` read the provider's store-bound actions and the unread count apart from the rest of the activity state, so a task's progress no longer re-renders every component that only calls `notify`. Their signatures are unchanged.
