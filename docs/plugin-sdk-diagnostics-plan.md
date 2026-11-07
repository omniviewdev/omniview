# Plugin SDK diagnostics reporting

Status: implemented in plugin-sdk (`GetDiagnostics`, `pkg/diagnostics`) and the host (`internal/telemetry/plugindiagnostics.go`). Kubernetes plugin instruments are tracked separately in the Kubernetes plugin repository. Prerequisite: application diagnostics (#424/#425). Follow-ups: #432.

Plugins report in-plugin measurements to the host through the **existing** diagnostics collector. The host never trusts plugin-supplied identity, and old plugins/hosts degrade to "unavailable", never zero.

## Review of the first draft against the code

| Draft claim | Finding | Resolution |
|---|---|---|
| "128 metrics / **16** series / 256 KiB" | `maxSeriesPerMetric` is **64** (`internal/diagnostics/series.go`, sized for 32 sampled plugins). `Identity.configIdentity` still prints `series=16`, a stale label that changes config IDs only. 128 metrics and 256 KiB are right (`collection.go` `convert`, `Export`). | Limits table uses 64. The stale `series=16` label is left alone: changing it invalidates every stored config identity (tracked in #432). |
| Plugins share the 128/256 KiB budget | Exceeding 256 KiB **drops the whole sample** (`Export` returns an error), so a chatty plugin could blind all host metrics. Series over 64 are silently truncated by arrival order, which would favor an arbitrary plugin. | Host producer owns a fixed share: 32 names, 96 KiB estimated, 64 series split evenly across reporting plugins (sorted by ID), with `truncated` status. |
| Names `^omniview\.plugin\.[a-z0-9_.]{1,80}$` | The host already owns `omniview.plugin.{active,crashes,quarantines,load_duration,process.*}`. A plugin naming one would create a duplicate name, and `unambiguousMetrics` rejects **both**. | Plugin names live under `omniview.plugin.self.` (host and SDK both enforce it). |
| Allowlist work needed | All nine keys and `plugin` are already in `safeAttributes`. `safeProtocolDimension` does not constrain their values, and `safeAttributes` caps at 8 attributes. Plugin points use at most 5. | No allowlist change; a test now pins that every enum key and the `plugin` label survive. Values are validated at the producer. |
| Poll "beside the profiling poll" | `GetPluginProfilingStatuses` is **UI-driven**, not a periodic host poll, and does not cache `Unimplemented`. The reusable parts are its snapshot-under-lock then call-outside-lock shape and its post-call identity recheck. | Diagnostics runs its own 2 s goroutine like the process sampler. Capability is cached per backend generation. |
| One metric name per plugin | The collector requires one entry per name. Two plugins emitting the same name must merge into one metric with different `plugin` labels. | Producer merges by name; kind/unit disagreement drops the later plugin's data. |
| In-process (builtin) backends | They serve no lifecycle RPC. | Reported as `unsupported`. |

## Decisions

| Topic | Decision | Reason |
|---|---|---|
| Transport | Pull: unary `GetDiagnostics` on `PluginLifecycle` | Reuses the dispensed channel; no new listener, port or capability string |
| Push / OTLP-from-plugin | Rejected | Plugin would control timing and volume; needs endpoint and credentials in plugin env; bypasses allowlist, limits and capture/compare |
| Identity | Host stamps `plugin` from its own record ID; a mismatched `plugin_id` voids the reply | Never plugin-supplied |
| Collector | Host `sdkmetric.Producer` attached to the existing periodic reader | Limits, captures, compare, `/metrics` and OTLP apply unchanged; no second store |
| Capability | gRPC `Unimplemented`, cached per backend generation (the backend value itself) | A replaced backend is a new generation and is probed again |
| Versioning | SDK minor release; protocol version stays 1; payload `schema_version` | Additive RPC |

## Wire shape (additive)

See `proto/v1/lifecycle/lifecycle.proto` in plugin-sdk: `GetDiagnosticsRequest{max_schema_version}`, `GetDiagnosticsResponse{schema_version, plugin_id, process_start_unix_ns, truncated, metrics}`, `DiagMetric`, `DiagPoint`, `DiagAttr{DiagKey key, string value}`. `DiagKey` is a closed enum: `operation, outcome, phase, state, reason, cache, queue, direction, event`. Values match `^[a-z][a-z0-9_]{0,31}$`. No resource names, kinds, queries or credentials.

## Host behavior

- Poll every 2 s from a dedicated goroutine; at most one call in flight per plugin; 500 ms deadline; the producer reads only the cache and performs no I/O.
- Reject unknown schema, replies over 64 KiB, missing start time, mismatched `plugin_id`; drop nonconforming metrics and points instead of clamping.
- `process_start_unix_ns` is the metric start time, so existing reset detection fires on restart.
- `omniview.plugin.diagnostics.status` (gauge, `plugin` + `state`, value 1) reports `ok`, `truncated`, `unsupported`, `error`, `invalid` or `stale`. Anything other than `ok`/`truncated` emits no points. A reply older than three intervals is `stale`.
- A result that returns after its backend was replaced is discarded.

## Limits

| Limit | Value | Where enforced |
|---|---|---|
| Metrics per plugin | 24 | SDK registry, host validation |
| Points per metric per plugin | 16, reduced to `64 / reporting plugins` | SDK; host producer |
| Attributes per point | 4 (+ host `plugin` label = 5 of the collector's 8) | SDK; host |
| Reply size | 64 KiB | host |
| Distinct plugin metric names, all plugins | 32 | host producer |
| Plugin share of the 256 KiB sample | ~96 KiB estimated | host producer |
| Plugin-side snapshot | under 200 µs for a full registry | SDK test |

## Decisions on the open questions

| Question | Decision | Reason |
|---|---|---|
| Raise the 16-point cap or add aggregates? | Keep 16; no aggregates. | The collector's 64-series bound is the real limit and is shared; fair share keeps it deterministic. Plugins can pre-aggregate with a bounded vocabulary. |
| Dedicated allowlist slot for `plugin`? | No; it already has one and plugins cannot supply the key. | The enum excludes `plugin`, so it cannot be spoofed. |
| Poll cadence vs remote interval? | Fixed 2 s, equal to the collection interval. | Remote export reads the same cache; polling faster than collection adds cost without new data. |
| Configurable stale threshold? | No; three intervals. | No consumer needs another value; add later if one does. |
| `status` as gauge or in `Health`? | Gauge. | It must flow through captures, compare and OTLP per plugin; `Health` is one record per service. |
| Telemetry toggle gate (draft rollout step 4)? | No new toggle. | Local collection is already bounded and always on; remote forwarding already has its own toggle. |

## Rollout

1. plugin-sdk minor release: proto, server, `pkg/diagnostics`, docs.
2. Host: poller, producer, docs (no-op against older plugins).
3. Kubernetes plugin: bump SDK and register a small bounded set (API-call outcomes, connection state, watch queue, port-forward state).
