#!/usr/bin/env bash
# Builds the table bench's corpus: real Pod objects from a kind cluster at 25, 1,025 and 5,025 Pods (README.md; plan
# docs/ui-next/slices/1a-pods-list.md appendix A.2 and A.7).
#
#   bench/table/corpus/corpus.sh [--cluster NAME] [--kubeconfig PATH] [--out DIR] [--image IMAGE]
#
#   --cluster     kind cluster name                      default: ui1a3-table
#   --out         where the files go                     default: ${TMPDIR:-/tmp}/ui1a3-table
#   --kubeconfig  where kind writes its kubeconfig       default: <out>/kubeconfig
#   --image       kind node image                        default: kindest/node:v1.35.0
#
# Creates the cluster, applies the fixture (docs/ui-next/slices/1a-pods-list/fixture.yaml), exports, then scales a Deployment of
# Pending Pods to 1,000 and to 5,000 and exports again. Needs kind, kubectl and a container runtime kind can use; takes about 7 minutes
# (the second scale-up is most of it). Leaves the cluster running: `kind delete cluster --name <cluster>` removes it.
#
# Writes, in <out>:
#   pods-fixture.json  pods-1025.json  pods-5025.json              `kubectl get pods -A -o json`
#   pods-fixture.kubectl.txt  pods-1025.kubectl.txt  pods-5025.kubectl.txt   `kubectl get pods -A --no-headers`, the oracle of podRows.test.mjs
# The JSON and the text of a size are two calls a moment apart; a Pod that restarts between them shows a different count.
#
# The default kubeconfig is never read or written: KUBECONFIG is unset and every kubectl call names the file.

set -euo pipefail
unset KUBECONFIG

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cluster="ui1a3-table"
out="${TMPDIR:-/tmp}/ui1a3-table"
kubeconfig=""
image="kindest/node:v1.35.0"

while [ $# -gt 0 ]; do
  case "$1" in
    --cluster) cluster="${2:?--cluster needs a name}"; shift 2 ;;
    --out) out="${2:?--out needs a directory}"; shift 2 ;;
    --kubeconfig) kubeconfig="${2:?--kubeconfig needs a path}"; shift 2 ;;
    --image) image="${2:?--image needs an image}"; shift 2 ;;
    -h | --help) sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
out="${out%/}"
kubeconfig="${kubeconfig:-$out/kubeconfig}"
fixture="$root/docs/ui-next/slices/1a-pods-list/fixture.yaml"

log() { echo "$(date +%H:%M:%S) $*" >&2; }
k() { kubectl --kubeconfig "$kubeconfig" "$@"; }
sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }

for tool in kind kubectl shasum; do
  command -v "$tool" > /dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done
[ -f "$fixture" ] || { echo "missing fixture: $fixture" >&2; exit 1; }
mkdir -p "$out" "$(dirname "$kubeconfig")"

# Wait until `kubectl get pods` in the namespace lists at least $2 Pods, for at most $3 polls of 3 s.
wait_for_pods() {
  local namespace="$1" want="$2" polls="$3" have=0
  for _ in $(seq 1 "$polls"); do
    have="$(k -n "$namespace" get pods --no-headers 2> /dev/null | wc -l | tr -d ' ')"
    [ "$have" -ge "$want" ] && return 0
    sleep 3
  done
  echo "namespace $namespace holds $have Pods after waiting, expected $want" >&2
  return 1
}

# Export the cluster's Pods as $out/pods-$1.json and $out/pods-$1.kubectl.txt and check that there are $2 of them.
export_pods() {
  local label="$1" want="$2" have
  k get pods -A -o json > "$out/pods-$label.json"
  k get pods -A --no-headers > "$out/pods-$label.kubectl.txt"
  have="$(wc -l < "$out/pods-$label.kubectl.txt" | tr -d ' ')"
  [ "$have" -eq "$want" ] || { echo "pods-$label: $have Pods, expected $want" >&2; return 1; }
  log "pods-$label: $have Pods"
}

log "create cluster $cluster ($image), kubeconfig $kubeconfig"
kind create cluster --name "$cluster" --kubeconfig "$kubeconfig" --image "$image" --wait 180s

log "apply the fixture"
k apply -f "$fixture"
k -n checkout wait --for=condition=Ready pod -l app=cart-api --timeout=240s || log "cart-api is not ready, continuing"
# The fixture's crash loops and init failures need a moment to reach the states they are named for.
sleep 20
export_pods fixture 25

log "scale to 1,000 Pods in namespace scale"
k create namespace scale
# Every Pod stays Pending (no node matches): real objects, no kubelet cost.
k apply -f - << 'YAML'
apiVersion: apps/v1
kind: Deployment
metadata: {name: scale-probe, namespace: scale}
spec:
  replicas: 1000
  selector: {matchLabels: {app: scale-probe}}
  template:
    metadata: {labels: {app: scale-probe}}
    spec:
      nodeSelector: {does-not-exist: "true"}
      containers:
        - {name: app, image: busybox:1.37.0, command: [sh, -c, "sleep 100000"]}
YAML
wait_for_pods scale 1000 120
export_pods 1025 1025

log "scale to 5,000 Pods"
k -n scale scale deployment scale-probe --replicas=5000
wait_for_pods scale 5000 240
export_pods 5025 5025

log "done; sha-256 of each file:"
for label in fixture 1025 5025; do
  for file in "$out/pods-$label.json" "$out/pods-$label.kubectl.txt"; do
    printf '%s  %s  %s lines\n' "$(sha256 "$file")" "$file" "$(wc -l < "$file" | tr -d ' ')"
  done
done
