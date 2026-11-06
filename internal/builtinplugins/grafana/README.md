# Grafana / Prometheus finite metrics provider

The trusted host catalog registers `grafana.CatalogEntry(openState)`. Each opener returns an independently owned `os.Root` under the active profile's `builtin/grafana` directory. Metadata and activation perform no network calls. The frontend module key is `grafana`.

Activation registers a direct native lifecycle provider for identity, declared capabilities, and backend readiness. The host runs the normal plugin-service activation path, including optional activity negotiation. This builtin does not expose process activity reporting or delegated host connections; it explicitly reports that optional activity backchannel as unsupported. No broker, subprocess, or dummy legacy metric callbacks are created.

Only advertised backend capabilities start controllers. Settings hydration precedes other providers only when `settings` is advertised. Grafana's finite source configuration uses its private configuration boundary and does not register a settings provider.

## Connections and credentials

Use `ProviderConnectionInput` with public connection ID, name, transport kind (`grafana` or `prometheus`), URL, and `public_config`. The top-level `credential` is write-only: omission preserves it; an empty string clears it. Returned connections expose only `has_credentials`. Credentials live in atomic mode-0600 `connections.json` inside the private profile directory. This is private file storage, not encryption at rest. Protect the operating-system account and backups.

Grafana uses `credentialKind: grafana-service-account`, Bearer authentication, and `/api/datasources/proxy/uid/{uid}/api/v1/...`. Direct Prometheus uses `prometheus-token`. Cloud uses `cloud-access-policy`, HTTPS, and a public instance username for Basic authentication. Endpoint or authentication changes require re-entering an existing secret. HTTP requires explicit `allowInsecureHTTP: "true"`. Redirects are disabled. Errors omit endpoint URLs, response bodies, and credentials.

Endpoint policy uses the parsed URL scheme for both saving and activating persisted connections. Mixed-case schemes do not bypass HTTP opt-in or the Cloud HTTPS requirement.

Datasource discovery includes only Prometheus-compatible datasources. Direct UID is `direct`. A manually selected Grafana UID first uses exact metadata lookup. Only metadata HTTP 403 permits a bounded `vector(0)` permission probe through that same UID; no direct endpoint or alternate datasource is substituted. Health proves reachability only.

Each saved connection generation pools its HTTP client. Saving or deleting retires that generation, cancels in-flight requests, and closes idle connections. Shutdown cancels provider work, retires every generation, waits for active calls, and clears held credentials.

## Finite contract

`GetResourceMetricsCatalog` receives `ResourceMetricsCatalogRequest`, including the exact source, canonical owner resource key, and host-resolved definitions context. `QueryResources` receives `ResourceMetricsQuery`. There are no legacy Query or Stream adapters. The host admits external owner targets independently; the source connection identifies private provider configuration, not resource ownership.

Resource source choice is host-durable and separate from presentation preferences. `GetMetricViewSourceSelection(ownerPluginID, ownerConnectionID, resourceKey)` reads the generated SDK selection DTO; `SaveMetricViewSourceSelection(selection)` uses its revision for compare-and-swap and returns the updated DTO. The runtime `useMetricViewSourceSelection` hook and compact resource source picker expose `inherit`, `native`, and exact external plugin/connection/datasource UID/kind choices. Resolution follows view choice, connection/per-metric defaults, global defaults, then native. Only external mode carries a source reference. Failed saves and unavailable explicit sources remain visible; neither triggers native fallback. Routing and catalog requests wait for the saved choice to load; changing charts or selected metrics does not change routing.

Default mappings `kubernetes.pod.cpu.usage` and `kubernetes.pod.memory.working_set` apply to `k8s:/pods`. CPU reports cores from an explicit five-minute cAdvisor counter rate. Memory reports working-set bytes. Both aggregate nonempty, non-`POD` containers by cluster, namespace, and pod. Cluster scope is required. Exporter configuration must supply these labels and series; Alloy alone does not guarantee them. No synthetic denominators, synthetic history, or missing-to-zero substitution are added.

The 24 real Pod presets also cover RSS/cache, network byte/packet/drop/error rates, disk throughput, throttled-period percentage, container restarts, requests/limits, total memory, filesystem usage, process counts, and thread counts. Network rates deduplicate interface observations before summing. Restarts and requests/limits require kube-state-metrics; other families require the corresponding cAdvisor collection. Throttling divides actual throttled-period rates by actual positive total-period rates, never an invented capacity denominator. Absent or disabled families remain missing. CPU requests and limits use cores, not millicores.

Native Kubernetes Node metrics retain real CPU/memory support through a single cluster-wide metrics-server Nodes LIST per execution, plus continuation only when returned. Native Node IDs are `kubernetes.node.cpu.usage` and `kubernetes.node.memory.working_set`. Source timestamps and measurement windows remain intact; UID mismatches do not join. No proven default Grafana Node query existed in the restored source; external Node mappings require explicit definitions matching the deployed exporter labels and series.

Definitions use units `cores`, `bytes`, `seconds`, `count`, `ratio`, `percent`, `bytes_per_second`, or `count_per_second`; shapes are `current` or `range`. They declare `query_language: promql`, `semantics: gauge|rate`, `reducer: none`, and `batch_strategy: identity`. Typed required bindings map approved public scope or admitted resource scalars to labels. ResourcePath bindings consume host-projected `PublicData`; the provider never traverses private objects. Transforms are identity, lowercase, or uppercase. Templates require `label=~"{{field}}"`; values receive literal RE2 and PromQL escaping.

One whole-target expression executes per mapping, within SDK target and metric limits. Thus 24 pods and two metrics issue two upstream queries. Independent matcher alternatives may fetch a superset; exact full-identity joins discard unrelated cluster, namespace, name, and configured UID tuples. UID identity requires an admitted incarnation and a declared UID identity binding. Otherwise attribution is explicitly name-only. Declared dimension labels are preserved. Multiple series for one target/metric are ambiguous, never selected arbitrarily; aggregate explicitly in PromQL.

PromQL timestamps represent query evaluation time, not underlying source sample age. Instant timestamps are validated but do not populate `ObservedAt`; range points preserve actual returned evaluation timestamps. Range samples must be finite, strictly ordered, and within the requested interval. Invalid samples fail the pair without numeric data. Empty series remain missing. `MaxSampleAge` stays zero and `ObservedAt` stays nil for generic PromQL. No receipt timestamp or fixed freshness policy is invented.

Requests inherit cancellation and have a 30-second HTTP timeout. Responses cap at 8 MiB and 4096 series. Discovery accepts bounded exact matchers, at most 100 returned values, and at most 24 hours. Warnings are bounded and credential-redacted.

## Boundary checks

No checks were run by this worker. Integration owner should format changed Go files and run:

```sh
GOWORK=off go test -race ./internal/builtinplugins/grafana -count=1
```

Tests cover 24-target/two-mapping batching, source authentication independent of owner routes, exact cluster joins, actual timestamps, private file permissions, public secret isolation, pooled generation retirement, and UID joins. Fixture HTTP evidence does not prove production Grafana/Cloud permissions or exporter compatibility.
