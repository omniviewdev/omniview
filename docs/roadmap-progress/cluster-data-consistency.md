# Cluster explorer: shared plugin-data consistency

Tracking: [#389](https://github.com/omniviewdev/omniview/issues/389), [#390](https://github.com/omniviewdev/omniview/issues/390), [delivery board](https://github.com/orgs/omniviewdev/projects/14).

## Contract

Functional `usePluginData` updates use a fresh backend snapshot and compare-and-swap, not a window-local cache as the authority. The backend serializes snapshot comparison and writes. Updaters must be pure and may run again after a conflict, with an eight-attempt bound. Exhaustion rejects explicitly; it does not silently discard a write.

Literal replacements retain last-write-wins behavior and do not require reading old JSON. Failed optimistic writes restore the prior cached value or the supplied default. An absent key and stored JSON `null` have distinct revisions.

## Exercised verification

- Go data-controller race tests passed.
- Eight runtime regressions passed, including a failed-before/passed-after unreadable-data literal reset.
- Real generated bindings in two independent browser contexts rejected stale revisions, preserved twenty increments and unrelated nested fields, and distinguished null from absence.
- A disposable counter survived an actual host-generation restart and was then deleted.
- A second live probe mounted the actual served `usePluginData` hook in two independent React roots and QueryClients. Twenty simultaneous functional increments preserved nested fields; backend and disk agreed. Literal replacement and cleanup passed.

![Actual hook concurrency verification](../images/cluster-data-consistency/actual-hook-owned-fixture.png)

The screenshot is a labeled temporary verification consumer, not production UI. No store mock, fabricated write failure, raw credential publication, or active-profile corruption was used. A tight unsynchronized stress loop could exhaust the documented conflict bound; the error surfaced explicitly.

## Release compatibility

Base UI 0.14.0, ai-ui 6.1.8 and editors 6.1.8 form the UI cohort. The consuming runtime must declare the matching Base UI peer and ship with a host that implements the snapshot/CAS bindings. Build runtime before Vite-plugin shims. Workspace source links do not establish published-package compatibility.
