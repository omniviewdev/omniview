# Metrics internals and reference

Start with [Add metrics to a plugin view](finite-resource-metrics.md). This page is for host maintainers and custom transport clients.

Finite metrics evaluate an explicit set of resource references and metric IDs. The host owns admission, shared collection, refresh scheduling, and bounded result reuse. Consumers do not start provider polling loops.

## Sources and semantic definitions

Resource owners publish definitions and approved public scope through `MetricOwnerCatalogProvider.GetMetricOwnerCatalog`. Source providers execute the supplied mappings; they do not own another plugin's resource presets.

Queries and editors read only the selected resource owner's catalog. Profile definition reads never contact providers.

`MetricSourceRef.Native` selects the resource owner's built-in source. Native references carry that owner's plugin and connection IDs, with empty datasource kind and UID. External references use a typed provider connection and datasource instead. The host verifies native ownership; it never identifies native sources by a backend name.

For example, the Kubernetes plugin—not the host or Grafana provider—declares these current-value metrics:

| Metric ID | Meaning | Physical unit | Shape |
| --- | --- | --- | --- |
| `kubernetes.pod.cpu.usage` | Sum of container CPU usage over the source measurement window | cores | `current` |
| `kubernetes.pod.memory.working_set` | Sum of container memory working sets | bytes | `current` |
| `kubernetes.node.cpu.usage` | Node CPU usage over the source measurement window | cores | `current` |
| `kubernetes.node.memory.working_set` | Node memory working set | bytes | `current` |

Read descriptors from the returned catalog instead of inferring units from labels or legacy metric IDs. Unsupported providers, metrics, and shapes fail explicitly; finite calls never fall back to legacy query or stream execution.

Kubernetes metrics-server provides current values, not retained history. Its plugin also supplies PromQL recipes for compatible exporters. The Grafana provider executes those recipes against configured Grafana gateways or direct Prometheus-compatible endpoints. Other resource plugins supply their own definitions and scope declarations. Supported shapes always come from the selected source catalog.

## Resource authority and limits

Each `ResourceMetricTarget` contains `Token`, `Reference`, and `Route` (`token`, `reference`, and `route` in JSON). Obtain references and routes from resource-v2 observations. Do not construct authority from a resource name, copied object body, or display label. Tokens correlate results; they do not grant access.

Frontend bindings share one host-issued `WindowRealm` principal per authenticated window. Do not create a separate principal for a service: retained resource observations belong to that window. Missing or closed windows receive no principal. Window closure retires its source interests and metric observations; agent and native entrypoints keep separately issued scopes.

Pass `context.Context` through Go session/query entrypoints, including exec, logs, forwarding, and legacy metrics. Wails injects that argument; JavaScript call arguments do not change. Admit resource references and resolve connections before detaching long-lived provider work from request cancellation.

`MetricsObservationSpec` selects `OwnerPluginID`, `OwnerConnectionID`, `ResourceKey`, optional `BindingID`/`Source`, `Targets`, `MetricIDs`, `Shape`, `DurationMs`, `StartTime`, `EndTime`, `StepMs`, and `IntervalMs`. JSON names are snake_case. Every target's provider, route connection, and resource type must match the original owner. Target tokens and canonical resource identities must be distinct. Incarnations distinguish recreated resources even when names match.

Source precedence is explicit request `Source`, saved owner-connection/resource view selection, per-metric/owner binding source, profile default, then the owner's native source. Saved view modes are `inherit`, `native`, and `external`. Native mode overrides per-metric source choices; inherit restores lower-layer selection. `BindingID` identifies an actual owner binding only. External mappings retain approved owner scope. Invalid explicit sources fail without fallback. Provider-private contexts carry selected source credentials, never owner credentials.

Batch reuse also checks current authority assignments on every hit. A concurrent catalog observation can retire an authority without replacing the plugin process or advancing the connection epoch; cached admission must reject that reference.

The host admits every target before collection and re-admits every delivery, including cache hits. Targets of one admission pass share a single route-catalog acquisition per resource type (`resource.WithAdmissionBatch`); every reference is still individually authorized, address-checked and generation-fenced, and a batch never outlives its pass. Owner and source connections have independent generation fences. Configuration dependencies are scoped to the selected owner binding, view tuple, source connection, and consumed mappings. Unrelated owner/source edits preserve active work and completed cache. Matching edits cancel old work, clear stale snapshots, and re-resolve attached observations without requiring new client tokens. Source deletion shows an explicit error; fixing that selected source can recover the same observation.

Mapping revisions hash effective selected source, public scope, and applicable lane mappings, never the whole configuration document. Native lanes omit unused external mappings. Compatible metric subsets share exact requested pairs. Mixed source lanes validate every catalog before sample collection and preserve per-result source provenance. A merged catalog's descriptor `Source` overrides its default `Source`.

Public resource-field mappings use host-owned observations, never caller-supplied `PublicData` or an upstream resource `Get`. `ReadObservedResource` approves each RFC6901 path against the retained owner's current representation schema and returns only selected scalar leaves. Paths must be explicitly and unconditionally declared; arrays, objects, nulls, dynamic properties, secret-like names, data payloads, `writeOnly`, `x-sensitive`, and password/binary formats are rejected. Referenced schema documents resolve through the existing connection-scoped metadata cache, not a per-resource fetch.

Projection delivery guards reauthorize the original owner and fence source generation, schema/catalog binding, authority, incarnation, and immutable member replacement. Identity-only native mappings use `GuardObservedReference` without granting or requiring `resource.Get`; same-incarnation body updates do not retire identity-only guards. The host-resolved `Context.MappingRevision` incorporates configuration and projection bindings; `Context.ProjectionRevision` separately records the projection-specification digest and is idempotent across repeated projection. Target cache identity includes approved scalar values, preserving compatible subset sharing while fencing changed projections. Only mappings for requested metrics trigger body projection; unrelated catalog mappings do not require resource-body access. Selected sources retain their own credential context and receive no resource body.

Limits apply before dispatch and before publication:

- A request contains 1–256 targets and 1–32 unique metric IDs. Provider batches also respect the catalog's `MaxTargets`.
- `current` forbids duration, range times, and step. `range` accepts either positive `DurationMs` without absolute bounds or fixed `StartTime`/`EndTime` with duration zero. Both require positive step, a domain no longer than 31 days, and a domain/step quotient below 10,000.
- A delivered response contains at most 10,000 range points and at most 4 MiB of JSON. These limits also apply after merging cached and in-flight contributions. Overflow returns `RESOURCE_LIMIT`, not truncated success.
  Pending range assemblies enforce these same caller-projected limits once per
  cached entry or provider answer, after its results and warnings are merged,
  even without a progress callback. Point bounds apply before merge allocation.
  An over-budget reader detaches immediately; only provider work no other reader
  needs is canceled.
- `IntervalMs` is zero for initial/manual reads, or 1,000–3,600,000 milliseconds for host-scheduled refreshes. Collection has a 30-second deadline.
- The coordinator bounds shared work to four I/O slots, 512 interests, and 32,768 requested target/metric pairs. Active or pending observations also have a 512-reservation limit and a 16 MiB displayed-sample budget.
- Completed response reuse expires after 30 seconds and is bounded to 64 entries/8 MiB. Catalog reuse expires after 30 seconds and is bounded to 64 entries, each at most 64 KiB. Neither cache lifetime defines sample freshness.

For a relative range, the host aligns the collection end to an epoch-millisecond step boundary and computes start as end minus duration. The stored observation remains relative; every collection resolves a new immutable domain. Relative Open leaves domain fields absent. Displayed data retains its own domain and resolution while a replacement is pending. Publication replaces data and domain together. Failed or invalidated relative collections clear both data and domain. Absolute ranges remain fixed.

Coverage-aware reuse requires every selected provider descriptor to declare `RangeReuse`. Otherwise bounds remain part of the exact-domain partition. Opted-in ranges can share complete, pure point series only when step and grid phase match; authority, catalog, connection generations, configuration, projections, source, dimensions and identity scope remain fenced. Owner declarations do not authorize reuse: edited or overridden definitions lose inherited declarations, and the executing provider must opt in separately. No provider query language is inspected by the coordinator.

The coordinator clips completed contributions, joins compatible overlapping work and dispatches only uncovered intervals. Subqueries may repeat one boundary point because the wire requires strictly ordered bounds. Existing TTLs and budgets still apply, including assembled response limits. Manual refresh bypasses completed reuse. This uses the existing completed cache, not another sample cache.

Newer complete coverage owns its points and its omissions. An older incomplete
or negative exact-domain cache entry cannot overwrite that coverage. A `missing`
answer to only one fragment does not prove absence across the full request:
the collection finishes incomplete unless the answer covered the whole domain.

Range-to-current reuse is a separate, default-off provider capability, `RangeToCurrent`, requiring both query shapes. It promises identical value, unit, identity, dimensions, source and measurement-window semantics independent of range bounds or step. Owner range-reuse hints do not grant it.

After exact-current cache lookup, an eligible current request may reuse a complete successful range result from the existing bounded cache. The result must carry a numeric terminal point, actual physical `ObservedAt`, and a positive catalog `MaxSampleAge`. Neither the terminal evaluation time nor the physical observation may be future-dated; the physical observation must not follow the terminal evaluation and must still satisfy the current freshness policy. A null terminal point is not replaced with an earlier value. Cache expiry, authority, projection, configuration, catalog and generation fences remain mandatory. Manual refresh bypasses this reuse.
  A later complete gap, omitted terminal point or empty evaluation blocks an
  older numeric promotion; the coordinator collects current data instead.
  An empty future-ending answer settles only through the last point on its own
  grid already reached when it landed. A window that began later establishes
  no current absence; a later lookup cannot advance its claimed coverage.

The delivered current result retains the physical observation time and measurement window, copies the terminal value and removes range points. Providers lacking the explicit capability, including the current built-in Grafana integration, continue collecting current samples normally.

A range collection may publish immutable incomplete frames with `Complete=false` and `Fetching=true`. Their domain is the requested evaluation window, not a claim that every interval has loaded. Missing pairs are pending, not source-proven absence. The hook retains its one displayed snapshot when a partial frame would remove numeric samples still inside the requested window; retained data keeps its original domain and step. Non-regressing progress can expand the displayed coverage. A final incomplete frame ends fetching without claiming completeness. The companion Kubernetes panel change in [plugin PR #222](https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/222) sets the shared chart's `maxGapMs` from the displayed step so unloaded intervals and source gaps are not bridged. Older pinned plugin versions do not provide that chart guarantee; deploy the matching runtime and panel changes together before enabling owner range-reuse declarations.

Once an observation retains a complete snapshot, compatible refreshes do not publish intermediate frames over it. This preserves the original samples, catalog, domain and byte accounting if a later source fails operationally. Full success replaces the snapshot atomically; operational failure retains it and reports the error. Authority, configuration and other invalidating failures still clear it. Initial, invalidated and incomplete observations can publish partial progress without retaining a second snapshot.


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

Prepared result IDs use source, canonical resource identity, metric ID, and dimensions, not caller tokens or result order. The hook retains compatible selected history during refresh, filters out replaced resource incarnations, and clears invalidated data. A metric's own source override is part of compatibility even when the catalog-default source stays unchanged: replacing it clears that metric's retained prepared results before partial-frame retention. Unselected history never prevents a new target or metric from showing partial progress on a different step.
An inherited default-source change does not discard an unchanged explicit
metric lane's history. Replacement acknowledgements filter sources per metric,
including after a pause. If a displayed data frame omitted its catalog, the
last observed catalog supplies that source fence; authority and invalidation
checks still apply.

Each result also exposes readonly `resourceReference` and `resourceRoute` from its admitted target. Use those fields for identity chips. Do not parse `resourceIdentity` or treat returned series dimensions as resource identity.

### Source labels and icons

| Runtime hook | Use |
| --- | --- |
| `useMetricSourceInventory()` | Shared provider icons, connection names, and datasource choices |
| `useMetricSourcePresentation(result.source)` | Friendly attribution for the result's actual source |
| `useMetricBindings(pluginID, connectionID)` | Owner-approved binding scope |
| `useMetricOwnerConnection(pluginID, connectionID)` | Owner connection metadata from the shared connection cache |

These hooks do not collect measurements. Inventory caches exclude credentials, configuration, and connection URLs. Connection and metrics-setting mutations invalidate the shared metadata caches.

## Host and window transport

The host `metric.Controller` exports these finite read and lifecycle methods (`sdk` denotes `github.com/omniviewdev/plugin-sdk/pkg/v1/metric`):

```go
GetResourceMetricsCatalog(context.Context, ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error)
ReadFiniteResourceMetrics(context.Context, MetricsObservationSpec) (*sdk.ResourceMetricsResponse, error)
OpenMetricsObservation(context.Context, OpenMetricsObservationRequest, func(MetricsObservationSnapshot)) (MetricsObservationSnapshot, error)
AttachMetricsObservation(context.Context, string) error
CloseMetricsObservation(context.Context, string) error
RefreshMetricsObservation(context.Context, string) error
RetireMetricsSession(context.Context)
GetMetricViewPreferences(string, string) (MetricViewPreferences, error)
SaveMetricViewPreferences(string, string, MetricViewPreferences) error
```

`ResourceMetricsCatalogRequest` contains `OwnerPluginID`, `OwnerConnectionID`, `ResourceKey`, `BindingID`, and optional `*sdk.MetricSourceRef` `Source`. SDK provider catalogs receive the distinct typed `sdk.ResourceMetricsCatalogRequest{Source, ResourceKey, Context}`; finite queries receive the same resolved mapping `Context`. Headless reads require host-issued invocation identity and use the same admitted coordinator as observations. A caller-provided context alone is not authority.

`ServiceWrapper` exposes the following Wails methods. Generated frontend bindings omit the native `context.Context` parameter:

```go
func (s *ServiceWrapper) OpenMetricsObservation(ctx context.Context, request OpenMetricsObservationRequest) (MetricsObservationSnapshot, error)
func (s *ServiceWrapper) AttachMetricsObservation(ctx context.Context, token string) error
func (s *ServiceWrapper) CloseMetricsObservation(ctx context.Context, token string) error
func (s *ServiceWrapper) RefreshMetricsObservation(ctx context.Context, token string) error
func (s *ServiceWrapper) GetResourceMetricsCatalog(ctx context.Context, request ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error)
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

### Source configuration services

Every provider, definition, binding, default, validation, preview, and discovery method requires an authenticated frontend window. These Wails methods use typed DTOs, not encoded caller resource bodies:

```go
GetProviderConnections(ctx, plugin)
SaveProviderConnection(ctx, plugin, input)
DeleteProviderConnection(ctx, plugin, connection)
GetDataSources(ctx, plugin, connection)
TestProviderConnection(ctx, plugin, connection)
ValidateMetricDefinition(ctx, plugin, connection, datasourceUID, definition)
DiscoverMetricLabels(ctx, plugin, connection, datasourceUID, request)
GetMetricOwnerCatalog(ctx, ownerPlugin, ownerConnection)
GetMetricDefinitions(ctx)
SaveMetricDefinition(ctx, ownerPlugin, ownerConnection, definition)
DeleteMetricDefinition(ctx, id)
PreviewMetricDefinition(ctx, spec, definition)
GetMetricBindings(ctx, ownerPlugin, ownerConnection)
SaveMetricBinding(ctx, binding)
DeleteMetricBinding(ctx, ownerPlugin, ownerConnection, id)
GetMetricSourceDefaults(ctx)
SaveMetricSourceDefaults(ctx, defaults)
GetMetricViewSourceSelection(ctx, ownerPlugin, ownerConnection, resourceKey)
SaveMetricViewSourceSelection(ctx, selection)
```

`GetProviders()` exposes `supports_connections`. Discover external connections only when true; native-only providers remain valid metric sources.

`GetMetricDefinitions` returns saved profile overrides and custom metrics. `GetMetricOwnerCatalog` merges these with the selected owner's defaults and approved scope. Saves check that owner's inherited revision; deleting a saved override restores inheritance. Connection bindings store sparse overrides of these effective defaults.

Owner catalog lookups, source validation, binding saves, and mapping revision checks retain the authenticated caller context and cancellation through resource connection admission.

Public scope keys must appear in the resource owner's declared `ScopeFields`. User mappings and source providers cannot grant new keys. Required inputs follow required scope bindings in applicable mappings. Scope values remain bounded public metadata, separate from credentials and provider-private settings.

Cross-owner editors mount resource hooks under `PluginContextProvider pluginId={ownerPluginID}`. Plugin-scoped hooks prefer their surrounding context; an explicit argument alone does not switch that context.

The profile's managed `appstate.ScopedRoot` stores configuration atomically in `metrics/configuration.json` with private file modes, separately from presentation preferences. Definitions, bindings, profile defaults, and view source selections use loaded revisions; stale saves return `CONFLICT`. Both source save methods return updated DTOs and revisions. `SaveMetricSourceDefaults` with omitted `Source` resets profile inheritance to native. A view source selection stores its owner plugin, owner connection, resource key, mode, optional external source, and revision; `inherit` restores binding/profile precedence. Provider credentials remain in provider-owned private storage and never enter these public configuration DTOs or query context.


## Values, timestamps, and completeness

CPU values remain cores throughout transport and preparation; memory values remain bytes. Convert to millicores or binary display units only for presentation. Capacity displays require real request/limit data supplied by the owning resource view, not invented denominators.

Go timestamps are `time.Time`; JSON timestamps are RFC 3339 strings. Query `Step`, result `Window`, and catalog `MaxSampleAge` are Go durations and JSON nanoseconds. Observation `step_ms`/`interval_ms`, preference time fields, and prepared timestamps/windows use milliseconds. `ObservedAt` and `Window` come from the source; never replace missing source time with receipt time.

Each source declares `MaxSampleAge`; Kubernetes metrics-server uses two minutes. Zero means no age policy, so freshness is unknown. The observation hook reports current values as `fresh`, `delayed`, or `unknown` using source time and that policy only, never cache expiry. Range completeness is independent of live sample age.

A current `ok` result has a finite `Value`. Range results contain strictly increasing points within the requested domain; a null point value is a gap. Missing values are not zero. Non-`ok` statuses carry no numeric data. Statuses are `ok`, `missing`, `unsupported`, `denied`, `invalid_context`, `invalid_mapping`, `ambiguous`, and `failed`.

`Complete` means every requested target/metric pair has a result, not that every result is `ok`. A provider may classify a missing measurement only after its relevant scan completes. Partial or denied scans must not claim absence. Response warnings survive shared and cached assembly with duplicates removed.

`IdentityScope` describes source attribution: `incarnation` means the source verified the resource UID; `name` means attribution by name only. Host incarnation fencing does not turn a name-scoped source sample into UID-verified data.

## Provider callbacks

See the [provider SDK guide](https://github.com/omniviewdev/plugin-sdk/blob/main/docs/finite-resource-metrics.md) for registration and examples.

The host invokes `GetResourceMetricsCatalog` and `QueryResources` through the SDK. The SDK validates every target and holds its connection/catalog leases during collection. Providers execute the requested batch; they do not own polling.

## Durable presentation preferences

Preferences belong to the current profile and the tuple `(owner plugin, resource key)`, not a resource instance, connection, or source credential. `MetricViewPreferences` has schema `Version: 1` and a compare-and-swap `Revision`.

Load the document, edit it, and save the full document with the loaded revision. A successful save increments the durable revision; reload before another edit. A stale save returns `CONFLICT` without changing any field. Reload and explicitly merge the intended change instead of blindly retrying. Storage failures remain errors; callers must not claim an unsaved change is durable. The runtime hook queues local field patches, loads the latest revision, saves through CAS, and reloads after success.

- `MetricIDs` / `metric_ids` is the ordered visible selection, with at most 32 distinct IDs. There is no separate order array.
- `Displays` / `displays` maps up to 128 IDs to `auto`, `value`, `capacity`, `gauge`, `area`, `line`, or `sample-bars`.
- `Details` / `details` maps up to 128 IDs to booleans. Both maps may retain settings for unselected metrics.
- Metric IDs and map keys contain 1–256 UTF-8 bytes, without NUL, CR, or LF. The owner plugin is bounded to 256 bytes; the resource key is bounded to 512 bytes and follows the same character restrictions.
- `Layout` is `auto`, `grid`, or `stack`. `TimeMode` is `relative` or `absolute`. Relative `DurationMs` is positive and at most 31 days. Absolute `StartMs` is positive, `StartMs < EndMs`, and the span is at most 31 days. Absolute values are epoch milliseconds, no later than `253402300799999`; all time fields are nonnegative and any duration remains bounded to 31 days.
- The profile holds at most 512 documents, each at most 32 KiB of encoded JSON.

Revision zero is uninitialized: generic host defaults have no selected metrics, auto layout, and a relative one-hour domain. The resource-owning runtime view may supply defaults for every presentation field only at revision zero. A saved empty selection has a positive revision and remains empty. Preferences describe presentation; they neither grant resource access nor enable unsupported source shapes.
