# Metrics release visual evidence

Real local Kind cluster, real Grafana gateway, real Prometheus/cAdvisor samples. No generated metric values.

| Input | Revision |
|---|---|
| Host/runtime candidate | `847a77e9ccc4a0e11a15113872c310c6afb7d8ea` |
| Kubernetes candidate | `77cf9f58d35dc6e339c64d0efa4ca58ee3bf243c` |
| Released SDK | `v0.16.0` / `7d41d708065d896cfae6d5b1caa0fda48c4eb1af` |
| Published UI | base-ui `0.16.0`, ai-ui `6.1.10`, editors `6.2.1` |

## Pod metrics and object references

CPU and memory histories include request/limit references from the Pod object. Domains include those references. Grafana uses a temporary Viewer token stored privately.

![Real Pod metrics and request/limit overlays](pod-metrics-overlays.png)

## Compact table and details

Container indicators, table bars, compact values, source details and cluster/namespace/Pod chips use the published component library.

![Table bars and compact metric provenance](pod-metrics-details-table.png)

## Observed checks

- Host: backend build, 61 Go test packages, metric/Grafana race suites, production frontend and 1,555 frontend tests passed.
- Kubernetes: 11 Go test packages, native metric race suite and 1,783 UI tests passed. UI checks used public UI packages with the source runtime candidate; public runtime lockfile validation follows runtime publication.
- Native metrics verification measured 30 real load-lab Pods. Real Prometheus verification covered CPU, memory, network and KSM. Helm ownership/CRD preflight passed without cluster mutations.
- The actual IDE showed Grafana-backed Pod values, request/limit overlays, identity chips and a Metrics tab when opening a linked Node.
- Local source-cohort profile passed with no peer errors. GitHub checks remain the merge gate; these screenshots do not claim publication or CI completion.
