# Performance profiling investigation — 2026-11-02

## Scope and provenance

Updated the clean host main checkout by fast-forward to `5bf39f40561ab7e096b815407f45856c334ac070`. Homebrew updated Omniview and its bundled `omniview-dev` from 0.12.0 to 0.25.0. No unrelated formula upgrades, production profile changes, default kubeconfig merges, or production-cluster mutations were performed.

Created managed workspace `performance-profiling-20261102`, UUID `149820cd-9c2b-48fd-a868-8861a48f7bc4`, in the existing registered collection. Selected the host's committed source cohort:

| Repository | Base commit |
| --- | --- |
| Host | `5bf39f40561ab7e096b815407f45856c334ac070` |
| Kubernetes | `a3f0928b064761ec1232bf5d0ef909674bd5bfb1` |
| SDK | `0597ff45586b45e3a57fe7ac86194ce96884c7ef` |
| UI | `cef053786d7817e70f26e8558bdb984bfac09c91` |

The real pinned pnpm 12.14.0 protocol probe passed. Initial browser-mode workspace launch took 221 seconds; subsequent restarts took roughly 31–56 seconds before later source changes. Those are setup observations, not cluster latency measurements. The browser shell's actual frozen UUID/generation, rendered plugin, profiling URLs and verified process inventory were inspected.

The session's SDK and Kubernetes changes live in this workspace's selected source worktrees. Host skill/documentation changes live in the main host checkout. These are local source changes, not published SDK/plugin releases. A standalone plugin release must first consume a released SDK containing the new helper; do not invent a module version or publish the current dependency pin as if it already contains unpublished exports.

## Load cluster

Reused dedicated kind `omniview-load-lab`: Kubernetes v1.35.0, one control plane and three real workers, all Ready. This cluster intentionally does not exist in the default kubeconfig. Recovered a private kubeconfig into the selected Kubernetes worktree's `hack/kind-lab/.state` and configured the plugin to use only that absolute file.

Reseeded `baseline` with the existing driver. After rollout settled:

| Labeled application resource | Count |
| --- | ---: |
| Pods | 300 |
| Ready Pods | 300 |
| Deleting Pods | 0 |
| Deployments | 300 |
| Services | 300 |
| ConfigMaps | 300 |
| Synthetic Secrets | 300 |
| Seed Events | 900 |

Total Pods were 315 including system Pods. The dashboard later showed 4,064 total Events, including controller/lifecycle Events, not just labeled seed Events. Immediate post-seed status had reported 414 labeled Pods and 315 Ready: Deployment Available is not a settled-rollout receipt. Presets do not prune previous inventory; Event TTL and accumulated controller activity matter for matched comparisons.

Direct `kubectl get pods -A -o name` completed in 0.54 seconds; `/readyz` completed in 0.06 seconds. These single CLI observations do not characterize the user's work-cluster network.

## Proven profiling workflow

Enabled host/plugin local pprof and disabled telemetry/continuous profiling through the authenticated workspace settings API, then restarted. Both real Go processes exposed separate numeric-loopback endpoints. Verified host/plugin PID and start identities appeared in the footer process inventory. Endpoints changed after restart and were rediscovered rather than reused.

Captured and decoded:

- Host and plugin 15-second CPU profiles during connection startup.
- Host and plugin heap and goroutine snapshots.
- Host and plugin 12-second Go execution traces, decoded into network-blocking profiles.
- Separate loaded-Pods idle CPU profiles and a Chromium CPU profile.

Initial startup capability captures ran CPU and tracing together; they prove tooling, not overhead-neutral performance. The loaded-Pods capture did not run Go execution tracing. Initial connection profiles showed substantial allocation/decoding work: plugin `metadataBudget.visit` accounted for 27.25% cumulative sampled CPU; host heap attributed 199.27 MiB directly to `adapterDecoder.mapValue`. These are investigation leads, not retained-leak findings or optimization acceptance measurements. Heap captures did not force GC.

On one direct local browser-dev connection, a DOM observer recorded Connecting at 26 ms, catalog-loading UI at 218 ms, first visible 315-Pod count at 1.56 seconds, and loaded/connected without the sync toast at 2.19 seconds. Observer time starts just before the automated click, not at a native input timestamp. The dashboard and populated Pods table were visually inspected.

Raw profiles, traces, DOM observations, inventory and request logs remain private under the workspace's ignored `.local/profiling-evidence/`. Do not commit or upload these files. Profiles can contain sensitive information even though lab objects are synthetic.

Browser/server-mode Chromium evidence does not establish native WKWebView rendering, WebContent/GPU PID ownership, production CPU, or a matched FreeLens benchmark. Native measurement remains [host #215](https://github.com/omniviewdev/omniview/issues/215).

## Timeout reproduction and user-machine evidence

A temporary read-only loopback proxy added 400 ms before each GET to the same real kind API through `kubectl proxy`. The unchanged plugin failed after 10.03 seconds. All 25 logged API responses were HTTP 200; sequential discovery consumed almost the entire acquisition budget before the cluster-identity read. No OpenAPI request reached the proxy in that run.

The actual host binding returned:

```json
{"type":"omniview:resource/timeout","title":"Timed out","status":408,"detail":"resource operation failed","code":"TIMEOUT","recovery":"none"}
```

The separate diagnostic call retained request ID `ac12b555-b64e-4d31-8914-9eb8c89bdc23`. In-flight goroutines reached `readNativeDiscovery → discoverNativeResources → discoverNativeTypes → acquireNativeCatalog → startNativeConnection`. Plugin sampling found only 20 ms CPU in 15.10 seconds. This establishes a deadline/network-wait failure in the controlled setup, not CPU saturation or a Kubernetes HTTP 408 response.

The user subsequently supplied independent affected-machine measurements: 81 served group/versions, 171 CRDs, 84 sequential discovery requests, mean latency 118 ms, and 9.93 seconds for discovery alone before identity and roughly 81 OpenAPI documents. That agent observed EKS token generation around 2 ms followed by repeatable DeadlineExceeded exactly 10 seconds later, with healthy cluster/APIService status and working kubectl/Lens. Those are accepted user-machine findings, not rerun here. Work-cluster names, IP addresses, VPN details and credentials are intentionally excluded from public tracking.

## Verified parallel acquisition and configurable policy

The real managed host/plugin were rebuilt against the edited SDK and Kubernetes
worktrees. Repeating the same 400 ms-per-GET real-cluster experiment produced:

| Source and configured acquisition budget | Result | Observed time |
| --- | --- | ---: |
| Original sequential code, 10 seconds | TIMEOUT / 408 | 10.03 seconds |
| Four-request catalog stages, 10 seconds | CONNECTED | 8.99 seconds |
| Four-request catalog stages, 1 second | TIMEOUT / 408 | 1.005 seconds |
| Four-request catalog stages, 30 seconds | CONNECTED | 8.99 seconds |

The one- and thirty-second changes used authenticated live plugin settings;
neither required a restart between those acquisitions. The failed acquisition
retired its client, and a subsequent explicit start succeeded. Host and plugin
CPU captures from the optimized latency run decoded successfully. The proxy
observed overlapping schema reads with at most four active requests while those
documents loaded. The total request log also includes eager post-connect source
work and later refreshes; its process-wide high-water mark reached 55. Do not
misrepresent the catalog-stage cap as a cap on every plugin HTTP request.

These are single local capability/regression observations, not a matched native
performance benchmark. The user's 81-version EKS cluster was not available here
for an after-fix run. Its source-specific rollout and measurement remain separate
from local proof.

## Matched ordinary-network cold-process comparison

Follow-up measurement ran five trials per variant in alternating paired order
(`before, after, after, before, before, after, after, before, before, after`).
Every trial started a fresh host/plugin process and browser document. Only one
workspace ran at a time. OS, API-server and browser code caches remained warm.
Profiling and continuous telemetry were disabled. Both variants used the same
1440×1000 Chromium browser-development surface, ten-second acquisition budget,
315 total Pods, 302 Deployments and 900 freshly created synthetic benchmark
Events. Event-only seeding did not change Deployments or trigger rollouts.

Old system Events expired during harness preparation. In measured trials total
Events were 918 for the first two pairs and 915 for the remaining three; counts
matched within every before/after pair. No injected latency, churn, retries or
manual recovery occurred in the ten measured trials. All 56 source sessions
reached `following`/`finished`, with zero failed sources.

| Milestone | Before median (range), ms | After median (range), ms |
| --- | ---: | ---: |
| Resource gate opens after connection readiness | 954.8 (938.9–966.1) | 923.1 (888.8–936.8) |
| First visible 315-Pod dashboard count | 1662.1 (1627.9–1703.0) | 1638.8 (1603.5–1655.3) |
| All 56 sources following/finished | 1641.1 (1595.5–1671.9) | 1620.0 (1573.8–1625.2) |

Time starts immediately before the actual **Connect and continue** interaction.
Gate-open and first-data milestones use DOM observations. Complete source state
uses the real host API sampled every 100 ms; it can precede the visible commit.
The [sanitized measurement receipt](../bench/app/connection-cold-start-2026-11-02.json)
retains all ten samples, counts, process generations and method constraints.
Full sampling journals stay private with the other raw evidence.

**Interpretation:** locality makes discovery cheap already. The observed median
improvements are only 31.7 ms at the gate, 23.3 ms at first data and 21.1 ms at
source completion. Five samples and overlapping data/sync ranges do not establish
statistical significance. The material demonstrated benefit remains converting
the controlled high-latency timeout into a successful connection, not a dramatic
localhost speedup. The affected EKS cluster, native WebKit and matched FreeLens
after-fix performance remain unmeasured.

### Host race discovered by cold restarts

Initial harness warmups reproduced **Connection configuration changed** on both
plugin versions after process restart. This was not a kubeconfig mutation:
host `CONNECTED` publication preceded relationship bootstrap, which can retire
persisted native authority and advance its source epoch. Resource pages mounted
against the old epoch and correctly failed their final fence. Fifty-five eager
sources could finish while the failed parent page prevented demand-driven Event
acquisition, explaining the missing 56th source.

[Host PR #359](https://github.com/omniviewdev/omniview/pull/359) moves successful
publication after bootstrap, eager-source admission and start commit, without
weakening epoch checks or replaying stale queries. The same event-order change
was applied to **both** benchmark variants before measured trials, isolating the
plugin/SDK comparison. Host resource-package race tests passed, including a
blocked-bootstrap event-admission regression and cancellation-before-publication.
Failing harness warmups are excluded, preserved privately and not counted as
successful measurements. The policy is event publication, not a new guarantee
for arbitrary concurrent native `CheckConnection` callers.

### Pull requests and release boundary

- [SDK #43](https://github.com/omniviewdev/plugin-sdk/pull/43) is merged at
  `b082bc460bd8a6c183b4a27ebe64d71039128a0d` and published as `v0.14.3`.
  The measured feature revision was `52d4ec73eebb813c3cc5f144a9361171d3b5a0b6`.
- [Kubernetes #87](https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/87)
  is merged at `519172d96103340a0a7f0dab2dc60ae28b1ea28d`, with the published
  SDK `v0.14.3` dependency and no machine-local replacement. The measured feature
  revision was `e688afd`. Integration also preserves newer main features and
  ensures cached/joined refresh callers do not reread acquisition settings.
- [Host #359](https://github.com/omniviewdev/omniview/pull/359) is merged at
  `ad1601012`, preserving the readiness fix alongside newer main changes.

The host integration pins SDK `v0.14.3` and the merged Kubernetes source in its
reviewed candidate cohort and gitlink. The user approved the matching CI SDK
revision promotion. SDK source approval remains separate from cohort selection.
These integration changes do not replace the measured before/after revisions.
Merging source does not update existing desktop installations or publish a new
Kubernetes marketplace release.

## Verification and handoff

- SDK: `GOWORK=off go test ./pkg/resource/v2/... ./settings/... -count=1`
  passed. The focused acquisition-policy tests also passed after retaining native
  settings-read causes without exposing them in public text.
- Kubernetes: the full `pkg/plugin/resource` and `pkg/utils/kubeauth` packages
  passed with `-race -count=1`, using an isolated temporary modfile that selected
  the edited SDK. Package times were 4.08 and 6.30 seconds.
- The first race run timed out because new test instrumentation mutated a shared
  `http.DefaultClient`, leaking callbacks into later fixtures. The fixture now
  clones the client before wrapping its transport; the full rerun passed. This
  was a test-isolation defect, not a passing production cancellation claim.
- Final finite churn completed 15 cycles, 45 direct writes and zero rollouts.
  Separate host/plugin CPU captures during that workload decoded successfully.
- The skill installer advertised the new skill. Eleven shell command blocks
  parsed with `bash -n`; its JSON encoder preserved quotes/backslashes in paths.
  Independent read-only review found no material acquisition-code defect and
  identified workflow corrections that were applied.
- Temporary latency proxies, proxy kubeconfigs, duplicate private kubeconfig and
  temporary module files were removed. The driver-local private kubeconfig and
  raw profiling evidence remain. Profiling stays enabled, continuous telemetry
  profiling stays disabled, and the saved acquisition budget is restored to 10.
  Source reloads replace plugin PIDs/endpoints; rediscover them from the live
  footer, never from an earlier capture or this document.

## Changes and ownership

Kubernetes retains all protocol-specific discovery, OpenAPI, API-group, schema-root and EKS logic. No Kubernetes concepts were added to host core or SDK policy.

- Discovery uses four workers, validates advertised versions before dispatch, preserves result order and partial-error semantics, and shares synchronized aggregate byte accounting. Existing limits remain 256 served versions, 4 MiB per discovery document and 16 MiB aggregate discovery reads.
- OpenAPI uses a four-document rolling prefetch window. Decode and retained-budget admission stay sorted by group/version; the provider-wide staging gate and lease ownership remain. Each document remains limited to 16 MiB and retained documents to 32 MiB. Transient staging increases from one to at most four documents, plus the existing transport's separate response buffers/copies; this is not a whole-process memory cap.
- EKS serializes token refresh/cache access, not authenticated network waits. Cached-token requests snapshot the token and release its mutex before HTTP RoundTrip; they no longer reload AWS configuration per request.
- SDK adds opt-in provider-neutral `ConnectionAcquisitionTimeoutSetting` and `ConnectionAcquisitionTimeout`. The integer setting `connection_acquisition_timeout_seconds` accepts 1–300 seconds, default 10. Kubernetes registers it and reads it once per initial catalog acquisition/refresh. Earlier caller deadlines still win. In-flight acquisitions and retained client/watch lifetimes do not change. Other providers must explicitly adopt this policy; it does not silently change every plugin's lifecycle.

Existing client-go REST handling, 50 QPS/100 burst configuration, cancellation and server retry processing remain in place. Four-request concurrency is not a claim of global scheduling fairness across every connection/plugin. API-server APF remains server-owned. No custom retry loop, rate-limit bypass, aggregated-discovery implementation or blanket deadline increase was introduced.

[FreeLens discovery source](https://github.com/freelensapp/freelens/blob/ac595ba697ac64e2cae87ad4a3a17a4e6dff88d6/packages/core/src/main/cluster/request-api-resources.injectable.ts) limits concurrent group requests to five and awaits the grouped requests together. It emits connection warnings for failed discovery and uses its own backoff helper. The inspected source supports bounded fanout as a comparison, not an assertion about all FreeLens startup/schema work or its behavior on this cluster. Omniview keeps existing retry policy rather than importing FreeLens's backoff behavior.

## Issues and setup friction

| Finding | Tracking / handling |
| --- | --- |
| Sequential acquisition exhausts the fixed startup budget on healthy high-latency APIs | [Kubernetes #84](https://github.com/omniviewdev/omniview-plugin-kubernetes/issues/84) |
| Home treats configured disconnected entries as connected; direct start errors can disappear; grid lacks pending feedback | [Kubernetes #85](https://github.com/omniviewdev/omniview-plugin-kubernetes/issues/85) |
| Existing fixed-name lab loses checkout-local kubeconfig; traceback and post-seed availability mislead setup | [Kubernetes #86](https://github.com/omniviewdev/omniview-plugin-kubernetes/issues/86) |
| Missing selected Kubernetes commit during create produced generic `git_failed` | Fetch registered source refs, then create succeeded; no worktree reset |
| Preflight lacked link evidence | Ran actual pinned protocol probe; never synthesized evidence booleans |
| `workspace restart` rejects `up`'s mode/watch flags | Reused saved launch options; captured in skill |
| Broad Homebrew listing failed on unrelated stale AdoptOpenJDK cask | Targeted Omniview upgrade succeeded; unrelated cask left unchanged |
| `go tool trace` rejects `-o` | Used stdout binary output; captured in skill |
| Re-exporting a watched private kubeconfig caused a configuration-revision change | Explicit Retry resources was needed; reconnect after config settles, and retain generation checks |

The reusable skill is `.agents/skills/omniview-performance-profiling/`; the repository installer advertises it. Existing click/progress defects are tracked, not claimed fixed by backend parallelism.

## Backend allocation follow-up

### Source and workload

The installed `/opt/homebrew/bin/omniview-dev` created two managed workspaces:
`backend-performance-20261102` (changes) and
`backend-performance-control-20261102` (unchanged control). Both selected host
`35ced6506129ca3e6173a66f495e0416c618429e`, SDK
`b082bc460bd8a6c183b4a27ebe64d71039128a0d`, Kubernetes
`519172d96103340a0a7f0dab2dc60ae28b1ea28d`, and the UI cohort above.
Only the changed workspace contains the local host/SDK patches. No dependency
upgrade, new serialization dependency, module-version invention, or production
profile change was needed. This checkout already requires Go 1.26.0; the actual
compiler was Go 1.26.1 on darwin/arm64, Apple M5 Max.

Reused the documented dedicated kind lab without changing default kubeconfig.
All four Kubernetes v1.35.0 nodes were Ready. The settled inventory contained
315 Ready Pods with zero deleting Pods, including 300 labeled application Pods.
There were 300 each labeled Deployments, Services, ConfigMaps, and synthetic
Secrets. Every measured cold trial reported the same full resource counts,
including 602 ReplicaSets, 302 EndpointSlices, and 1,326 Events. Docker reported
18 CPUs and 8,317,267,968 bytes of VM memory. Larger preset claims would exceed
this lab's validated topology; these measurements use real running workloads,
not fabricated nodes or repeated frontend rows.

### Profile-directed changes

Initial live connection profiles identified:

- Host `RelationshipGraph.selectorSnapshot`: 1.66 GiB of sampled allocations,
  28.08% of the initial process allocation profile.
- SDK `metadataBudget.structFields`: 18.60% cumulative host CPU and 22.98%
  cumulative plugin CPU.
- Host source membership constructed a full protobuf record solely to count its
  bytes, even though SDK already exposes exact `RecordWireSize`.

The changes address those costs without changing wire formats:

1. Host filters cached selectors by plugin, target type, binding, and declaration
   scope before copying them into a snapshot. Label matching and declaration
   retirement publication fences remain unchanged. The cache is still scanned;
   this is not a new selector index.
2. SDK traverses exact `Value` trees with typed code instead of rediscovering
   reflection fields and JSON tags for every node. It still checks inactive
   payloads and preserves traversal order and all existing budgets. Generic
   metadata remains reflective. Passing recursive values by value also avoids
   escaping map-iteration temporaries. A refinement profile had attributed
   260 MiB to those temporaries; the final comparison includes their removal.
3. Host uses `RecordWireSize` for source membership accounting instead of
   `ToProtoRecord` followed by `proto.Size`. Record validation and source limits
   remain in force; no protobuf tree is built solely for sizing.

Kubernetes code and public SDK APIs are unchanged. Both host and plugin must
consume the optimized SDK build to receive the shared traversal improvement.
These local worktrees are not published SDK/plugin releases.

### Matched cold-process results

Ran five trials per variant in alternating paired order:
`before, after, after, before, before, after, after, before, before, after`.
Each trial used a fresh host/plugin process and Chromium context. Only one
workspace ran at a time. Builds completed before timing; OS/API caches remained
warm. The browser drove real backend bindings, not a transport mock.

Separate loopback pprof endpoints were discovered through the live host/plugin
status bindings for each process generation. Both CPU captures lasted 20 seconds,
starting immediately before connection. Heap profiles forced GC outside that
window. Allocation figures subtract pre-connection `alloc_space` from the
post-window profile; they are sampled allocated bytes, not retained heap.
Telemetry, continuous profiling, execution tracing, and load churn were disabled.
All ten trials reached all 56 sources following/finished with zero failed sources.

| Backend measure | Before median (range) | After median (range) | Median change |
| --- | ---: | ---: | ---: |
| Host allocated bytes, GiB | 5.71 (5.59–5.75) | 3.57 (3.53–3.64) | −37.4% |
| Plugin allocated bytes, GiB | 1.69 (1.64–1.70) | 1.38 (1.35–1.38) | −18.4% |
| Host sampled CPU, seconds | 9.00 (8.89–9.15) | 6.92 (6.91–7.03) | −23.1% |
| Plugin sampled CPU, seconds | 4.66 (4.61–4.87) | 3.79 (3.71–3.83) | −18.7% |
| Plugin end-window RSS, MiB | 422.0 (400.0–426.3) | 296.9 (283.4–298.9) | −29.7% |
| Host end-window RSS, MiB | 564.6 (561.1–572.8) | 548.4 (542.9–549.6) | −2.9% |
| All-source readiness, milliseconds | 2901.4 (2827.2–2965.8) | 2788.0 (2778.8–2866.4) | −3.9% |
| Host post-GC retained heap, MiB | 231.3 (224.1–246.2) | 229.1 (224.3–239.7) | −1.0% |
| Plugin post-GC retained heap, MiB | 85.1 (84.4–93.2) | 80.9 (76.5–105.4) | −4.9% |

Process CPU deltas independently corroborated the sampled CPU reduction:
host median 9.95 to 7.64 seconds; plugin 5.10 to 4.12 seconds.
RSS is resident process memory at the end of the fixed window, before forced GC,
not peak memory or a retained-object measure.

The material result is reduced temporary allocation, CPU work, and plugin RSS.
No substantial retained-heap improvement is established; sampled ranges overlap.
Readiness improved by only 113 ms, with overlapping ranges and five samples.
Do not claim a significant startup latency or native/UI responsiveness improvement
from this result. These changes reduce backend work and GC pressure;
production-cluster and native interaction latency remain unmeasured.

The [sanitized backend receipt](../bench/app/backend-resource-2026-11-02.json)
records every sample, full source counts, generation/PID identities, source
hashes, and methodology. Raw profiles, scripts, and cluster corpus remain private
under the changed workspace's ignored `.local/`; profiles and measurement scripts
are in `.local/profiling-evidence/`.

### Sustained watch-path check

After an Event-ring warmup, the final before/after pair each ran 30 churn cycles
over 30 seconds: 90 direct ConfigMap/Secret/Event writes and zero rollouts.
Each fresh process completed initial sync and warmed for 15 seconds first.
Separate host/plugin CPU profiles covered 35 seconds. All 56 sources remained
following with zero failures, and both trials retained the same inventory,
including 1,326 Events.

| Watch-window measure | Before | After |
| --- | ---: | ---: |
| Host sampled allocation, MiB | 1222.4 | 1151.5 |
| Plugin sampled allocation, MiB | 284.3 | 277.7 |
| Host sampled CPU, seconds | 1.92 | 1.93 |
| Plugin sampled CPU, seconds | 0.65 | 0.67 |

This single final pair is a watch-path smoke and hotspot discovery, not evidence
of a steady-watch CPU improvement. Four earlier watch trials with the intermediate
SDK implementation also showed little change; they remain private exploration.
Periodic MCP catalog reconstruction dominates this workload, not the 90 writes.

### Verification and remaining opportunities

Passed SDK resource-v2 package tests and race tests, including transport coverage.
Passed host resource, graph, indexer, leasewire, query, and registry race tests.
New coverage preserves inactive-value admission and budget boundaries, plus
cross-authority selector matching, unrelated-target exclusion, late arrivals,
and retired snapshot publication fencing. Both real managed backend variants
were built and exercised through the ten cold trials.

Both managed workspaces were stopped through the CLI after measurement.
Finite churn drivers exited. The lab remains intact with 315 Ready Pods and no
deleting Pods. Temporary benchmark source was removed; its exact harness and
the capture scripts were retained only as private measurement evidence.

Initial exploratory microbenchmarks overlapped development builds and are not
acceptance evidence. A single-process reconnect harness encountered retired
authority errors and an unavailable plugin endpoint; those warmups are excluded.
A later `workspace restart` on a stopped workspace returned
`devsession: process no longer exists`. Explicit managed `down`/`up` succeeded
and was used for every accepted trial. No authority checks were weakened.

Further profile-backed candidates, not claimed improvements:
- Periodic MCP catalog reconstruction is the largest remaining steady-workload
  lead. In the final 35-second watch window, relay `resync` accounted for
  97.29% of host sampled allocation; `BuildResourceCatalogWithReaders` accounted
  for 95.67%. `checkObservedCatalog` repeatedly marshals the whole catalog during
  per-type target resolution. Investigate batched resolution or immutable
  observation-aware reuse while preserving digest, generation, and authority
  fences. Do not disable MCP or drop those checks to improve a benchmark.

- Remove native map/list construction used only before graph JSON encoding.
  Preserve exact integers, timestamps, negative zero, escaping, and admission.
- Reduce repeated JSON/schema admission and event serialization performed only
  for queue-byte accounting. Cache only at an explicit immutable ownership
  boundary; do not trust mutable caller-owned documents.
- Partition selector lookup rather than scanning the remaining cache, if larger
  connection/selector counts justify another index.
- Try separate host and plugin PGO builds with representative startup and watch
  profiles. [Go's PGO guidance](https://go.dev/doc/pgo) warns against
  microbenchmark-only profiles and using one binary's profile for another.

No codec replacement or GC-limit tuning was introduced. Removing unnecessary
serialization and copies avoids changing the SDK's lossless scalar and strict
admission contracts merely to obtain a faster JSON benchmark.

## Backend wave 1 — 2026-11-03 UTC

This follow-up addresses catalog amplification and policy-update latency before
plugin-specific or UI work. It batches discovery against an owned catalog
observation, retains the final generation/epoch/digest fence, projects policy over
cached inventory, and coalesces discovery triggers. Disabled MCP still refreshes
the inventory used by settings.

### Cohort and workload

All workspaces were created with the installed `omniview-dev` CLI. The control
used host `3bd4dfc8dcfbe2fa9dfbdedf96c291bcd961baf0` and SDK
`9f007a79cf63a64eac9df7cb88bbbaf3120b9f08`. The candidate applied the host changes
to that same host base and used SDK
`1712cd3b66e14b1807cf17fbb59f48512875c822`. Both used Kubernetes plugin
`519172d96103340a0a7f0dab2dc60ae28b1ea28d`, Go 1.26.1, macOS arm64, stock pinned
Wails, and stock grpc-go. No GC tuning or Go upgrade was included.

Five alternating fresh-process pairs used the same four-node kind cluster:
315 Ready Pods, including 300 application Deployments, with 300 Services,
ConfigMaps, and Secrets each. Every process delivered a complete 315-row Pod
snapshot and warmed for 15 seconds. A 65-second idle capture preceded a
40-second active capture with eight policy toggles and eight complete two-page
Pod acquisitions. All 55 automatically followed backend sources remained healthy.
The earlier full application consumer also opened an additional source; the
minimal backend consumer intentionally excludes that UI activity.

The primary harness used the real Wails HTTP runtime endpoint and generated
method IDs for policy and finite calls. A minimal browser page consumed real
source-view events without mounting React. No builds, tests, or microprobes
overlapped these captures. Both roles were profiled concurrently within a phase.

### Matched results

Values are medians across five processes per cohort, except RPC p50/p95, which
use 40 calls per cohort. CPU is sampled process CPU time. Allocation is the exact
`runtime.MemStats.TotalAlloc` delta, including observer overhead. Heap is exact
post-GC `HeapAlloc`; RSS is the paired process sum at the end of the CPU capture,
before the post-capture forced GC.

| Measure | Before | After |
| --- | ---: | ---: |
| Host idle CPU, seconds / 65 seconds | 3.89 | 0.49 |
| Host idle allocation, MiB | 2298.9 | 133.4 |
| Plugin idle CPU, seconds / 65 seconds | 1.35 | 0.58 |
| Plugin idle allocation, MiB | 570.7 | 281.6 |
| Host active CPU, seconds / 40 seconds | 18.48 | 2.66 |
| Host active allocation, MiB | 11355.1 | 1215.9 |
| Plugin active CPU, seconds / 40 seconds | 6.64 | 2.48 |
| Plugin active allocation, MiB | 2675.6 | 1000.0 |
| Connect plus complete Pod snapshot, ms | 2923 | 948 |
| Policy RPC p50, ms | 1895 | 9.1 |
| Policy RPC p95, ms | 1981 | 10.9 |
| Finite acquisition p50, ms | 557 | 532 |
| Finite acquisition p95, ms | 569 | 637 |
| Combined idle post-GC heap, MiB | 269.8 | 270.1 |
| Combined idle RSS, MiB | 769.6 | 757.2 |
| Combined active RSS, MiB | 870.2 | 915.4 |

The primary wins are CPU, allocation rate, connection/snapshot latency, and policy
latency. This is not a general memory-footprint win: retained heap stayed
approximately flat, plugin RSS increased while host idle RSS decreased, and
combined active RSS increased. Finite-read p95 also worsened in this sample;
three early calls in the first candidate process account for its upper tail.
Do not claim all resource operations or the native UI became faster.

Every process returned the same 483 normalized tool rows, including readiness
and policy fields. Their SHA-256 digests matched across all ten processes.
All finite acquisitions returned 315 rows; source consumers reported no errors
or resets.

### SDK decisions and rejected optimization

SDK changes retain validation-only JSON walking, root-only DTO admission,
destination-map duplicate detection, and immutable field plans for fixed SDK
types. Arbitrary caller-defined types remain uncached.

Direct native JSON construction was rejected after broader profiling. It
increased allocation for a 4096-element array from about 1.28 MB/op to 2.71 MB/op
and for a 1024-key object from 736 kB/op to 892 kB/op. The existing sized
`ValueFromNative` conversion path was restored. Five paired probes cover the
representative Pod, wide containers, depth boundary, and near-16-MiB document.
`BenchmarkJSONToValueWideContainers` keeps the wide cases reproducible.

### Runtime verification and limits

A separate final candidate smoke performed 60 churn cycles with 192 direct write
attempts and 12 actual Deployment rollouts. The Pod consumer received 108 upserts
and 12 removals, without errors or resets. All 55 sources remained following.
The final cluster check found 315 Ready Pods and no deleting Pods. Write attempts
are not treated as changed objects; repeated ConfigMap/Secret values can be no-ops.

Earlier browser-driven finite comparisons intermittently hit the browser driver's
30-second evaluation timeout. Captured Go goroutine dumps showed no active
enumeration, resolution, policy call, or lock wait. Those exploratory generations
are excluded, not silently retried into the accepted result set. The final
backend HTTP workload completed every request. The client/driver timeout remains
unattributed and belongs in subsequent client-path investigation.

The server-mode native IPC retention fix was submitted separately as
[wailsapp/wails#6545](https://github.com/wailsapp/wails/pull/6545). It was reproduced
on current upstream before the fix, then verified through server/native package
tests and a real `app.Run`/WebSocket smoke. No Wails fork, host build-guard change,
or server-retention gain is included in the host measurements above.

The sanitized wave-1 receipt is
[`bench/app/backend-wave1-2026-11-03.json`](../bench/app/backend-wave1-2026-11-03.json).
Raw profiles, probe sources, and the private corpus remain under the ignored
workspace `.local/wave1-evidence/`. Sampled stack percentages overlap and must
not be added. Results describe this cohort and machine, not every cluster.

After the matched measurements, current host main
`ad04757912e2d2e7d406c6045d321ee0ef41bd1e` was merged without reverting its
concurrent changes. The six optimized implementation files did not overlap
those changes. The integrated tree passed its canonical backend build, affected
package tests and race tests, then a fresh real-runtime smoke: complete Pod
snapshot, all 55 sources healthy, eight policy toggles, eight finite acquisitions,
and the same 483-row inventory digest. That smoke is not another matched pair.

The dependency deliberately pins the profiled SDK commit above. SDK main
concurrently adopted the unrelated C04 source-session wire and grpc-go fork;
silently selecting that newer wire would require a separate host/plugin cutover
and would invalidate this performance cohort.

The integration source cohort and Kubernetes submodule also pin the optimized
SDK consumer. This keeps source-based application checks on the same SDK as
the canonical host and plugin modules, rather than the earlier schema-budget
cohort. These dependency updates are not additional matched performance runs.
