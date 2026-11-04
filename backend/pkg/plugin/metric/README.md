# Resource-set metrics

The host admits every canonical resource reference under its resource owner before selecting a metrics provider. Resource-owner connection, metrics-provider connection, and datasource UID are independent identities. A resource-scoped alias never leases a provider connection using the source cluster ID.

## Routing and configuration

Plugin startup negotiates backend capabilities before dispensing controllers. Metric-only native compositions do not need a settings provider. When settings is negotiated, its real provider hydrates before metric discovery or any other consumer starts; settings startup failure still fails activation and rolls back the backend. Legacy external probing discovers the actual settings RPC instead of assuming settings exists.

Native providers that negotiate settings use the actual SDK plugin-scoped schema contract: a nonempty `ProviderOpts.PluginID`, category `plugin`, and opaque setting IDs (including dotted IDs) matching persisted keys. A core-style category such as `features` is not exposed by `sdksettings.NewProviderWrapper` and cannot serve as a plugin hydration fixture.

`ServiceWrapper.QueryResources(ctx, encoded)` strictly decodes the SDK resource-set request through the existing encoded-JSON Wails boundary. Wails supplies the context; JavaScript passes only the encoded request. Normal queries ignore caller `source`, `definitions`, `public_scope`, `mapping_revision`, and `public_data`. The host resolves these from persisted owner/connection bindings and global definitions.

An empty `binding_id` resolves the current saved metrics binding. An unbound connection uses its native provider. The reserved `binding_id: "native"` explicitly selects the resource owner's native provider even when an external binding exists. A saved external binding never silently falls back on denial or failure. Supplement policy retains both explicit provenances instead of choosing an iteration-order winner.

Supplement resolves native work independently of external mapping applicability. Native-only IDs and resources or shapes outside an external definition are dispatched only to the native owner; for example, pod-only Grafana presets do not block native Node usage/capacity. Applicable external work is grouped by resource kind and retains its own strict validation, errors, and denied results alongside native provenance. This is policy partitioning, not fallback after an external failure.

A classified native finite-query `UNSUPPORTED` error becomes an explicit native unsupported result for every requested resource/metric pair; applicable external groups still execute. Explicit native unsupported or unavailable results retain their native provenance. Native authorization failures and arbitrary errors remain fatal and are never reclassified as capability gaps. Combined sample and encoded-byte limits are checked after the native lane and each merged external group, before another resource kind executes.

Bindings are metrics-signal-specific and owner/connection scoped. One metrics binding is allowed per resource connection. Sparse overrides inherit current global values; deleting an override resets inheritance. Deleting a persisted global definition resets to the active provider catalog definition. Conflicting provider catalog definitions are rejected.

Binding save and draft preview validate the full selected datasource reference through `ProviderConfiguration.GetDataSources(ctx, source)`, not catalog-list enumeration. A manually entered query-capable UID can therefore work without list privilege; wrong datasource kinds and rejected selections still fail.

The app injects its managed `appstate.ScopedRoot` through `SetMetricStateRoot`; configuration persists atomically in `metrics/configuration.json` with private file modes. This file contains definitions, binding references, and approved public scope only. Provider configuration capabilities own backend credential storage. Public provider DTOs do not contain credential material.

## Draft validation and public fields

`ValidateMetricDefinition(pluginID, connectionID, datasourceUID, encodedDefinition)` validates the definition schema/compiler, not a live query. `PreviewMetricDefinition(ctx, encodedRequest)` executes exactly one draft definition against at most eight admitted resources and an explicit saved external provider connection/datasource. It does not save the draft or change another connection's binding.

`DiscoverMetricLabels(pluginID, connectionID, datasourceUID, encodedRequest)` overwrites the request source with the routed selection and applies bounded exact matcher/range limits.

Canonical resource ID, namespace scope, resource type, and explicitly saved public scope support default mappings without source object reads. Explicit `MetricFieldBinding.ResourcePath` values use RFC6901 pointers. The host reads only authoritative owner observations through `SetMetricResourceReader`, inside shared metric work. The reader must reuse current source-view observations; there is no upstream GET-per-row fallback. Missing observations fail explicitly.

Every resource also requires `SetResourceIdentityGuard`, wired to the resource controller's trusted `GuardObservedReference`. After canonical admission, this host-only guard authorizes `metric.Query` and checks the current identity against retained same-owner authoritative default/model observations. Default mappings do not require `resource.Get` or body reads. Missing observations, missing guards, altered incarnations, and omitted known incarnations fail closed before provider work. Identity guards survive same-incarnation body/revision updates; explicit field projections retain their stricter observation guards.

Shared work retains identity guards for every resource, including default canonical mappings. The host checks these guards before shared publication, cache delivery, and each caller's final delivery using the current delivery context, never the cancelled acquisition context.

For owner observations, the reader prefers the catalog's default/native representation, then the catalog-declared model representation used by normal UI collections. It rejects unrelated projections and chooses deterministically among eligible sessions. A change in the preferred session invalidates its observation guard. Fields omitted by a model representation remain explicitly unavailable; the reader never fills them from caller bodies or hidden upstream GETs.

The host ignores caller bodies and extracts only selected scalar leaves into `PublicData.Map[Field]`. Whole objects, lists, nulls, malformed pointers, sensitive field names, and data payload paths are rejected. Projection permits at most sixteen fields, sixteen pointer segments, and 2 KiB per scalar. The whole observed object is neither cached by the metric coordinator nor forwarded to the provider. `MetricResourceReader` returns the body plus a `func(context.Context) error` observation guard. The guard captures source session generation and member revision, reauthorizes using each current delivery context, and stays private to shared work/cache entries.

## Shared work and limits

The host partitions work by admitted principal owner/generation/origin, source owner/connection, provider connection, datasource UID/kind, effective public scope, resolved definitions/units/reducer/revision, shape, exact requested range/step, and host connection/configuration generation. Canonical address, sorted scope dimensions, incarnation, and route identify resources; consumer tokens are remapped only at the edge.

A 12 ms window coalesces compatible finite resource sets. Limits are 256 resources and 32 metric IDs per request, 64 resources per provider chunk, four concurrent host executions, 128 partitions/flights, a 30-second deadline, 50,000 returned samples, and 8 MiB per dispatched response. Cache reuse lasts at most five seconds and never outlives a result's freshness deadline; cache budgets are 2 MiB per partition and 32 MiB total. Over-limit work fails explicitly, never by issuing per-row fallback requests.

Result `ExpiresAt` describes sample freshness, not cache reuse. The host preserves provider deadlines, including earlier and already-expired deadlines. When a provider omits a deadline, the host uses `ObservedAt + five minutes`, deriving observation time from the validated current sample or latest timeseries point when present. Only an absent observation time falls back to receipt time. This does not renew old samples on each poll. Successful results with expired deadlines become stale; provider stale, missing, and error statuses remain intact. Existing timestamp bounds and five-minute sample-age checks still apply. Healthy samples can therefore remain fresh through a 30-second UI polling cycle while backend cache reuse still expires after five seconds.

Table/sidebar callers share compatible in-flight and cached work. One cancelled caller releases its reference; only the last caller cancels shared execution. Profile/configuration changes invalidate work. Each caller re-admits resources after completion, and late connection/configuration generations cannot publish. Observation guards run after execution and before every cache/result delivery; a changed source revision evicts the affected resource cache and returns reset, even when scalar values or references remain unchanged.

Mixed requests retain fresh cached resource results and schedule only missing or expired resources. Cached and new results merge under the same compatibility partition; cached observation guards and freshness are checked again before delivery. A cache entry that expires while missing resources execute is not silently delivered as fresh.

The host validates SDK response identities, declared dimensions, value shapes, finite numeric samples, and timestamps. Missing resource/metric pairs become explicit `missing` results with no value, never zero. Provider statuses, warnings, provenance, and mapping revisions remain visible. Structural result collisions fail rather than selecting or summing arbitrary series.

Frontend subscription lifetime follows the structural request key, not `useMemo` identity. The hook commits the latest request in a layout effect and subscribes by key, enabled state, and refresh interval. Compiler optimization or a consumer recreating equivalent request objects must not cancel work or leave cells loading indefinitely.

Compatible active frontend observers share one polling schedule. Opening a sidebar does not expire an observation still retained by its table; the five-second detached-cache retention applies only after the resource loses its observers. Provider expiry remains visible as stale until the shared poll refreshes the observation.

## Verification handoff

Workers add checks but do not execute them. After SDK generation and integration glue converge, run from the managed host checkout:

```sh
GOWORK=off go test ./backend/pkg/plugin/metric -count=1
GOWORK=off go test ./backend/pkg/plugin/metric -run TestResourceSetServedPrometheusRequestCounterSmoke -count=1 -v
```

`TestResourceSetServedPrometheusRequestCounterSmoke` starts an actual HTTP Prometheus-compatible server, configures the shipped Grafana provider through `ServiceWrapper`, saves a source-scoped binding, and queries 24 explicit pods with CPU and memory. It asserts exactly two grouped HTTP expressions, no extra expression for a matching sidebar with a different consumer token, namespace/cluster isolation, source denial before provider dispatch, and value-less provider denial without native fallback. This is transport evidence when the integration owner runs it, not evidence from an unrun test.

Also run SDK metric tests, runtime resource-set scheduler tests/type checks, Kubernetes metric tests, and generated Wails/runtime build checks in the integration owner's prescribed order. Browser proof must exercise global setup, cluster binding, draft validation, table/sidebar sharing, and native source selection. External production credentials are not implied by disposable fixture evidence.
