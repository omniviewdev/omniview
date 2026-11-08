# #416 optimization 1: batch reference admission for finite metric reads

Workload `native-pod-table`: real Kubernetes plugin, real kind cluster (316 Pods in 10 namespaces, 4 nodes, metrics-server), Pod table (all namespaces, CPU + Memory columns), browser-driven IDE. Three rounds of *Dashboard → Pod* (sidebar return), each followed by four scroll steps of 800 px. The workload starts after a 45 s idle so the 30 s completed-sample cache is cold. Settle time = DOM poll until every visible row's CPU and Memory cells hold a value.

This is a **local real-provider** measurement on a 316-Pod cluster. It is **not** a 20,000-Pod measurement; none exists yet.

## Finding

A per-read trace of one 57-target refresh (provider call about 50 ms) showed 4.1 s in the host. `AdmitReference` fetched, validated and bound the full route catalog **once per target**, and a read admits every target about six times (`admitFinite` x5 and resource-identity guards). That is hundreds of plugin RPCs per refresh and a plugin-side catalog build per RPC.

## Change

`resource.WithAdmissionBatch(ctx)` scopes one admission pass. The catalog, `ValidateCatalog`, observed-catalog check and authority resolution run once per `(plugin, route, source epoch, generation, type)`. Per reference these still run: operation admission, `Reauthorize`, generation fence, provider/authority/address check. The admitted context returned to callers does not carry the batch, so a delivery re-admission acquires its own catalog. Used in `admitFinite` and `projectFinite` (identity guards and each delivery's guard pass).

## Measurements (`diagnostics capture`, 100 s, same workload)

| Run | Plugin gRPC calls | Plugin CPU s | Provider queries | Response bytes | Namespace LISTs (metrics-server) | Bytes scanned (metrics-server) | Settle, scroll median | Settle, return median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline 1 | 9,169 | 26.86 | 11 | 201,631 | 110 | 1,154,375 | 3.74 s | 4.57 s |
| baseline 2 | 9,591 | 26.87 | 12 | 194,130 | 106 | 1,112,247 | 3.52 s | 3.15 s |
| candidate 1 | 637 | 2.08 | 6 | 139,696 | 60 | 630,189 | 0.42 s | 1.25 s |
| candidate 2 | 620 | 1.95 | 6 | 139,543 | 60 | 629,591 | 0.40 s | 1.40 s |
| idle, table open (60 s) | n/a | n/a | 2 | n/a | 20 | 209,827 | n/a | n/a |

`diagnostics compare` (files here): plugin CPU 0.263 → 0.021 and 0.263 → 0.019 cores; provider query mean duration unchanged (51.4 → 52.2 ms; 40.5 → 50.3 ms). Warnings reported by the tool: process sessions differ; source state is a modified dev build.

Caveats, stated plainly:

- Provider query count differs (11–12 vs 6) because faster settling leaves fewer refreshes pending in the same scripted steps; it is workload timing, not extra reuse. The provider call itself did not change.
- Namespace LISTs and scanned bytes fall with that query count. Scan work **per provider query** is unchanged (about 10 LISTs, 5x the returned bytes).
- Plugin RSS is higher in the candidate runs (mean 365 MB → 392 MB; separate process lifetimes). Not investigated; the change is host-only.
- Cancellation events were zero in all four runs; cancellation was not exercised here.
- `diagnostics compare` does not report histogram *counts*, so gRPC call totals come from `sumcap.py` (capture last sample minus first). Ground truth for scanned objects/bytes is metrics-server's own `apiserver_request_total` / `apiserver_response_sizes` via `apisrv.sh`, because the plugin does not yet report scan counts.

Reproduce: `run.sh NAME WORKLOAD DURATION` wraps `apisrv.sh` around `omniview-dev diagnostics capture`; `sumcap.py CAPTURE_ID` prints deltas.
