# Metrics internals and reference

Start with [Add metrics to a plugin view](finite-resource-metrics.md). This page is for host maintainers and custom transport clients.

Finite metrics evaluate an explicit set of resource references and metric IDs. The host owns admission, shared collection, refresh scheduling, and bounded result reuse. Consumers do not start provider polling loops.

## Available native source

The implemented source is the selected resource owner's native `metrics-server` source. For Kubernetes Pods (`k8s:/pods`), the catalog exposes:

| Metric ID | Meaning | Physical unit | Shape |
| --- | --- | --- | --- |
| `kubernetes.pod.cpu.usage` | Sum of container CPU usage over the source measurement window | cores | `current` |
| `kubernetes.pod.memory.working_set` | Sum of container memory working sets | bytes | `current` |

Read descriptors from the returned catalog instead of inferring units from labels or legacy metric IDs. Unsupported providers, metrics, and shapes fail explicitly; finite calls never fall back to legacy query or stream execution.

Native collection does not retain history. Repeated current reads do not become a historical series. A chart or time-range preference cannot make this source support `range`. Grafana datasource discovery, datasource selection, resource-to-series mapping, credential handling, and historical Grafana queries are not part of this API's implemented native source. The finite protocol can describe range-capable sources, but that does not mean a Grafana integration exists.

## Resource authority and limits

Each `ResourceMetricTarget` contains `Token`, `Reference`, and `Route` (`token`, `reference`, and `route` in JSON). Obtain references and routes from resource-v2 observations. Do not construct authority from a resource name, copied object body, or display label. Tokens correlate results; they do not grant access.

`MetricsObservationSpec` selects `OwnerPluginID`, `OwnerConnectionID`, `ResourceKey`, `Targets`, `MetricIDs`, `Shape`, `StartTime`, `EndTime`, `StepMs`, and `IntervalMs`. Their JSON names are snake_case. Every target's provider, route connection, and resource type must match the selected owner and resource key. Target tokens and canonical resource identities must be distinct. Incarnations distinguish recreated resources even when names match.

The host admits every target before collection and re-admits every delivery, including cache hits. The SDK holds admitted target and source connection leases while the provider callback executes. Source replacement, connection retirement, loss of authority, and session retirement fence late results. Callers cannot substitute an arbitrary datasource for the owner: the currently supported source has `DatasourceKind: "metrics-server"` and an empty `DatasourceUID`.

Limits apply before dispatch and before publication:

- A request contains 1–256 targets and 1–32 unique metric IDs. Provider batches also respect the catalog's `MaxTargets`.
- `current` forbids range times and step. `range` requires ordered timestamps, a positive step, a domain no longer than 31 days, and a domain/step quotient below 10,000.
- A delivered response contains at most 10,000 range points and at most 4 MiB of JSON. These limits also apply after merging cached and in-flight contributions. Overflow returns `RESOURCE_LIMIT`, not truncated success.
- `IntervalMs` is zero for initial/manual reads, or 1,000–3,600,000 milliseconds for host-scheduled refreshes. Collection has a 30-second deadline.
- The coordinator bounds shared work to four I/O slots, 512 interests, and 32,768 requested target/metric pairs. Active or pending observations also have a 512-reservation limit and a 16 MiB displayed-sample budget.
- Completed response reuse expires after two seconds and is bounded to 64 entries/8 MiB. Catalog reuse expires after 30 seconds and is bounded to 64 entries, each at most 64 KiB. Neither cache lifetime defines sample freshness.

## Preparing snapshots directly

Most plugin views should use `useMetricObservation`. Custom consumers can prepare a delivered snapshot with:

```ts
prepareMetricResults(
  snapshot: MetricsObservationSnapshot | null,
  catalog: ResourceMetricsCatalog | null,
  targets: readonly ResourceMetricTarget[],
): readonly PreparedMetricResult[]
```

Use the snapshot's own catalog and the targets whose tokens belong to that snapshot. A separate catalog request may describe another source generation.

Prepared result IDs use source, canonical resource identity, metric ID, and dimensions, not caller tokens or result order. The hook retains compatible displayed data during refresh, filters out replaced resource incarnations, and clears invalidated data.

## Host and window transport

The host `metric.Controller` exports these finite read and lifecycle methods (`sdk` denotes `github.com/omniviewdev/plugin-sdk/pkg/v1/metric`):

```go
GetResourceMetricsCatalog(context.Context, string, string, string) (*sdk.ResourceMetricsCatalog, error)
ReadFiniteResourceMetrics(context.Context, MetricsObservationSpec) (*sdk.ResourceMetricsResponse, error)
OpenMetricsObservation(context.Context, OpenMetricsObservationRequest, func(MetricsObservationSnapshot)) (MetricsObservationSnapshot, error)
AttachMetricsObservation(context.Context, string) error
CloseMetricsObservation(context.Context, string) error
RefreshMetricsObservation(context.Context, string) error
RetireMetricsSession(context.Context)
GetMetricViewPreferences(string, string) (MetricViewPreferences, error)
SaveMetricViewPreferences(string, string, MetricViewPreferences) error
```

Catalog arguments are context, owner plugin, owner connection, and resource key. Preference arguments are owner plugin and resource key, followed by the full document when saving. Headless reads require host-issued invocation identity and use the same admitted coordinator as observations. A caller-provided context alone is not authority.

`ServiceWrapper` exposes the following Wails methods. Generated frontend bindings omit the native `context.Context` parameter:

```go
func (s *ServiceWrapper) OpenMetricsObservation(ctx context.Context, request OpenMetricsObservationRequest) (MetricsObservationSnapshot, error)
func (s *ServiceWrapper) AttachMetricsObservation(ctx context.Context, token string) error
func (s *ServiceWrapper) CloseMetricsObservation(ctx context.Context, token string) error
func (s *ServiceWrapper) RefreshMetricsObservation(ctx context.Context, token string) error
func (s *ServiceWrapper) GetResourceMetricsCatalog(ctx context.Context, plugin, connection, resourceKey string) (*sdk.ResourceMetricsCatalog, error)
func (s *ServiceWrapper) GetMetricViewPreferences(ctx context.Context, plugin, resourceKey string) (MetricViewPreferences, error)
func (s *ServiceWrapper) SaveMetricViewPreferences(ctx context.Context, plugin, resourceKey string, preferences MetricViewPreferences) error
```

For consumers that manage the transport directly:

1. Install the `metric/observation` listener and route snapshots by a fresh opaque `client_token`.
2. Call `OpenMetricsObservation({ client_token, spec })`. Open reserves session-owned state and resolves the catalog; it does not collect samples.
3. Apply the returned snapshot before calling `AttachMetricsObservation(client_token)`. Attach activates initial collection and any configured cadence. No result event precedes Attach.
4. Accept only newer `(generation, sequence)` publications for that token. Read `data`, `catalog`, `fetching`, `error`, and `invalidated`; range snapshots alone carry `domain_start`/`domain_end`.
5. Call `RefreshMetricsObservation` for a manual read. It bypasses completed cache, joins compatible active work, and does not move other observers' polling deadlines.
6. Call `CloseMetricsObservation` on disposal, including while Open is unresolved. Close is idempotent and covers close-before-registration. Use a new token when reopening.

Events go only to the authenticated owning window, never an application-global metrics payload. Other sessions cannot attach to an observation merely by knowing its token. Pending reservations and close-before-open tombstones expire after 30 seconds. Window disconnect retires its observations. Closing one reader cancels shared provider work only when its final interested reader leaves.

## Values, timestamps, and completeness

CPU values remain cores throughout transport and preparation; memory values remain bytes. Convert to millicores or binary display units only for presentation. Capacity displays require real request/limit data supplied by the owning resource view, not invented denominators.

Go timestamps are `time.Time`; JSON timestamps are RFC 3339 strings. Query `Step`, result `Window`, and catalog `MaxSampleAge` are Go durations and JSON nanoseconds. Observation `step_ms`/`interval_ms`, preference time fields, and prepared timestamps/windows use milliseconds. `ObservedAt` and `Window` come from the source; never replace missing source time with receipt time.

Native catalogs set `MaxSampleAge` to two minutes (`120000000000` JSON nanoseconds). Zero means no source age policy, so freshness is unknown. The observation hook reports current values as `fresh`, `delayed`, or `unknown` using source time and that policy only. It does not use cache expiry or invent a generic age threshold. Range-series completeness is independent of live sample age.

A current `ok` result has a finite `Value`. Range results contain strictly increasing points within the requested domain; a null point value is a gap. Missing values are not zero. Non-`ok` statuses carry no numeric data. Statuses are `ok`, `missing`, `unsupported`, `denied`, `invalid_context`, `invalid_mapping`, `ambiguous`, and `failed`.

`Complete` means every requested target/metric pair has a result; it does not mean every result is `ok`. Native scans classify an unseen Pod as `missing` only after that namespace scan completes. Partial or denied scans must not claim an unseen measurement is absent. Response warnings survive shared and cached assembly with duplicate strings removed.

`IdentityScope` describes source attribution: `incarnation` means the source verified the resource UID; `name` means attribution by name only. Host incarnation fencing does not turn a name-scoped source sample into UID-verified data.

## Provider callbacks

See the [provider SDK guide](https://github.com/omniviewdev/plugin-sdk/blob/feature/metrics-native-cutover-20261105-f0ad9ab1/docs/finite-resource-metrics.md) for registration and examples.

The host invokes `GetResourceMetricsCatalog` and `QueryResources` through the SDK. The SDK validates every target and holds its connection/catalog leases during collection. Providers execute the requested batch; they do not own polling.

## Durable presentation preferences

Preferences belong to the current profile and the tuple `(owner plugin, resource key)`, not a resource instance, connection, or source credential. `MetricViewPreferences` has schema `Version: 1` and a compare-and-swap `Revision`.

Load the document, edit it, and save the full document with the loaded revision. A successful save increments the durable revision; reload before another edit. A stale save returns `CONFLICT` without changing any field. Reload and explicitly merge the intended change instead of blindly retrying. Storage failures remain errors; callers must not claim an unsaved change is durable. The runtime hook queues local field patches, loads the latest revision, saves through CAS, and reloads after success.

- `MetricIDs` / `metric_ids` is the ordered visible selection, with at most 32 distinct IDs. There is no separate order array.
- `Displays` / `displays` maps up to 128 IDs to `auto`, `value`, `capacity`, `gauge`, or `chart`.
- `Details` / `details` maps up to 128 IDs to booleans. Both maps may retain settings for unselected metrics.
- Metric IDs and map keys contain 1–256 UTF-8 bytes, without NUL, CR, or LF. The owner plugin is bounded to 256 bytes; the resource key is bounded to 512 bytes and follows the same character restrictions.
- `Layout` is `auto`, `grid`, or `stack`. `TimeMode` is `relative` or `absolute`. Relative `DurationMs` is positive and at most 31 days. Absolute `StartMs` is positive, `StartMs < EndMs`, and the span is at most 31 days. Absolute values are epoch milliseconds, no later than `253402300799999`; all time fields are nonnegative and any duration remains bounded to 31 days.
- The profile holds at most 512 documents, each at most 32 KiB of encoded JSON.

Revision zero is uninitialized: generic host defaults have no selected metrics, auto layout, and a relative one-hour domain. The resource-owning runtime view may supply defaults for every presentation field only at revision zero. A saved empty selection has a positive revision and remains empty. Preferences describe presentation; they neither grant resource access nor enable unsupported source shapes.
