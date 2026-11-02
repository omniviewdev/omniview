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

- [SDK #43](https://github.com/omniviewdev/plugin-sdk/pull/43): provider-neutral
  timeout helper, commit `52d4ec73eebb813c3cc5f144a9361171d3b5a0b6`.
- [Kubernetes #87](https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/87):
  bounded loading, EKS mutex scope and settings, commit `e688afd`. Its manifest
  pins the real resolvable SDK commit pseudo-version
  `v0.14.3-0.20261102182751-52d4ec73eebb`, with no published machine-local replace.
  Standalone race tests and backend build passed against that remote commit.
- [Host #359](https://github.com/omniviewdev/omniview/pull/359): readiness race,
  kept separate from profiling skill/documentation.

PRs are open, not merged or released. SDK/plugin release coordination still
applies; a resolvable commit pin is not a claim that a stable SDK release shipped.

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
