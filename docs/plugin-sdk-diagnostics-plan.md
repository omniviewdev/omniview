# Plugin SDK diagnostics reporting (design)

Status: planned, not implemented. Prerequisite: application diagnostics (#424).

Plugins report in-plugin measurements to the host through the **existing** diagnostics collector. The host never trusts plugin-supplied identity, and old plugins/hosts degrade to "unavailable", never zero.

## Decisions

| Topic | Decision | Reason |
|---|---|---|
| Transport | Pull: unary `GetDiagnostics` on the existing `PluginLifecycle` service | Reuses the dispensed channel and the `GetProfilingStatus` polling pattern; no new listener, port or capability string |
| Push / OTLP-from-plugin | Rejected | Plugin would control timing and volume; needs endpoint and credentials in plugin env; bypasses the attribute allowlist, limits and capture/compare; plugin-supplied resource identity |
| Identity | Host stamps `plugin` from its own record ID; a mismatched `plugin_id` in the reply voids the snapshot | Never plugin-supplied |
| Collector | Host `sdkmetric.Producer` on the existing reader | 128 metrics / 16 series / 256 KiB limits, captures, compare, `/metrics` and OTLP apply unchanged; no second store |
| Capability | Probe by gRPC `Unimplemented`, cached per backend generation | Matches `GetProfilingStatus` |
| Versioning | SDK minor release; protocol version stays 1; payload carries its own `schema_version` | Additive RPC |

## Wire shape (additive)

```proto
rpc GetDiagnostics(GetDiagnosticsRequest) returns (GetDiagnosticsResponse);
message GetDiagnosticsRequest { uint32 max_schema_version = 1; }
message GetDiagnosticsResponse {
  uint32 schema_version = 1; string plugin_id = 2; int64 process_start_unix_ns = 3;
  bool truncated = 4; repeated DiagMetric metrics = 5; // <= 24
}
message DiagMetric { string name = 1; string unit = 2; DiagKind kind = 3; repeated DiagPoint points = 4; } // <= 16 points
message DiagPoint { repeated DiagAttr attrs = 1; double value = 2; uint64 count = 3; double sum = 4;
                    repeated double bounds = 5; repeated uint64 bucket_counts = 6; } // <= 4 attrs
message DiagAttr { DiagKey key = 1; string value = 2; } // key is a closed enum
```

Attribute keys are a closed enum (`operation`, `outcome`, `phase`, `state`, `reason`, `cache`, `queue`, `direction`, `event`); values match `^[a-z][a-z0-9_]{0,31}$`. Names match `^omniview\.plugin\.[a-z0-9_.]{1,80}$`. No resource names, kinds, queries or credentials.

## Host behavior

- Poll every 2s beside the profiling poll; one call in flight per plugin; 500 ms deadline; collector reads only a cache.
- Reject unknown schema, responses over 64 KiB, mismatched `plugin_id`; drop nonconforming points instead of clamping.
- Plugin restart changes `process_start_unix_ns`, which sets the metric start time so existing reset detection fires.
- Unsupported, errored or stale (> 3 intervals) plugins emit no points and a `omniview.plugin.diagnostics.status` state, so compare reports them unavailable.

## Limits

24 metrics, 16 points, 4 attributes, 64 KiB, plugin-side snapshot under 200 µs; plugin metrics share the host's 128-metric / 256 KiB sample budget.

## Rollout

1. SDK minor release: proto, server, `pkg/diagnostics` helper, docs.
2. Host: poller, producer, allowlist, docs (no-op against older plugins).
3. Kubernetes plugin: bump SDK and register a small bounded set (API-call outcomes, connection state, watch queue, port-forward state).
4. Gate behind a telemetry toggle, then default on.

## Open questions

Raise the 16-point cap or add per-plugin aggregates; whether `plugin` needs a dedicated allowlist slot (it has one now); poll cadence vs remote interval; configurable stale threshold; whether `status` belongs in a gauge or in `Health`.
