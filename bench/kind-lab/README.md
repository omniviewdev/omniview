# Local Kubernetes load lab

Real Kubernetes v1.35.0 on kind, with one control plane and multiple workers. Each synthetic application has one BusyBox 1.37.0 HTTP pod, Deployment, Service, 2 KiB ConfigMap, 1 KiB synthetic Secret, and three seed Events. Kubernetes additionally generates ReplicaSets, EndpointSlices, and lifecycle Events. No metrics/profiling stack is installed.

## Workspace

Created through the installed `omniview-dev` CLI:

```sh
omniview-dev workspace create kubernetes-load-lab \
  --root /Users/joshuapare/Repos/omniviewdev/workspaces \
  --plugin kubernetes --json
```

The workspace includes host and Kubernetes plugin feature worktrees. It was not launched: cluster setup does not need a running host. Lab source lives in this workspace's `omniview/bench/kind-lab`, not the original host checkout.

## Capacity

| Preset | Namespaces | Pods / Deployments / Services / Secrets / ConfigMaps, each | Seed Events | Suggested workers | Suggested Docker VM memory |
| --- | ---: | ---: | ---: | ---: | --- |
| smoke | 2 | 4 | 12 | 1 | 4 GiB |
| baseline | 10 | 300 | 900 | 3 | 8–12 GiB |
| large | 20 | 1000 | 3000 | 10 | 20–24 GiB |
| xl | 40 | 2000 | 6000 | 20 | 32–48 GiB |

Memory figures are planning estimates, not measured guarantees. Docker reported 18 CPUs and 7.75 GiB during initial setup. A beefy Mac still needs an explicit Docker Desktop VM memory allocation. Keep enough RAM outside Docker for macOS and Omniview. Other running clusters share that VM.

Workers retain normal kubelet pod limits. Roughly 100 application pods per worker leaves room below the usual 110-pod limit for system pods and rollouts. Do not seed large/xl into the default three-worker topology. Recreate the dedicated lab with the appropriate worker count first. More real nodes consume kubelet/containerd memory; fake nodes would be a separate API-only scenario, not equivalent runtime realism.

Pods request 1m CPU / 4 MiB and limit 50m CPU / 16 MiB. Requests are scheduler inputs, not total cluster memory. No service mesh, ingress, persistent volumes, or heavyweight application images.

## Create and seed

Requirements: Python 3, Docker, kind, kubectl; registry access for node and BusyBox images. Commands run from the host feature worktree:

```sh
cd /Users/joshuapare/Repos/omniviewdev/workspaces/workspaces/kubernetes-load-lab/omniview
python3 bench/kind-lab/lab.py create --workers 3
python3 bench/kind-lab/lab.py seed --preset baseline
python3 bench/kind-lab/lab.py status
```

The baseline cluster already exists after initial setup. Do not rerun `create` against it. Seed is repeatable; it does not prune a previous larger preset. Use a fresh cluster for exact comparative inventories. `render --preset large` emits manifests without contacting Kubernetes.

Kubeconfig is `bench/kind-lab/.state/kubeconfig`; context is `kind-omniview-load-lab`. All lab mutations explicitly select both. Creation never modifies `~/.kube/config`. The API binds loopback, and no application ports are published to the host. State is ignored by Git and contains cluster administrator credentials; do not share it.

To connect Omniview later, select this kubeconfig explicitly in the Kubernetes plugin. Workspace profiles do not isolate HOME or kubeconfig automatically. No production configuration was merged or replaced.

## Activity scenarios

Quiet inventory isolates initial list/load behavior. Churn adds ConfigMap and Secret updates plus bounded Event create/update traffic. Optional rolling updates add real Pod deletion/creation, status changes, EndpointSlice changes, and controller-generated Events.

```sh
# Steady activity: target three direct writes/second for 30 minutes.
python3 bench/kind-lab/lab.py churn --interval 1 --duration 1800

# Active cluster: target fifteen direct writes/second, one rollout per 25 cycles.
python3 bench/kind-lab/lab.py churn --interval 0.2 --duration 1800 --rollout-every 25

# Check inventory and readiness after activity.
python3 bench/kind-lab/lab.py status
```

These rates are targets, not guarantees: kubectl process startup and API latency limit achieved throughput. The final JSON reports completed cycles, direct writes, and rollout requests. Controller writes are additional. Churn runs in the foreground; Ctrl-C stops it. No background load remains after completion. Keep one driver per cluster for comparable runs.

Activity Events use a fixed ring of at most 100 names per namespace. API server event TTL is one hour. Seed Events expire too; rerun seed immediately before an event-heavy comparison. Event names remain bounded even over long runs. ReplicaSet history is limited to one old revision per Deployment. Rollouts can temporarily exceed the steady pod count.

Secrets are synthetic. No cloud accounts, external services, or credentials are required. The HTTP containers are mostly idle; this stresses Kubernetes inventory/watch paths, not application compute or network throughput.

## Reset

Deletion is explicit and destroys only the dedicated `omniview-load-lab` cluster:

```sh
python3 bench/kind-lab/lab.py delete --confirm-delete
python3 bench/kind-lab/lab.py create --workers 10
python3 bench/kind-lab/lab.py seed --preset large
```

Stop churn before reset. Existing unrelated kind clusters are not touched. Larger presets require separate capacity validation before performance conclusions.

## Initial smoke evidence

Created four real nodes, all Ready. Observed 300/300 ready application pods and 300 each of Deployments, Services, Secrets, and ConfigMaps. Seeded 900 synthetic Events; status reported 910 labeled Events after activity. Exercised ten churn cycles: 32 direct writes and two deployment rollouts. An HTTP request from app-000 through the app-001 Service returned `load-lab`. Large/xl remain unexercised capacity presets.
