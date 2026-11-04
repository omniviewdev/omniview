# Resource-set metrics

The host admits every canonical resource reference under its resource owner before selecting a metrics provider. Resource-owner connection, metrics-provider connection, and datasource UID are independent identities. A resource-scoped alias never leases a provider connection using the source cluster ID.

## Routing and configuration

`ServiceWrapper.QueryResources(ctx, encoded)` strictly decodes the SDK resource-set request through the existing encoded-JSON Wails boundary. Wails supplies the context; JavaScript passes only the encoded request. Normal queries ignore caller `source`, `definitions`, `public_scope`, `mapping_revision`, and `public_data`. The host resolves these from persisted owner/connection bindings and global definitions.

An empty `binding_id` resolves the current saved metrics binding. An unbound connection uses its native provider. The reserved `binding_id: "native"` explicitly selects the resource owner's native provider even when an external binding exists. A saved external binding never silently falls back on denial or failure. Supplement policy retains both explicit provenances instead of choosing an iteration-order winner.

Bindings are metrics-signal-specific and owner/connection scoped. One metrics binding is allowed per resource connection. Sparse overrides inherit current global values; deleting an override resets inheritance. Deleting a persisted global definition resets to the active provider catalog definition. Conflicting provider catalog definitions are rejected.

Binding save and draft preview validate the full selected datasource reference through `ProviderConfiguration.GetDataSources(ctx, source)`, not catalog-list enumeration. A manually entered query-capable UID can therefore work without list privilege; wrong datasource kinds and rejected selections still fail.

The app injects its managed `appstate.ScopedRoot` through `SetMetricStateRoot`; configuration persists atomically in `metrics/configuration.json` with private file modes. This file contains definitions, binding references, and approved public scope only. Provider configuration capabilities own backend credential storage. Public provider DTOs do not contain credential material.

## Draft validation and public fields

`ValidateMetricDefinition(pluginID, connectionID, datasourceUID, encodedDefinition)` validates the definition schema/compiler, not a live query. `PreviewMetricDefinition(ctx, encodedRequest)` executes exactly one draft definition against at most eight admitted resources and an explicit saved external provider connection/datasource. It does not save the draft or change another connection's binding.

`DiscoverMetricLabels(pluginID, connectionID, datasourceUID, encodedRequest)` overwrites the request source with the routed selection and applies bounded exact matcher/range limits.

Canonical resource ID, namespace scope, resource type, and explicitly saved public scope support default mappings without source object reads. Explicit `MetricFieldBinding.ResourcePath` values use RFC6901 pointers. The host reads only authoritative owner observations through `SetMetricResourceReader`, inside shared metric work. The reader must reuse current source-view observations; there is no upstream GET-per-row fallback. Missing observations fail explicitly.

The host ignores caller bodies and extracts only selected scalar leaves into `PublicData.Map[Field]`. Whole objects, lists, nulls, malformed pointers, sensitive field names, and data payload paths are rejected. Projection permits at most sixteen fields, sixteen pointer segments, and 2 KiB per scalar. The whole observed object is neither cached by the metric coordinator nor forwarded to the provider. `MetricResourceReader` returns the body plus a `func(context.Context) error` observation guard. The guard captures source session generation and member revision, reauthorizes using each current delivery context, and stays private to shared work/cache entries.

## Shared work and limits

The host partitions work by admitted principal owner/generation/origin, source owner/connection, provider connection, datasource UID/kind, effective public scope, resolved definitions/units/reducer/revision, shape, exact requested range/step, and host connection/configuration generation. Canonical address, sorted scope dimensions, incarnation, and route identify resources; consumer tokens are remapped only at the edge.

A 12 ms window coalesces compatible finite resource sets. Limits are 256 resources and 32 metric IDs per request, 64 resources per provider chunk, four concurrent host executions, 128 partitions/flights, a 30-second deadline, 50,000 returned samples, and 8 MiB per dispatched response. Cache freshness is at most five seconds; cache budgets are 2 MiB per partition and 32 MiB total. Over-limit work fails explicitly, never by issuing per-row fallback requests.

Table/sidebar callers share compatible in-flight and cached work. One cancelled caller releases its reference; only the last caller cancels shared execution. Profile/configuration changes invalidate work. Each caller re-admits resources after completion, and late connection/configuration generations cannot publish. Observation guards run after execution and before every cache/result delivery; a changed source revision evicts the affected resource cache and returns reset, even when scalar values or references remain unchanged.

The host validates SDK response identities, declared dimensions, value shapes, finite numeric samples, and timestamps. Missing resource/metric pairs become explicit `missing` results with no value, never zero. Provider statuses, warnings, provenance, and mapping revisions remain visible. Structural result collisions fail rather than selecting or summing arbitrary series.

## Verification handoff

Workers add checks but do not execute them. After SDK generation and integration glue converge, run from the managed host checkout:

```sh
GOWORK=off go test ./backend/pkg/plugin/metric -count=1
GOWORK=off go test ./backend/pkg/plugin/metric -run TestResourceSetServedPrometheusRequestCounterSmoke -count=1 -v
```

`TestResourceSetServedPrometheusRequestCounterSmoke` starts an actual HTTP Prometheus-compatible server, configures the shipped Grafana provider through `ServiceWrapper`, saves a source-scoped binding, and queries 24 explicit pods with CPU and memory. It asserts exactly two grouped HTTP expressions, no extra expression for a matching sidebar with a different consumer token, namespace/cluster isolation, source denial before provider dispatch, and value-less provider denial without native fallback. This is transport evidence when the integration owner runs it, not evidence from an unrun test.

Also run SDK metric tests, runtime resource-set scheduler tests/type checks, Kubernetes metric tests, and generated Wails/runtime build checks in the integration owner's prescribed order. Browser proof must exercise global setup, cluster binding, draft validation, table/sidebar sharing, and native source selection. External production credentials are not implied by disposable fixture evidence.
