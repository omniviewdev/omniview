# Kubernetes loading and idle CPU investigation

## Result and limits

The reported dashboard cost (53.5% Graphics and Media, 35.6% WebContent) is the production problem, not a synthetic benchmark result. This investigation found avoidable resource-event amplification and implemented bounded fixes in the host runtime and sibling Kubernetes plugin. It has **not** established which native Graphics stack consumes that CPU or demonstrated that Omniview beats Lens on the reported connection.

The active kubectl context available during investigation was `kind-kind`, with 12 pods, not the reported approximately 300-pod cluster. No production context was selected or modified. A running native host was sampled only to exercise the sampler; that uncontrolled host sample is not an acceptance measurement. No SDK-v2 workspace files were changed.

Initial acquisition of N complete objects necessarily costs at least O(N) bytes/work. The correct goal is to avoid acquiring unrelated kinds, make visible work depend on viewport and changed results, and keep steady-state rendering independent of total cluster size. Claiming constant-time full-cluster initial loading would be misleading.

## Implemented fixes

### Host runtime: indexed batch application

`packages/omniviewdev-runtime/src/hooks/resource/useEventBatcher.ts`

Previously, each event scanned the entire resource array with `findIndex`. A burst of E updates over N resources cost O(N × E), before React Query structural sharing and rendering.

Multi-event batches now build one identity index, apply updates in input order, and compact deletions once. Normal work is O(N + E). Single events retain the single-scan path. No-op batches retain the old cache object. First-match behavior for pre-existing duplicate IDs, delete/re-add ordering, missing IDs, and strict-equality handling of NaN remain unchanged. This does not fix the legacy identity design, namespace-membership semantics, or duplicate hook ingestion globally.

Verification: 36 existing/new batch tests passed. A throwaway deterministic differential run matched the original reducer for 10,000 mixed-event batches, including duplicate, missing, NaN, and signed-zero IDs.

### Kubernetes table: one observer and stable dynamic columns

Sibling repository `../omniview-plugin-kubernetes`:

- `ui/src/components/shared/table/ResourceTable/index.tsx`
- `ui/src/components/tables/ColumnFilter/useDynamicResourceColumns.tsx`

The dynamic-column hook previously created another `useResources` observer. React Query deduplicated the initial List, but each hook still owned event listeners, a batcher, and cache writes. The column hook now consumes the table's existing unfiltered results. Discovered labels/annotations preserve their state references unless new keys appear; status-only changes no longer rewrite both localStorage entries. Combined table columns are memoized.

A real Chromium smoke mounted the production discovery hook with 3,000 synthetic pods. Twenty status updates caused zero additional storage writes. Enabling the `app` column and discovering `zone` preserved the selection and added the new key. The focused regression passed. This smoke did not mount the complete Kubernetes table or native WebView.

### Kubernetes informer: suppress unchanged-version replays

Sibling `pkg/plugin/resource/resourcers/base.go` skips Update handling before JSON encoding only when resource versions are equal and nonempty, and UID/name/namespace/API version/kind remain unchanged. Changed versions, replacement identities, and empty versions still flow through. Initial ADD replay and acquisition policy remain unchanged.

This targets informer replay work, including the configured 30-minute resync. It is **not** evidence of a continuous idle polling cause or a fix for the reported Graphics CPU by itself.

## Reducer benchmark evidence

Run from host checkout:

```bash
node bench/app/resource-batch.mjs /tmp/resource-batch-current.json
# Optional original source snapshot, captured before editing:
node bench/app/resource-batch.mjs /tmp/resource-batch-baseline.json /path/to/original/useEventBatcher.ts
```

The runner bundles the actual reducer, captures source bytes before compilation, builds fixtures outside timing, warms each case three times, and records nine samples. Reports include all samples and the source SHA-256. The original snapshot used here reconstructs the exact pre-edit file observed during investigation; its SHA-256 is `ddb0093f4e7b89fa5424ae4daccb75307f18f00421b8870fec7ea4ef1df582c8`.

The [preserved PR evidence](https://github.com/omniviewdev/omniview/pull/210#issuecomment-6505282754) contains both original reducer receipts, including source fingerprints and all samples. Node v26.12.0, macOS arm64, Apple M5 Max. Medians in milliseconds:

| Resources | Workload | Before | After |
|---:|---|---:|---:|
| 300 | Update all | 2.135 | 0.069 |
| 3,000 | Update all | 213.390 | 0.441 |
| 10,000 | Update all | 2,412.102 | 1.388 |
| 300 | Duplicate ADDs | 2.432 | 0.052 |
| 10,000 | Duplicate ADDs | 2,408.052 | 1.262 |
| 300 | One update | 0.0227 | 0.0232 |
| 300 | Delete all, forward order | 0.050 | 0.106 |
| 10,000 | Delete all, forward order | 5.007 | 1.675 |

Small forward-order deletion batches pay more index overhead. There is no material single-update improvement. Full bursts show the removed quadratic behavior; they do not imply that all 300 pods change every frame. Fixtures contain small synthetic pod-shaped objects, not production managedFields-heavy bodies. These numbers exclude transport, query-cache structural sharing, hooks, render, paint, and native process CPU.

## Why loading and live updates amplify

Paths below are relative to the sibling Kubernetes checkout unless prefixed `host` or `SDK`. SDK selection is the host's published `github.com/omniviewdev/plugin-sdk v0.7.0`, not proof of the source used by an already-running binary.

| Boundary | Evidence | Consequence |
|---|---|---|
| Acquisition policy | `pkg/plugin/resource/resourcers/base.go`, `register_v1.go`; SDK `pkg/v1/resource/watch_manager.go:164-239` | Most discovered resource kinds use `SyncOnConnect`, beyond visible views. |
| Cold watch setup | `base.go` Watch: LIST limit-one preflight, informer startup, cache sync | Per-kind startup work precedes usable data. |
| Initial ADD | Informer Add handler plus explicit post-sync cache ADD emission | Two emission sources exist. Exact duplicate delivery count needs a controlled sink measurement before removal. |
| List/Find | `base.go:167-228` ignores `ListInput` | The runtime's requested page size 200 does not bound Kubernetes List payloads. Namespace/order/pagination are not pushed down by this path. |
| Full bodies | Resource handlers marshal complete objects | Dashboard counters receive data unnecessary for their visible output. |
| SDK delivery | `pkg/v1/resource/plugin/server.go:557-631`, `client.go:472-538` in SDK | Full individual events cross gRPC; sends share a mutex, reception dispatches sinks synchronously. |
| Host gating | `backend/pkg/plugin/resource/controller.go:1292-1320`, `subscriptions.go`, `sink.go:65-113` | UI subscriptions gate Wails forwarding, not source acquisition, gRPC delivery, registry, or graph work. |
| Registry/indexer | Host `registry/memory_store.go:32-60`, `indexer/dispatcher.go:10-106`, `graph/graph_indexer.go:28-35` | Updates reindex labels and rebuild edges; a bounded queue can backpressure delivery. |
| Dashboard observers | `overview/index.tsx:120-157`; `WorkloadStatCards.tsx` | Dashboard still has two Pod observers. The table duplication was removed, not global hook duplication. |
| Dashboard events | `overview/EventsTable.tsx:142-183,259-283,347-363` | Groups/sorts the complete event set and mounts every matching row. No virtualization. |
| Metrics | `ClusterResourceGauges.tsx`, `ClusterMetricsSection.tsx`, `usePodMetricsBatch.ts` | Queries generally refresh every 30 seconds; Pod metrics use batch requests, not one request per pod. |
| Editor schemas | `pages/ClusterResourcesPage.tsx:131-151` | Schema work starts before an editor opens. |

The two dashboard Pod hooks share List data but independently apply incoming events. Centralizing event ownership remains more important than merely memoizing dashboard components.

## Graphics and idle attribution

No continuous chart RAF loop or chart CSS animation was found. `TimeSeriesChart.tsx` renders static SVG after loading; it uses ResizeObserver and pointer-driven interaction. The runtime batcher's RAF is event-triggered, not an unconditional frame loop.

Concrete animation candidates are loading surfaces: chart/workload/gauge Skeletons, connection Spinner, and populated-table syncing Progress. Shared base-ui source has infinite skeleton, spinner, and indeterminate-progress animation. Installed-package provenance must be checked before attributing source behavior to the reported build.

Inspect the actual idle page in Web Inspector:

```js
console.table(document.getAnimations().map(a => ({
  name: a.animationName,
  state: a.playState,
  target: a.effect?.target,
  timing: a.effect?.getComputedTiming(),
})));
```

For a reversible attribution experiment, save and pause only currently running animations, measure native CPU, then restore those same animations:

```js
window.__perfAnimations = document.getAnimations().filter(a => a.playState === 'running');
window.__perfAnimations.forEach(a => a.pause());
// Capture the same route/viewport and native PIDs, then restore:
window.__perfAnimations.forEach(a => a.play());
```

A CPU drop implicates animation/compositing, not a particular component until targets are inspected. Fix stuck loading/error/sync lifecycle rather than hiding a valid progress indicator. Do not disable all animations blindly.

## Ranked remaining work

### Easy: local changes with direct counters

1. Share dashboard Pod results between health and phase summaries. Count event applications and cache commits before/after.
2. Make age updates share a visibility-aware clock with age-dependent cadence. Preserve seconds precision for young objects. Both plugin AgeCell and legacy host TextCell have per-cell one-second timers.
3. Gate Pod metric work on visible metric columns and active view. Verify correct refresh when columns return.
4. Defer editor schema registration until editor use, retaining error reporting and editor readiness.
5. Avoid unchanged label-index/graph rebuilds using the fields those indexes actually depend on. Do not suppress unrelated status delivery.
6. If native recording confirms large persistent skeleton animation cost, fix unavailable/loading states and use static placeholders where appropriate.

### Medium: shared ownership and bounded UI work

1. Centralize live event ingestion per cache/query identity. Readers subscribe to one owner; retain correct namespace scope, initial List/watch handoff, generation, teardown, and multiple-consumer behavior. Test mount/unmount races and resource deletion.
2. Virtualize dashboard events using the existing virtualizer convention, measured row heights, bounded overscan, stable deduped identity, and full search/filter access. Mounted rows must stay viewport-bounded at 300/3,000/30,000 events. Do not truncate the event list as a substitute.
3. Batch/coalesce transport and UI notifications with count/byte/time bounds. Preserve delete/recreate and incarnation transitions. Bound latency and queues; dropping events requires explicit reset/recovery.
4. Remove duplicate initial ADD emission only after proving callback/replay ordering and initial-state completeness with a real informer stream.
5. Reuse overlapping cluster metric queries; separate live versus historical windows so refresh does not repeatedly query a fixed stale range.

### Large: source demand and result delivery redesign

1. Add source-demand coordination independent of UI query leases. Dashboard, search, sidebar counts, relationships, logs, metrics, and background consumers all declare needs. Hiding a table must not stop acquisition needed by another consumer.
2. Keep authoritative bodies in a canonical indexed store. Deliver dashboard aggregates and projected table results rather than full objects; fetch full representation for details/editor. Representation and schema availability must remain explicit.
3. Implement bounded source paging plus host query membership/sorting/windowing. Do not silently treat the first page as complete or use source page boundaries as final UI result boundaries.
4. Maintain incremental aggregates and result deltas. Flat immutable arrays still copy/compare O(N) on sparse changes even after this reducer fix. Indexing one batch is not a durable O(1) resource store.

Each tier needs a before/after receipt before its gains can be combined. The large tier is a design migration, not implemented by this change.

## FreeLens comparison

Inspected existing `~/Repos/freelens` at commit `0c8f34ac6c5fe6546e25c7591abe335c8ca2b689`. Source inspection only; no FreeLens native benchmark ran.

- [Watch-store buffering](https://github.com/freelensapp/freelens/blob/0c8f34ac6c5fe6546e25c7591abe335c8ca2b689/packages/core/src/common/k8s-api/kube-object.store.ts#L459-L469) batches notifications at approximately one second. Its drain still scans per event and sorts; do not copy that quadratic algorithm.
- [Default watch ownership](https://github.com/freelensapp/freelens/blob/0c8f34ac6c5fe6546e25c7591abe335c8ca2b689/packages/core/src/renderer/kube-watch-api/kube-watch-api.ts#L107-L196) reference-counts default store subscriptions and aborts on final disposal.
- [Virtual list](https://github.com/freelensapp/freelens/blob/0c8f34ac6c5fe6546e25c7591abe335c8ca2b689/packages/core/src/renderer/components/virtual-list/virtual-list.tsx#L46-L123) uses react-window; ready overscan defaults to 10.
- [Cluster metrics](https://github.com/freelensapp/freelens/blob/0c8f34ac6c5fe6546e25c7591abe335c8ca2b689/packages/core/src/renderer/components/cluster/cluster-metrics.injectable.ts#L15-L32) refresh at minute cadence; [bar charts disable interpolation](https://github.com/freelensapp/freelens/blob/0c8f34ac6c5fe6546e25c7591abe335c8ca2b689/packages/core/src/renderer/components/chart/bar-chart.tsx#L156-L158).
- [List](https://github.com/freelensapp/freelens/blob/0c8f34ac6c5fe6546e25c7591abe335c8ca2b689/packages/utility-features/kube-api/src/kube-api.ts#L629-L648) is full JSON, not evidence of compact projection/default pagination. [Watch](https://github.com/freelensapp/freelens/blob/0c8f34ac6c5fe6546e25c7591abe335c8ca2b689/packages/utility-features/kube-api/src/kube-api.ts#L914-L940) parses streamed event objects.
- Hidden cluster frames remain mounted in the inspected switching path. No blanket pause of all hidden work was established. The chart wrapper also lacks an unmount destructor. FreeLens is useful comparative evidence, not an unquestioned implementation template.

## SDK-v2 carry-forward contract

Limited review: [resource-v2-spec-review.md](https://github.com/omniviewdev/plugin-sdk/blob/feature/history-p45-boundary-fd468e8a/docs/resource-v2-spec-review.md), local history-p45-smoke workspace, mapping/review sections only. No large implementation review or edits.

- Source acquisition and final host results remain separate. `SourcePage` and advisory `bestEffort` updates do not supply a durable coordinator, host query engine, or result lease system.
- Performance ownership keys include canonical identity, access route, binding generation, and incarnation where required. Query dimensions are not identity or authorization proof.
- Fence queued batches and late results against retirement/restart. Never coalesce across incarnations or publish old-generation results.
- Preserve lossless canonical values. A compact UI projection must not replace the authoritative full body, schema, or representation-availability state.
- Negotiate optional enumeration/query/watch capabilities. No universal CRUD/list/watch assumption or legacy Find fallback.
- Bound batch count, bytes, latency, queue growth, and recovery independently from frame/body validation. SDK candidate 32 MiB frames and 16 MiB bodies do not constitute an acceptable UI result budget.
- Keep one native connection registry and coordinated utility admission. Do not create another acquisition registry for dashboards.
- Advisory lossy updates require declared freshness, reconciliation/reset, completeness, and reconnect semantics. No silent event dropping.
- Port the reducer's indexed application and no-op identity behavior to host result deltas, not by copying v1's arbitrary accessor identity. Port column discovery's single-owner consumption and no-op state preservation independently of SDK wire design.
- The Kubernetes resourceVersion replay guard is provider-local. Preserve it across SDK migration; it does not replace generation fences or authoritative recovery.

## Native acceptance protocol

Use the same cluster, namespace selection, app versions, viewport, foreground state, and time window for Omniview and FreeLens. Record pod/event counts and actual event arrival rate. Keep build mode and native engine differences explicit.

1. Capture cold connection-to-first-visible-data and connection-to-synced separately; include API discovery, source List/watch setup, encoding, gRPC, Wails bytes, JS parse/cache work, and paint.
2. Warm for 30 seconds. Capture three 60-second runs on dashboard, Pods table, and hidden view, with pointer outside charts. Repeat at 300 and 3,000 pods using a controlled stream when possible.
3. Capture native host, WebContent, Graphics/GPU, and plugin process PIDs separately. Verify their command/start identity; do not sum unrelated shared WebKit processes.
4. Count React commits, event applications, timer callbacks, long tasks, mounted rows, animation targets, bridge messages/bytes, queue depth, and metric requests. Record a no-events replay separately from real-cluster idle.
5. Pause/restore animations for attribution. Test status-only bursts separately from label changes and delete/recreate transitions.

Runnable cumulative-process sampler:

```bash
node bench/app/native-idle.mjs \
  --pid host="$APP_PID" --pid webcontent="$WEB_PID" --pid graphics="$GPU_PID" \
  --seconds 60 --interval 1 --scenario dashboard-idle-run-1 \
  --out /tmp/omniview-dashboard-idle-1.json
```

The sampler records raw cumulative CPU times, interval CPU, mean CPU as percent of one logical core, RSS, process start identity, and sampling overhead. It rejects missing/exited processes rather than reporting fake zero. PID selection, cluster/build provenance, and route attestation remain operator responsibilities. Short captures are quantized by ps time precision. This sampler was smoke-tested against a running native host and against an exited PID; no target dashboard/Graphics acceptance capture occurred.

Each `ps` snapshot captures start identity, process age, and CPU together under the
C locale. Processes younger than two seconds are rejected to prevent same-second
PID-reuse ambiguity; warm the app before sampling.

Proposed gates, not achieved claims: native WebContent and Graphics each below 1% mean during controlled no-events idle, no ongoing paints/commits with unchanged visible data, and lower CPU than matched FreeLens runs during real-cluster idle. At least three runs must show the result. Retain responsive input during bursts; don't trade away correctness or defer unbounded work to navigation. Agree on real-cluster event-rate and peak-loading budgets from matched baseline receipts rather than asserting a synthetic speedup beats Lens.

## Integration checks and environment limits

- Host reducer regression: 37 tests passed after adding the frozen-cache safety regression, using the runtime package's existing Vite/Vitest config. From `packages/omniviewdev-runtime`, run `node ../../node_modules/vitest/vitest.mjs run src/hooks/resource/useEventBatcher.test.ts`. The host root default Vitest include covers only `ui/`, so invoking the runtime test through that root config finds no tests.
- Kubernetes dynamic-column regression: one test passed. Production-hook Chromium interaction also verified 3,000 rows, 20 status updates without storage writes, retained selected columns, and discovery of a new label.
- Runtime reducer language-server diagnostics: clean.
- Plugin `tsc --noEmit` did not pass. Its installed `@omniviewdev/runtime` lacks search/icon exports used elsewhere in the checkout (`SearchActionReferenceV1`, `SearchScopeV1`, `ResourceIcon`, `resourceQueryKeys`, among others); further errors occur in those same search/icon consumers. No reported error names either changed column file. A fully composed plugin build remains an integration prerequisite; these focused checks do not certify the complete release.
- Running the first host test through `pnpm exec` reconciled installed host dependencies with the existing manifest and ran its yaml-worker postinstall. Subsequent checks invoked installed binaries directly to avoid another package-manager reconciliation.

### Latest-main release integration

The release worktree uses the latest main dependency cohort. The full runtime suite
reported 197 passing tests, four failures in resource-icon/plugin-context consumers,
two stale exact-shape assertions in the bounded-batcher tests, and a missing
`C02_ERROR_CORPUS` CI fixture. The bounded-batcher assertions now check delivered
resource data without pinning incidental response defaults. These unrelated suite
failures were not suppressed. Focused batch regressions now pass (37 tests).

The production-reducer benchmark smoke and live/missing/invalid-PID sampler smoke
passed. Scoped ESLint reported no errors; its configuration ignores the test file.
Neither smoke verifies full-app behavior or native CPU acceptance.

Recommend host/runtime `v0.9.1` after `v0.9.0`. Do not manually bump package
manifests: `.github/workflows/npm-publish.yml` stamps providers, runtime, and
vite-plugin from the release version and builds runtime before vite-plugin.

## Provider benchmark evidence

From the sibling Kubernetes checkout:

```bash
GOWORK=off go test ./pkg/plugin/resource/resourcers \
  -run 'TestMakeEventHandler_|TestWatch_ChangedAndEmptyVersionUpdates' \
  -bench 'Benchmark(MakeEventHandler_Update300Pods|Base_ListRepresentativePods)$' \
  -benchmem -benchtime=200ms -count=3 -timeout=90s
GOWORK=off go test ./pkg/plugin/resource/resourcers -count=1 -timeout=90s
```

Both commands passed. The complete resourcer suite took 4.649 seconds. An earlier combined run hung in the newly added test teardown because the shared informer factory owns a stop channel separate from the watch context. The test now calls `StopFactory()` before `Shutdown()`; the production connection lifecycle was not changed.

The [preserved provider receipt](https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/51#issuecomment-6505283224) includes all three benchmark samples and source hashes. Each callback operation visits 300 realistic synthetic pods with managedFields; List uses a fake Kubernetes client/informer. The local sink counts serialized bytes without retaining bodies. These measurements exclude a real API server, gRPC, host ingestion, Wails, and rendering. The callback rows compare different workloads on the new handler, not a measured before/after release.

| Workload | Median ms/op | Encoded body bytes/op | Delivered events/op |
|---|---:|---:|---:|
| 300 changed updates | 7.442 | 1,453,200 | 300 |
| 300 unchanged replays | 0.054 | 0 | 0 |
| 300 empty-version updates | 7.454 | 1,445,400 | 300 |

Unchanged replay handling measured zero allocations. Changed updates allocated approximately 6.63 MB per 300-pod operation. Empty resource versions still deliver events, as required.

| Full List path | Pods | Median ms/op | Encoded body bytes/op |
|---|---:|---:|---:|
| Synced informer cache | 300 | 8.132 | 1,452,900 |
| Unsynced fake client | 300 | 11.505 | 1,452,900 |
| Synced informer cache | 3,000 | 75.024 | 14,529,000 |
| Unsynced fake client | 3,000 | 119.392 | 14,529,000 |

This confirms that the current List path still serializes every full object, even with a warm informer cache. It provides a reproducible baseline for projections, paging, demand-driven acquisition, and avoiding repeated List conversions; it does not measure cluster connection latency.

## Spread versus slice: target-engine follow-up

The release branch uses `original.slice()` at the three copy-on-first-change sites.
Both spread and slice allocate a new array of references; neither deep-clones
resource objects. The reducer changes only entries in its new array and never
writes nested resource fields. No-op batches still return the original cache.
A frozen-cache regression covers single ADD/UPDATE/DELETE and mixed delete/re-add
batches, with frozen rows, metadata, status, and event payloads.

Run `node bench/app/resource-copy.mjs /tmp/resource-copy.json` after
`node node_modules/playwright/cli.js install webkit`. This compares spread,
slice, and a preallocated manual loop using dense plain arrays and generated
variants of the production reducer. Warmup, calibrated aggregate timings, an
escaping output ring, and 15 rotating-order samples reduce timer/JIT/order bias.
The raw receipt is preserved in the [PR evidence comment](https://github.com/omniviewdev/omniview/pull/210#issuecomment-6505282754), not in the source tree.

WebKit 27.2, macOS arm64, Apple M5 Max. Isolated copy medians in microseconds:

| References | Spread | Slice |
|---:|---:|---:|
| 300 | 0.140 | 0.128 |
| 3,000 | 2.176 | 1.353 |
| 10,000 | 6.533 | 3.467 |

Slice helps the isolated larger copies, but whole-reducer results are much closer.
In the preserved run, 10,000-row full-update batches tied at 0.825 ms; an earlier
run showed a small difference. Copy syntax is not the main source of the
quadratic-work reduction and does not explain the reported idle CPU by itself.
Manual loops were not a consistently better choice.

The small `{ ...base, result }` metadata copy remains: it preserves additional
response fields without mutating the old response. Replacing it with assignment
into `base` would violate cache immutability. No universal claim that spread is
slow, or that slice is faster for every engine/array shape, follows from this
measurement. Sparse arrays, array subclasses, and custom iterator/species hooks
are outside this dense JSON resource-array benchmark.

## Wave 2: bounded rendering and visible metric demand

The [performance tracker](https://github.com/omniviewdev/omniview/issues/212)
contains ten scoped opportunities and supplements five existing, gated SDK-v2
architecture issues instead of creating competing redesign tickets. Each item
records discovery, source entry points, ownership, verification, and portability.
The four local changes below preserve the current connection-readiness guards
and dependency cohort. These receipts do not establish native CPU acceptance.

### Event viewport

The actual original component from plugin main `92c3185` and the candidate used
identical synthetic Storybook fixtures. Chromium measured a 438px scroll viewport:

| Source events | Original mounted rows | Candidate mounted rows | Original story DOM elements | Candidate story DOM elements |
|---:|---:|---:|---:|---:|
| 300 | 300 | 14 | 3,329 | 198 |
| 3,000 | 3,000 | 14 | 33,029 | 198 |
| 30,000 | 30,000 | 14 | 330,029 | 198 |

Keyboard End reached event 30,000. Search found the final source event as one
result and reset scroll; the Warning filter retained all 10,000 matches.
Loading, empty recovery, reordering, and variable-height narrow rows were exercised.
Browser smoke caught a measurement invalidation bug: unchanged-height mounted
rows retained estimated sizes after a width change cleared their cache.
Remeasuring the bounded mounted range fixed the 9.25px gaps; settled rounding
differences were at most 0.25px. Permanent `Dashboard/EventsTable` stories retain
the three fixture sizes and interaction controls.

This bounds DOM and paint work, not event acquisition, deduplication, or sorting.
Those still process the full input. See [plugin #53](https://github.com/omniviewdev/omniview-plugin-kubernetes/issues/53)
for the receipt and limitations.

### Dashboard Pod ingestion ownership

The preserved overview/cards and candidate ran actual host `useResources`,
`useEventBatcher`, QueryClient, and rendered summary/health UI. External Wails
transport and connection readiness were controlled. Three bursts delivered
100 ADD, 100 UPDATE to Failed, then 100 DELETE events:

| Measured work | Original | Candidate |
|---|---:|---:|
| Pod ingestion owners | 2 | 1 |
| Initial Pod List requests | 1 | 1 |
| Callback deliveries for 300 source events | 600 | 300 |
| List cache application attempts | 6 | 3 |
| Individual resource-cache writes | 400 | 200 |

Cache contents and visible Running/Failed/empty states were asserted after each
burst, including failed-health reporting and listener cleanup. Initial List was
already query-deduplicated: this is not a 50% initial network reduction.
[Plugin #54](https://github.com/omniviewdev/omniview-plugin-kubernetes/issues/54)
records the controlled actual-path measurement.

### Shared age scheduler

Both host TextCell and plugin AgeCell mounted 300 and 3,000 real cells against
preserved original source and the candidate. Half the timestamps were five
seconds old and half five days old. Under controlled time and jsdom:

| 3,000-cell workload | Original | Candidate |
|---|---:|---:|
| Active timers | 3,000 | 1 |
| Callbacks over 10 visible seconds | 30,000 | 10 |
| Formatter calls over 10 visible seconds | 30,000 | 15,000 |
| Callbacks over 60 hidden seconds | 180,000 | 0 |
| Formatter calls over 60 hidden seconds | 180,000 | 0 |

Final unsubscribe leaves no timers or visibility listeners. Bulk teardown
schedules no replacement timers. Sixteen focused tests passed in each package
under `America/New_York`, including epoch zero, invalid/future values, timestamp
changes, formatter transitions, full-day/DST boundaries, and lifecycle.
In an actual Chromium renderer, 300 AgeCells stayed at `50s` during 31 seconds
of simulated hidden visibility and immediately caught up to `1m22s` on resume.
Elapsed jsdom timings are not promoted as native speedups.

Reproduce candidate counters from the appropriate checkout:

```bash
# Host root
AGE_CLOCK_BENCH=1 ./node_modules/.bin/vitest run \
  ui/components/tables/Resources/cells/TextCell.benchmark.test.tsx \
  --silent=false --reporter=verbose

# Plugin ui/
AGE_CLOCK_BENCH=1 ./node_modules/.bin/vitest run \
  src/components/kubernetes/table/shared/cells/AgeCell.benchmark.test.tsx \
  --silent=false --reporter=verbose
```

For before/after reproduction, redirect the cell import to preserved source from
host `316878a` or plugin `92c3185`, retaining the same benchmark entry and installed
dependencies. Only that original-source run should set `AGE_CLOCK_BASELINE=1`;
baseline assertions reject candidate timer behavior mislabeled as original.
[Host #213](https://github.com/omniviewdev/omniview/issues/213) preserves the receipt.
Review identified stale day-old labels after a continuously visible wall-clock
jump. The sole timer now wakes at least once per second while visible, compares
its expected wall-clock deadline and timezone offset, and refreshes all labels
only after a discontinuity. Added controlled forward/backward clock-jump
regressions. Native OS clock/timezone changes remain unexercised.

### Visible metrics and stable dashboard layout

The hook/query-client scenario recorded zero requests during 120 initially
disabled seconds, three during 60 visible seconds, zero during 120 seconds with
both columns hidden, and zero during a hidden connection switch. This measures
the hook's enabled policy; caller integration requires separate proof.

An actual Chromium fixture exercised the provider, SDK binding/parser, query,
metric cell, and 300-row DOM with controlled backend responses. Initially hidden
columns started no request; showing CPU started one. During 31 wall-clock seconds
of simulated document hiding, including a pending retry, no new request started.
Resume added one request. Selection, filter text/focus, DOM identity, and
`scrollTop=240` survived. In-flight transport completion is not an abort guarantee.

Review also caught dashboard layout loss in an initial pause implementation.
Actual original chart/gauge components reduced scroll height from 1,242px to
490px while hidden; a middle offset of 600px clamped to 140px and stayed there
after resume. Stable presentation with independently gated observer sidecars
retained the 1,242px height, 600px offset, and all 16 SVG node identities.
At 980px width the responsive height was 1,016px and also remained unchanged
across hide/resume. The controlled-cache geometry fixture used real runtime hooks
with network offline; it is not acquisition-throughput evidence.
[Plugin #55](https://github.com/omniviewdev/omniview-plugin-kubernetes/issues/55)
tracks both acquisition and layout acceptance.

### Integration and SDK-v2 carry-forward

Host UI tests passed 1,187 cases; plugin tests passed 543, including three
dashboard-layout regressions. Both production frontend builds passed. Plugin
typecheck and lint passed with zero lint errors; repository warnings remain.
Temporary browser/baseline source fixtures were removed after proof.

Port the invariants rather than copying legacy APIs:

- One acquisition/event-ingestion owner per resource scope; presentation consumers
  must not each replay transport events into the same cache.
- Visibility and column demand must apply before initial acquisition and cancel
  observer retry/poll demand without removing presentation or its layout/state.
- Bound mounted rows independently of complete membership, filtering, counts,
  ordering, and identity. Never substitute client truncation for truthful paging.
- Share a due-time scheduler, pause it when hidden, refresh on resume, and keep
  teardown linear. Historical views must respect the SDK-v2 chosen view clock
  rather than accidentally introducing live wall-clock ticks.
- Keep immutable cache ownership and connection/namespace/generation isolation;
  do not restore stale cross-connection placeholder data.

The SDK-v2 workspace and public runtime API were not changed. Initial full-object
List serialization, projected reads, native finite paging, bounded source demand,
and matched FreeLens/native CPU acceptance remain separate tracked work.
