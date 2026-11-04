# Grafana / Prometheus metrics provider

The trusted host catalog registers `grafana.CatalogEntry(openState)`. The injected opener returns an independently owned, kernel-contained handle to the Grafana plugin store. Metadata discovery and activation perform no network calls. Each activation creates a fresh provider. Shutdown cancels active resource queries and clears held credentials. Source resource admission belongs to the host; `QueryContext.ConnectionID` must instead identify the separately leased provider connection.

## Connections and credentials

Use SDK `ProviderConnectionInput`: `connection.id`, `name`, `kind` (`prometheus` or `grafana`), `url`, and `public_config` containing `username`, `credentialKind`, and optionally `allowInsecureHTTP: "true"`. The top-level `credential` is a write-only token. Omission preserves the stored token; an empty string clears it. Public DTOs expose only `has_credentials`. The provider stores credentials only in the injected private profile store, in an atomic mode-0600 file. This is private backend file storage, not encryption at rest; protect the operating-system account and profile backups.

Direct Prometheus/Mimir/Cloud uses `/api/v1/query` and `/api/v1/query_range`. Cloud access-policy tokens use `credentialKind: cloud-access-policy` and a nonsecret Cloud instance username for HTTP Basic authentication. Ordinary Prometheus tokens use `prometheus-token`; an empty username selects Bearer authentication. A Grafana connection requires `grafana-service-account` and queries `/api/datasources/proxy/uid/{uid}/api/v1/...`. Do not substitute a direct endpoint to bypass Grafana policy. The provider never automatically switches transports. Use read-only credentials created through the respective product's supported token setup.

HTTPS uses normal trusted certificate verification. HTTP requires explicit self-host opt-in and exposes credentials to that network. Redirects are never followed. Endpoint URLs cannot contain credentials, query parameters, or fragments. Errors omit response bodies, credentials, and endpoint URLs. Gateway discovery filters the catalog to Prometheus datasources; permission-denied discovery remains an error, not an empty catalog. Enter a known Prometheus datasource UID manually when catalog permission is unavailable. Direct datasource UID is `direct`.

Health is only endpoint reachability. It does not prove query permission. An actual admitted resource query distinguishes denied, failed, missing, partial and stale results without zero substitution or fallback.

## Mapping contract

Presets `cpu_usage` and `memory_usage`, revision `kubernetes-cadvisor-v1`, apply to canonical `k8s:/pods`. They require cAdvisor `container_cpu_usage_seconds_total` and `container_memory_working_set_bytes`, with `cluster`, `namespace`, and `pod` labels. Alloy alone does not guarantee these series. CPU reports millicores from a five-minute rate multiplied by 1000; memory reports working-set bytes. These IDs and units match native Kubernetes table semantics. Both explicitly sum nonempty, non-`POD` container series while preserving all three identity labels. Cluster scope is required.

The Pod picker also includes memory RSS/cache, network receive/transmit, disk read/write throughput, CPU throttled-period percentage, container restarts, and CPU/memory requests and limits. CPU and working-set memory remain the default charts; additional metrics are opt-in and retain resource-set batching. Network queries exclude loopback and deduplicate identical per-interface container observations before summing. Kube-state-metrics queries deduplicate exporter replicas per container. CPU requests/limits use millicores; memory uses bytes; throughput uses bytes/second.

RSS, cache, network, disk, and throttling require the corresponding kubelet/cAdvisor series. Restarts and requests/limits require kube-state-metrics v2 series. All presets require the configured cluster label. Exporter availability, disabled metric families, absent limits, and custom labels can produce missing data; presets never substitute zero. Cluster-specific mappings can adapt labels and queries. Throttling reports throttled periods divided by total periods, not CPU time; zero total periods produce no value.

Additional definitions use `query_language: promql`, `semantics: gauge|rate`, supported canonical unit, `reducer: none`, and `batch_strategy: identity`. Aggregate dimensions explicitly in PromQL; the provider rejects duplicate identities rather than choosing an arbitrary result. A required typed field binding maps `source: scope` to an approved public scope key, or `source: resource` to `id`/`pod`, `namespace`, or `resource_key`. Bindings declare the output label. Templates must use `label=~"{{field}}"`. Values receive RE2 literal escaping, then PromQL string escaping; the provider supplies anchored alternatives. There are no arbitrary transforms or executable template expressions. Identity labels must have typed bindings. The host must supply a canonical resource name for the preset pod field, not an opaque locator.

Queries allow 1–1000 explicit resources and 1–32 metrics, split into chunks of 100 resources. A 24-pod CPU+memory set therefore issues two expressions. Independent label alternatives can fetch a superset; only exact full-identity joins are admitted. Responses cap at 8 MiB and 4096 series. Range queries require steps of at least one second and at most 11000 samples. HTTP requests time out after 30 seconds and inherit cancellation. Finite values only; missing is never zero. Samples older than five minutes are stale. Provider warnings remain visible. Declared units cannot prove exporter semantics; static validation states this limit, and actual scoped queries provide permission/identity/freshness evidence.

## Verification and transport smoke

No checks were run by the implementation worker. Integration owner should format changed Go files, then run:

```sh
GOWORK=off go test -race ./internal/builtinplugins/grafana -count=1
```

`TestHTTPResourceSetBothTransports` serves actual HTTP fixture series through both endpoint layouts and asserts 24 explicit resources times two metrics produce exactly two HTTP expressions, 48 correctly joined values and the connection's own authorization header. Other tests cover chunk counters (101 resources => four expressions), denied/missing/duplicate/nonfinite results, secret persistence and public DTO isolation, escaping, redirects, and trusted TLS.

For application smoke, serve the same fixture series on an HTTP endpoint, explicitly opt into local HTTP, save through the host provider configuration API, select UID `direct` or gateway UID `manual-uid`, and bind public scope `cluster=test`. Admit 24 fixture pods under the actual source owner, request CPU+memory, and record server expression counters. Reuse the matching sidebar request through the host coordinator: the provider itself does not deduplicate requests. Verify separate provider IDs and datasource UIDs, same pod names across namespaces/clusters, and denied datasource permissions. Production Grafana/Cloud credentials and real exporter compatibility require separate evidence; fixture HTTP tests do not prove them.

## Bounded discovery and transforms

`MetricDiscoveryProvider.DiscoverMetricLabels` supports label names, a named label's values, or metric names through label `__name__`. Discovery accepts only validated metric/label names and at most eight exact nonempty matchers. It sends a server-side limit plus one to detect truncation, caps returned values to 1–100, bounds values to 1024 bytes, and restricts the time range to at most 24 hours (default one hour). The same transport, datasource UID, private credentials, response-size cap and cancellation apply. Narrow matchers when a server reports truncation. A server ignoring its limit still cannot exceed the response-body cap.

Field bindings may declare `transform: identity`, `lowercase`, or `uppercase`; an omitted transform means identity. Transforms run before both identity joining and RE2/PromQL escaping. Other transforms are rejected. Resource field aliases `name` and `key` map to the approved canonical resource ID and key.

Changing endpoint, transport, username, or credential kind requires re-entering an existing token. Grafana service-account credentials use Bearer authentication only. Cloud access-policy credentials require HTTPS and an instance username.

## Approved resource projections

A resource field binding may set `resource_path` to a bounded RFC6901 JSON pointer, for example `/metadata/labels/app~1name`, while keeping `field: workload` as its template symbol. The host resolves that path against the admitted canonical resource and grants only the selected scalar as `PublicData.Map["workload"]`. The provider never traverses the pointer, reads a full resource body, or trusts caller projections. Strings, booleans and finite numeric scalar values become matcher strings before the declared transform and escaping. Missing, container, null, or oversized values produce `invalid_context` cells without querying. Pointer validation allows at most 512 bytes and 16 segments; host admission also owns sensitive-path restrictions and the approved scalar schema picker.

Output identity labels serve only the exact resource join. `ResourceMetricResult.Dimensions` contains only explicitly declared mapping dimensions; unexpected server labels do not become structural result identity.

## Series identity and observation bounds

Series identity is the resource token, metric ID and ordered tuple of declared dimension values. Distinct declared dimensions, such as two containers, produce separate results. Exact tuple duplicates fail explicitly instead of overwriting a sample. Every declared dimension must be present and nonempty; missing dimensions produce an explicit failed result.

Instant observations may exceed neither the requested evaluation time nor current time by more than two seconds. Matrix observations must fall inside the requested inclusive start/end interval and cannot exceed current time by more than two seconds. Invalid observations are excluded with warnings; a series with no valid observations fails without values or fabricated observation/expiry timestamps. Mixed valid and invalid observations remain partial. Published observation and expiry times derive only from accepted source timestamps. Matrix timestamps must increase strictly.

## Manual datasource UIDs with query-only permissions

`GetDataSources` with an empty source UID performs normal list discovery and preserves discovery errors. With a selected UID, it validates that exact datasource instead. Direct connections accept only UID `direct` and kind `prometheus`. Gateway connections look up `/api/datasources/uid/{uid}` and reject known non-Prometheus types or mismatched UIDs.

Only an HTTP 403 from exact metadata lookup permits a bounded `vector(0)` probe through the same selected Grafana gateway UID. A valid finite Prometheus vector proves that query-only access works without list permission. HTTP 401/404, denied gateway queries, incompatible responses, and known unsupported types remain explicit errors. No direct endpoint or different datasource is substituted.
