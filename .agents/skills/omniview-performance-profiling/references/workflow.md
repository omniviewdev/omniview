# Workspace-to-profile workflow

## Select sources and launch

Use explicit `COLLECTION`, `FEATURE`, and canonical host source. Inspect the collection's `.omniview-dev/repositories.json`; mappings are immutable. Resolve repository paths through `workspace paths`, not sibling-directory guesses. The installed Homebrew cask bundles the CLI:

```sh
brew update
brew upgrade --cask omniview
omniview-dev --help
pnpm --version
node --version
kind get clusters
```

A broad `brew list --versions` can fail on an unrelated stale cask. Query `brew list --cask --versions omniview` instead. Current native pnpm pin lives in the selected host's `package.json`. Existing shell PATH can differ from Homebrew's installation; use the native executable described in `docs/development-workspaces.md`.

For application profiling, resolve the SDK commit from the selected host's `go.mod`, use UI packages from its lockfile, and select Kubernetes at the host gitlink. With the host checkout at `HOST_REF`, obtain `SDK_REF` using `node e2e/scripts/sdk-source.mjs print` from that checkout and `KUBERNETES_REF` using `git rev-parse HEAD:plugins/kubernetes`. Fetch missing refs in their registered repositories. Do not reset canonical source or select a stale SDK simply because it has a convenient sibling directory.

```sh
omniview-dev workspace create "$FEATURE" --root "$COLLECTION" \
  --repo plugin-sdk --plugin kubernetes \
  --ref "omniview=$HOST_REF" \
  --ref "plugin-sdk=$SDK_REF" --ref "kubernetes=$KUBERNETES_REF" --json
omniview-dev workspace paths "$FEATURE" --root "$COLLECTION" --json
```

Assign `WORKSPACE`, `HOST`, `SDK` and `KUBERNETES` from the returned paths. For an existing workspace, inspect/resume it instead of creating a duplicate. The selected local SDK checkout's HEAD and source digest are observed by the workspace. Run preflight to see all missing inputs:

```sh
PREFLIGHT_STATUS=0
omniview-dev workspace preflight --workspace "$WORKSPACE" --json || PREFLIGHT_STATUS=$?
case "$PREFLIGHT_STATUS" in 0|3) ;; *) exit "$PREFLIGHT_STATUS" ;; esac
```

Exit 3 is expected when evidence is missing; generate the real evidence below.
Other preflight failures must not be treated as missing evidence.

Generate real protocol evidence if none is retained. From the selected host checkout:

```sh
(
cd "$HOST"
unset OMNIVIEW_PPROF_PORT
MODFILE="$(task --silent host:prepare SDK_SOURCE="$SDK")"
LINK_EVIDENCE="$WORKSPACE/.local/link-protocol.json"
GOWORK=off GOFLAGS= A11_PROTOCOL_PROBE=1 A11_PROTOCOL_REPORT="$LINK_EVIDENCE" \
  go test -modfile="$MODFILE" -tags server ./internal/devworkspace \
  -run '^TestLinkPinnedProtocolProbe$' -count=1 -v
omniview-dev workspace up --workspace "$WORKSPACE" --mode browser --watch=false \
  --link-evidence "$LINK_EVIDENCE" --json
)
```

Do not manufacture probe JSON, disable peers, or install independently inside managed children. Managed launch owns package ordering, pinned Wails tooling and `task bindings`. A cold launch took about 221 seconds in the initial local smoke; that is an observation, not a readiness deadline or performance guarantee. Inspect/follow the owned operation if launch fails; do not kill an arbitrary PID or hand-edit generated package files.

## Prepare the dedicated load cluster

Run from the returned Kubernetes worktree. Source: `hack/kind-lab/README.md` and `lab.py`.

For a missing cluster only:

```sh
(
cd "$KUBERNETES"
python3 hack/kind-lab/lab.py create --workers 3
)
```

For an existing `omniview-load-lab` whose private kubeconfig is absent in this worktree, recover without touching the default kubeconfig:

```sh
(
cd "$KUBERNETES"
install -d -m 700 hack/kind-lab/.state
kind export kubeconfig --name omniview-load-lab \
  --kubeconfig "$PWD/hack/kind-lab/.state/kubeconfig"
chmod 600 hack/kind-lab/.state/kubeconfig
)
```

Inspect ownership/topology before mutation. The driver's fixed cluster name is not an ownership receipt. Never auto-delete/recreate it. Then seed the selected existing lab:

```sh
(
cd "$KUBERNETES"
python3 hack/kind-lab/lab.py seed --preset baseline
python3 hack/kind-lab/lab.py status
kubectl --kubeconfig "$PWD/hack/kind-lab/.state/kubeconfig" \
  --context kind-omniview-load-lab get pods -A \
  -l app.kubernetes.io/part-of=omniview-load-lab -o json
)
```

Baseline targets 300 application Pods plus system Pods, 300 each Deployments/Services/ConfigMaps/Secrets, and 900 seed Events across ten namespaces. Three workers leave room for rollouts. Large/xl need a different worker topology and Docker VM memory. Record actual counts and readiness; `Deployment Available` can precede a settled rollout. Count total Events separately from labeled seed Events. Do not call this a quiet matched baseline while old Pods terminate or controller activity continues.

## Configure only the selected workspace

After first launch, set plugin discovery explicitly. `KUBECONFIG` environment alone does not configure it.

```sh
unset OMNIVIEW_PPROF_PORT
KUBE_VALUES="$(node -e 'process.stdout.write(JSON.stringify({kubeconfigs:[process.argv[1]]}))' "$KUBERNETES/hack/kind-lab/.state/kubeconfig")"
omniview-dev settings set-many --workspace "$WORKSPACE" \
  --scope plugin --plugin kubernetes \
  --values "$KUBE_VALUES" \
  --wait --json
omniview-dev settings set-many --workspace "$WORKSPACE" \
  --values '{"developer.pprof_enabled":true,"developer.pprof_port":0,"developer.plugin_pprof_enabled":true,"telemetry.enabled":false,"telemetry.profiling":false}' \
  --wait --json
omniview-dev workspace restart --workspace "$WORKSPACE" --json
omniview-dev workspace inspect --workspace "$WORKSPACE" --json
```

Restart uses saved mode/watch configuration. To change those, use `down` followed by `up` with explicit options; do not pass `--mode` or `--watch` to restart. Profiling preferences apply at host startup. Ambient plugin profiling variables do not override host preferences. Unset the host's `OMNIVIEW_PPROF_PORT` override before launch/restart so saved port `0` selects an available port; otherwise explicitly record the override and actual endpoint.

## Verify and capture

Open `instance.endpoints.browser`, not the asset-only Vite endpoint. Wait for the actual rendered Kubernetes contribution and matching document UUID/generation. Open footer **pprof** and record current host/plugin URLs plus verified PID/start identities under **Processes**. Browser mode correctly reports native UI inspection unavailable.

Assign `HOST_PPROF` and `PLUGIN_PPROF` from that current popover; include trailing `/debug/pprof/`. Never derive ports from a previous process. Keep outputs in a private ignored directory:

```sh
(
install -d -m 700 "$WORKSPACE/.local/profiling-evidence"
cd "$WORKSPACE/.local/profiling-evidence"
curl --fail --max-time 30 -o host-cpu.pprof "${HOST_PPROF}profile?seconds=15" &
HOST_CAPTURE=$!
curl --fail --max-time 30 -o kubernetes-cpu.pprof "${PLUGIN_PPROF}profile?seconds=15" &
PLUGIN_CAPTURE=$!
(
  sleep 3
  curl --fail --max-time 30 -o host-goroutines.txt "${HOST_PPROF}goroutine?debug=2"
  curl --fail --max-time 30 -o kubernetes-goroutines.txt "${PLUGIN_PPROF}goroutine?debug=2"
) &
GOROUTINE_CAPTURE=$!
# Exercise the actual cluster click now, before the timed goroutine capture.
wait "$HOST_CAPTURE"
wait "$PLUGIN_CAPTURE"
wait "$GOROUTINE_CAPTURE"
curl --fail --max-time 30 -o host-heap.pprof "${HOST_PPROF}heap"
curl --fail --max-time 30 -o kubernetes-heap.pprof "${PLUGIN_PPROF}heap"
GOWORK=off go tool pprof -top host-cpu.pprof
GOWORK=off go tool pprof -top kubernetes-cpu.pprof
GOWORK=off go tool pprof -top host-heap.pprof
GOWORK=off go tool pprof -top kubernetes-heap.pprof
)
```

Take goroutines during a slow operation, not only after it fails. Separate trace runs from CPU measurements when comparing overhead-sensitive results:

```sh
(
cd "$WORKSPACE/.local/profiling-evidence"
curl --fail --max-time 30 -o kubernetes.trace "${PLUGIN_PPROF}trace?seconds=5"
GOWORK=off go tool trace -pprof=net kubernetes.trace > kubernetes-net.pprof
GOWORK=off go tool pprof -top kubernetes-net.pprof
)
```

`go tool trace` has no `-o` flag; redirect its binary output. CPU captures cap at 120 seconds, traces at 15. Endpoints reject Origin headers and nonnumeric-loopback Host headers. CPU captures cannot share a process with active Pyroscope CPU profiling. Do not forward ports or publish profiles.

Use separate receipts for connect, dashboard, loaded Pods idle, and optional bounded activity:

```sh
(
cd "$KUBERNETES"
# No rollout traffic unless explicitly requested.
python3 hack/kind-lab/lab.py churn --interval 1 --duration 15
)
```

The driver reports actual completed cycles/writes. Duration is finite. Record actual throughput rather than assuming three writes/second. Stop owned load/proxies when done. Retain app/plugin/source identities, build mode, viewport, workload, warmup, timestamps and raw artifacts. Browser CPU profiles are Chromium evidence only; native UI needs Safari Timelines. See `README.md`'s profiling sections for limits and native inspection.

## Interpret slow connection

A public `omniview:resource/timeout` 408 can represent an internal context/gRPC deadline. It does not mean Kubernetes returned HTTP 408. Preserve request correlation and original safe classification.

The initial 2026-11-02 reproduction timed out at 10.03 seconds with 400 ms added per GET and successful API responses. In-flight goroutines identified sequential discovery; CPU was almost idle. The user's separate work-cluster measurements found 84 discovery requests consuming 9.93 seconds before identity/schema acquisition. Keep user-machine findings distinct from local controlled receipts.

The edited SDK/plugin integration exposes `connection_acquisition_timeout_seconds`
through plugin settings: 1-300 whole seconds, default 10. Confirm that the selected
plugin's live settings schema contains this key before using it; older releases
do not. Changes affect only the next initial acquisition/catalog refresh, not an
operation already running or a retained client/watch lifetime. The same controlled
latency connection succeeded with bounded parallel stages and the unchanged
10-second budget; a live 1-second policy failed and a later 30-second policy
succeeded without a restart. Raising the budget is not a substitute for fixing
serial work, preserving throttling, or profiling the actual affected cluster.

Bound concurrency without bypassing client-go rate limits, server APF/429 handling, scope or identity fencing. Do not move Kubernetes group/version, schema or EKS logic into the host or generic SDK. Timeout policy may be shared; protocols remain adapter-owned. Inspect the selected plugin/SDK source and settings schema before assuming a configurable policy has shipped.

## Compare ordinary-network connection times

Do not compare a timeout with a successful elapsed time as if both completed the
same operation. Use separate unchanged/edited workspaces with the same host and
UI source, workload, viewport, timeout policy and settings. If cold restarts expose
a host readiness bug, fix it separately and apply the identical host change to
both variants; never weaken source-epoch fences or count manual recovery as a
clean success.

Disable profiling and telemetry in both profiles before measurement. Run one
host/plugin pair at a time, with a fresh process and browser document per trial.
Warm the build/code path separately, then alternate paired source variants for
at least five measured trials each. Record source commits, process generations,
per-trial inventory and event counts, failures and measurement overhead.
Event TTL can change the fixture between pairs; verify equal counts within each
pair and disclose drift. Event-only seeding avoids unwanted deployment rollouts.

Start timing immediately before the real connection action. Keep the resource
gate opening, first visible data, and all-source initial completion separate.
Use real source states, not disappearance of a toast alone: startup eager sources
may finish while a failed dashboard never mounts its demand-driven Event source.
Never treat a partially populated source denominator as fully synced.

Report median and range plus all sanitized samples. Preserve failed warmups,
state their exclusion, and do not infer significance from five close localhost
measurements. The investigation's matched receipt records only a small local
gain; high-latency recovery, native rendering and affected-cluster performance
are separate claims.
