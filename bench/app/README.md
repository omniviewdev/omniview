# Whole-app profile

The real production frontend, kubernetes plugin included, profiled in Playwright Chromium
with the Wails backend faked inside the page. Where `bench/render` measures single screens
mounted in isolation, this measures the app as a user drives it: startup, plugin loading,
routing, and the screens running inside the full shell.

The whole-app fixture registers a `main` workspace window and implements its
runtime name and state calls. Startup resolves window identity before rendering;
generic no-op window answers prevent the startup-ready marker from firing.

```bash
pnpm bench:app                         # build, then 5 runs of every scenario (~3 min)
pnpm bench:app --runs 3 --only pods    # some scenarios
pnpm bench:app --no-build              # reuse bench/app/dist and the plugin bundle
pnpm bench:app --runs 3 --only pods --cpu-throttle 4  # weaker-CPU sensitivity, not M1 hardware certification
pnpm bench:app --headed                # watch it
node bench/app/report.mjs              # Markdown summary of results/latest.json again
```

Also `task perf:app -- <args>`. First run locally: `pnpm install --frozen-lockfile`,
`task packages` (providers → runtime → Vite plugin) and
`pnpm exec playwright install chromium`. The pinned Kubernetes submodule records
its standalone dependencies in its UI manifest and lockfile. Canonical candidate
runs instead use the workspace-selected SDK, UI, and runtime sources.
Older plugin archives built against MUI or legacy UI contracts are incompatible.

The Logs scenario selects a container from the opened Logs submenu, not from the
parent action list. Adding actions such as Debug must not change which workload
is measured; line counts, scrolling, drawer toggles, and run counts stay unchanged.
Drawer toggles use the log viewer's bottom-drawer strip, never a document-wide
Expand/Minimize label or button position. Sidebar tree controls may share those
labels; every measured toggle must still change the drawer's actual height.

Drawer toggle controls are selected within the measured bottom drawer. Resource
trees can also expose an `Expand` button; a document-wide lookup can click that
unrelated control without resizing the drawer. The geometry assertion still
requires a height change of more than 50 pixels for each of the ten toggles.

The Pod scenario opens a complete 5,000-Pod source-view collection, delivered in
256-record snapshot batches, then scrolls up to 30 viewport steps. Explicit
finite-page requests still honor their requested page sizes and cursors. Snapshot
batch size does not limit collection size. Compare matching collection workloads
and CPU throttles, not older 256-row page measurements. The shared browser bridge
dispatches both named V2 calls and generated binding IDs.
Scroll workloads stop at the real positive scroll boundary, reject no-op steps and
unexpected end positions, and verify the reset. Reports expose actual forward steps
and total steps (including the reset); wall and busy per-step timings use that
actual total rather than the requested 30-step budget.

## Reproducible application sources

CI resolves the SDK commit from the host's declared `go.mod` dependency and
checks out that commit for the managed workspace. UI packages come from the host
lockfile; Kubernetes comes from the host's `plugins/kubernetes` gitlink. The
host input remains the exact checked-out PR commit, or the selected branch
commit for manual dispatch. Managed workspaces record the SDK checkout's commit
and source digest, rather than requiring an approval revision.

The source builder reuses canonical workspace `Init`/`Create`/`Link`, native pnpm
12.14.0, the actual protocol-probe report, and the existing JavaScript build graph
and output-ownership producers in a disposable collection with its own private
home. Its manager uses the same session-aware `RequireStopped` guard as the real
workspace CLI; a private home is not a substitute for proving the workspace is
stopped before linking or retirement. It builds the Kubernetes UI dependency
closure and uses the host's committed Wails bindings as compiler inputs, just as
for `task packages`; no native host, plugin backend, SDK attestation or app
service is substituted or launched. Source manifests retain their declared
versions. Registry edges retain their lock evidence. Install scripts remain
disabled and strict peers are audited recursively.

Source install policies must agree explicitly. The host and Kubernetes sources
must both declare `allowBuilds.esbuild: true`, with Kubernetes retaining
`unrs-resolver: false`. The managed install still uses `--ignore-scripts`; the
builder does not rewrite policies, approve all scripts, or relax peers.

With installed/built host packages, initialize the Kubernetes submodule and check
out the SDK commit resolved by the host module:

```bash
git submodule update --init plugins/kubernetes
SDK_SOURCE=/absolute/path/plugin-sdk
SDK_COMMIT="$(node e2e/scripts/sdk-source.mjs print)"
git -C "$SDK_SOURCE" checkout --detach "$SDK_COMMIT"
```

PR validation runs for stacked PR bases as well as `main`, with read-only
permissions. Release and nightly workflows retain published dependencies.

Prepare the effective host module with the selected SDK before running the
probe or builder; keep the generated modfile outside the source checkout:

```bash
HOST_MODFILE="$(GOWORK=off GOFLAGS= go run ./scripts/hostmod/main.go \
  --root "$PWD" --sdk-source "$SDK_SOURCE")"
A11_PROTOCOL_PROBE=1 A11_PROTOCOL_REPORT=/absolute/path/link-protocol.json \
  GOWORK=off GOFLAGS= go test -mod=readonly -modfile="$HOST_MODFILE" -tags server ./internal/devworkspace \
  -run '^TestLinkPinnedProtocolProbe$' -count=1
GOWORK=off GOFLAGS= go run -mod=readonly -modfile="$HOST_MODFILE" -tags server ./bench/app/build-plugin \
  --host "$PWD" --host-ref "$(git rev-parse HEAD)" \
  --sdk "$SDK_SOURCE" --sdk-ref "$SDK_COMMIT" \
  --kubernetes "$PWD/plugins/kubernetes" --kubernetes-ref "$(git -C plugins/kubernetes rev-parse HEAD)" \
  --link-evidence /absolute/path/link-protocol.json -- --runs 3
```

The builder uses committed source refs, not uncommitted checkout edits. It keeps
the private collection alive while the original host runs `pnpm bench:app`,
passing the actual Kubernetes `dist/assets` and matching `plugin.json` through
`OV_K8S_PLUGIN_DIST` and `OV_K8S_PLUGIN_METADATA`. On exit it unlinks, restores
owned outputs, and retires its worktrees and branches. Ownership conflicts retain
the collection and report its path instead of deleting uncertain files.

## How it works

- **Build.** `vite.config.ts` here builds the app like `vite.config.ts` at the root, plus:
  `react-dom/client` resolves to `react-dom/profiling` so `<Profiler>` works in production
  React, and `ui/main.tsx` is rewritten at build time to import `page/fake-backend.ts` first
  and wrap the root in `page/profiler.tsx`. The app's source is not changed.
  This is the profiling build, not the normal production React build: React render, commit
  and slowest-commit columns include profiling overhead, so these results are not
  comparable with normal-production measurements.
- **Fake backend.** `page/fake-backend.ts` installs the `bench/render` transport and fixtures
  (bindings → handlers by name, `emit` for backend events), and adds what the full shell
  asks for at startup: the installed plugin list, a connection, source state, log sessions.
  The page reads its setup from `window.__OV_BENCH__` (`{ plugins, pods }`), set by the
  runner before navigation, and exposes controls on `window.__ovBench`. Calls are answered
  in-page, so there is no IPC cost in the numbers.
- **Plugin.** The real Kubernetes UI `dist/assets` directory is served at
  `/_/plugins/kubernetes/assets/` by `vite preview`, where the app's SystemJS loader
  fetches it, exactly as from `~/.omniview/plugins` in the native app.
  `OV_K8S_PLUGIN_DIST=<assets-dir>` selects an explicitly built external bundle;
  `OV_K8S_PLUGIN_METADATA=<plugin.json>` selects its matching source metadata. Relative
  override paths resolve from the host root, as in `vite.config.ts` (both use
  `plugin-bundle.mjs`), not from the working directory.
  Empty overrides and missing, empty or non-file `entry.js` entries fail before
  profiling. Without an override, the runner builds the bundled UI if missing;
  that checkout must independently satisfy the host's current consumer contract.
- **Startup marker.** The app reports "interactive" through `ReportStartupReady`, the same
  marker `task perf:coldstart` reads from the native app (first painted frame after the
  router's first render).

## Scenarios

| Scenario | Steps |
|---|---|
| `cold-start` | Fresh browser context, no plugins installed, until the startup marker. |
| `cold-start-k8s` | As above with the kubernetes plugin; also until the plugin's home card shows. |
| `pods` | `open`: from the home page, acquire all 5,000 Pod records until a row shows. `scroll`: up to 30 viewport steps through the collection, then back to top, each waiting for a painted frame. |
| `logs` | `open`: Pod row menu → Logs, until the viewer shows. `stream`: 10,000 lines in batches of 100, one batch per task, until the line counter reaches 10,000. `scroll`: up to 30 viewport steps within the available log buffer, then back to top. `drawer`: minimize/expand the bottom drawer 10 times. |

Every scenario runs once as a discarded warmup, then `--runs` times, each in a new browser
context.

## Metrics

| Column | Meaning |
|---|---|
| interactive | Startup marker, ms from navigation start. |
| wall | Time the step took, measured in the page. Scroll and toggle steps wait for a painted frame each, so `wall / step` cannot go below ~33 ms (two frames). |
| busy / step | Main-thread time per scroll page or toggle: the work behind each step without the frame-wait floor. Compare this one across commits. |
| main thread busy, script, layout + style | CDP `Performance.getMetrics` deltas (TaskDuration, ScriptDuration, LayoutDuration + RecalcStyleDuration). |
| TBT, long tasks | Total blocking time (time beyond 50 ms in each long task) and the number of long tasks. |
| React render, commits, slowest commit | `<Profiler>` around the app root: summed `actualDuration`, number of commits, the largest one. Plugin screens render in the same root and are included. |
| heap MB | `JSHeapUsedSize` at the end of the step. |

JSON (`results/latest.json`) has every run's raw values, plus page errors and backend calls
without a fixture. Compare runs on the same machine only.

## Result provenance

Every result records what was measured, so it is compared only with a matching one.

- **Workload.** `meta.workload` carries an `id` and the parameters this runner applied.
  `whole-app/v1` is a complete 5,000-Pod source-view collection delivered by the
  `bench/render` fixture in 256-record snapshot batches, scrolled for up to 30 viewport
  steps, plus 10,000 log lines, 30 log scroll steps and 10 drawer toggles at 1440×900.
  It assumes the selected Kubernetes UI acquires the Pod corpus through source views, as
  the current plugin does; `plugin.bundle` says which build ran. Change the id whenever a
  scenario's fixture, size or steps change. A result with no workload id is an **unknown
  legacy workload**, including the older 256-row native-page runs. `report.mjs` says so and
  never describes it as the 5,000-record collection.
- **Frontend.** `meta.frontend` identifies every file in `bench/app/dist` by a tree
  SHA-256. A fresh build also records its configuration hash and `react-dom/profiling`.
  With `--no-build`, the build configuration and React variant are unknown: the
  runner identifies the reused bytes, not how an earlier process produced them.
- **Host and plugin source.** `commit`, `dirty` and `hostSource` identify the host checkout
  by its full HEAD and a SHA-256 of `git diff --binary HEAD`, as `real-resource.mjs` does.
  Untracked files are not part of that identity. `plugin.checkout` records a plugin commit
  only for a repository other than the host that tracks the selected `plugin.json` and
  contains the selected assets directory. A plugin directory inside the host repository, such
  as an uninitialized `plugins/kubernetes` submodule, resolves to the host commit; it is
  recorded as `unknown` with its reason, never as the host SHA. A failed git lookup is
  `unknown` (`dirty: null`), not an empty value.
- **Plugin bytes.** `plugin.bundle` has the file count, size, the `entry.js` SHA-256 and a
  SHA-256 over every served file by relative path and content; `plugin.metadataSHA256`
  identifies the selected `plugin.json`. The bundle hash, not the commit, says which bytes
  were measured: a commit does not prove the bundle was built from it.

A dirty run is reproducible only if its diff and built artifacts were retained. The hashes
verify retained inputs; they do not recreate lost ones. Unit tests for these helpers and the
report:

```sh
node --test bench/app/plugin-bundle.test.mjs bench/app/report.test.mjs
```

## Cluster scrolling pass, 2026-11-09

[Raw measurements and limits](cluster-performance-2026-11-09.json) record the
baseline and candidate. Their commit IDs pin only the workspace bases: the `viewportJump`
runs record dirty host trees, and the receipt cannot be reproduced (see below). Nominal scrolling eliminated catalog
requests and improved frame timing with fourfold CPU throttling. Overscan
increased from 15 to 24 rows per side; fixed-height windows reuse ranges within
four-row boundaries. Row menus and tooltips share popup owners.

This is not an end-to-end success claim. The larger-jump workload regressed,
fourfold-throttled nominal scrolling did not meet a 60-fps budget, and the fixture
did not reproduce native black rows. The isolated CLI workspace was created from
`origin/main`, but its live launch stalled and timed out. Static retry and stopped
recovery failed generated-cache ownership checks. Those CLI issues were recorded;
no owned caches were deleted to bypass validation. Real-cluster and M1 Pro
acceptance remain unverified.

Provenance of that receipt is limited. Both `viewportJump` metas record a dirty host working
tree, the Kubernetes UI working tree's state was not recorded, and the exact diffs, build
inputs and built bundles were not retained, so it cannot be reproduced from its commit IDs.
The older baseline runner stored the host commit as `k8sPlugin`; the file keeps that raw value
as `k8sPluginRaw`, marked invalid, and the baseline plugin source is unknown. The candidate's
`k8sPlugin` came only from the metadata file's parent directory and is unverified. The receipt
records a normal React production build, while `run.mjs` measures the profiling build
(`react-dom/profiling`), so their timings and React columns are not comparable. The
`viewportJump` workload ID and record count were not recorded: it is an unknown legacy
workload, not the 5,000-record collection. No measurement was edited.

## Real resource boundary (verification-only)

`real-resource.mjs` is separate from `run.mjs`/`perf:app`. It attaches to an
authenticated CLI-managed development **browser host**, never a Vite asset URL
or fake backend. The workspace must explicitly select the safe
`workspace-probe` source, the host, UI, SDK and Kubernetes repositories. The
Kubernetes workload is a credential-free Pod fixture in the probe, **not** a
cluster or a released Kubernetes/cloud/container/hypervisor provider.

The canonical fixture is `e2e/fixtures/workspace-probe`; its explicit source
producer is `e2e/scripts/prepare-workspace-probe.mjs`. An existing managed probe
must receive the same fixture files byte-for-byte in its own feature worktree;
do not overwrite its registered source repository or change registry mappings.
The runner checks canonical/managed source equality. Preserve the existing
settings/click smoke behavior.

The probe's standalone Go module pins SDK v0.15.0 and its required gRPC fork.
Go replacements are not transitive: retain the probe's transport replacement
when selecting a local SDK. Snapshot and update observations use the SDK's
compact source-record conversion; finite pages retain their full representation.

### Corpus and launch

The committed `pkg/resource-corpus.json` snapshot is generated from SDK
`da0c53be2da636d3833b7ca1e73f8a6c8d26b5c7` by:

```sh
node bench/app/export-resource-corpus.mjs \
  --sdk-source /absolute/selected/plugin-sdk \
  --out e2e/fixtures/workspace-probe/pkg/resource-corpus.json
```

Run under the approved clean environment with `GOWORK=off`. The exporter
requires that exact SDK HEAD and committed corpus source bytes, records source
and corpus SHA-256, imports SDK-internal data from an exclusively created
temporary SDK command, and removes that command in `finally`. JSON is embedded
directly from Go: do not parse/re-encode canonical native numbers in JavaScript.
No public SDK API or additional package is published.

Named canonical finite scenarios are `cloud-bundled-pages`,
`container-bundled-events`, `hypervisor-bundled-vms` and
`kubernetes-snapshot`. A second acquisition requests bounded
`p02:copies:1000:0` fixture stress pages of at most 200 **unchanged payload
copies**. Copy ordinal is only diagnostic table identity, not a fabricated
native resource ID. Cloud and hypervisor retain their canonical page cursors
for the native finite run; hypervisor is snapshot-only. Container release is a
one-shot fixture List cursor after a ready source view. It is coordination,
not a source continuity/ACK/replay guarantee.

Use canonical workspace `up`/`inspect`/`down` in a private HOME without real
credentials, kubeconfig, cloud inventory or copied production plugin state.
Before `up`, explicitly set `OMNIVIEW_P02_METRICS_SOCKET` to an absent socket
inside an already owned canonical `0700` directory. The absolute socket path
must be at most 103 bytes (Darwin limit). Pass the same variable to the managed
CLI launch environment; ordinary startup is unchanged when absent. Only a
`devcontrol` build starts this sampler after verified development identity and
control publication. A requested invalid sampler fails startup. Plugin child
environments exclude the socket control. No TCP endpoint or public binding is
added. On shutdown the lifecycle closes the sampler and removes only its own
socket inode; the caller owns the private parent directory.

After the controlled generation/build/install barrier, take the actual
generation from authenticated inspection and run:

```sh
node bench/app/real-resource.mjs \
  --dev /absolute/immutable/omniview-dev \
  --workspace /absolute/managed/feature \
  --workspace-id UUID --generation ACTUAL_GENERATION \
  --host-metrics-socket /private/short-owned-directory/metrics.sock \
  --runs 3 --copies 1000 --out /absolute/new-result.json
```

Use the same clean launcher for **all** commands. The runner rejects a changed
UUID/generation/state/source, uses only `instance.endpoints.browser`, verifies
the document boot identity, and records selected source commits, dirty tracked
diff hashes, exact fixture hashes, tools/hardware/viewport and browser version.
Results are written exclusively (`wx`), including partial failure evidence.
The runner closes Chromium and explicitly closes its fixture source views,
connections and cache; the owner must then `workspace down` and inspect
the stopped generation, verify socket removal and retire the empty private
sampler directory. It never terminates another owner's workspace/process.

### Metric meanings and limitations

- Real finite page roundtrips, rows, decoded payload bytes and visible table
  bodies are separate from sparse-event work. Current SDK/JS numeric losses,
  clamped unknown totals and absent coverage/freshness transport are **not
  repaired** with out-of-band raw-body strings.
- CDP records actual Wails HTTP encoded response transfer bytes, serialized
  request-body bytes and WebSocket payload bytes by request/frame. These exclude
  socket/TLS/WS framing and are not gRPC protobuf-wire byte counts. Native body
  byte counters and re-serialized decoded JSON bytes are separately labeled.
- Browser main-thread task/script/layout/style work, long tasks and heap are
  Chromium measurements. Visible expected table content plus two animation
  frames is a rendering-opportunity bound, not compositor/native pixel proof.
- The private sampler reports actual host Go heap allocation/in-use/object
  totals, allocations/frees, GC and goroutines with host identity. Explicit
  GC-then-snapshot happens only outside timed action phases. Ordinary snapshots
  include `samplingNanos`; account for instrumentation overhead.
  Explicit retention snapshots also take a bounded (4096 goroutines, one
  attempt, 64 expanded frames per stack) runtime goroutine profile. Exact
  matched host watch-event/connection-event listener function counts are
  background-listener observations, **not** open gRPC streams. Concurrent growth,
  depth truncation and unmatched/renamed functions remain explicit unavailable
  or lower-bound observations, never invented zero stream counts.
  Provider heap and source gauges are labeled provider-only. `ps` supplies actual host
  cumulative CPU/RSS; RSS is not retained heap.
- Typing, scrolling, grouping/detail expansion and repeated mounts exercise a
  diagnostic **existing base-ui DataTable**, not a new product resource view.
  Its immediate local text filtering is not the default Resources 500 ms
  debounce, host CEL execution or a global-inventory query. Stress copies
  exercise payload/render cost only. Inactive React Query cache retention is
  sampled before explicit owned-cache removal.
- The container diagnostic uses `useResources` collection mode for live source
  updates and owns a separate source view to retain the stream across table-only
  unmounts. The fixture does not establish provider continuity or replay guarantees.
- Source streams, source rows copied, frontend views and connection-owned
  inventory are different quantities. Only available counters and observations
  are reported; unavailable query semantics and counts are not measured as zero.
  Cleanup closes the diagnostic's `OpenSourceView` handle using
  `CloseSourceView`, then reads the provider's actual source-watch gauge through
  the real List path before stopping the connection. Connection-owned inventory
  or another view can still hold the stream at that point, so this gauge is not
  proof of cancellation. Table-only `window.__p02.unmount()` intentionally retains
  the diagnostic view, sources and inactive queries for retention sampling.
  Toggling off the entire diagnostic or leaving its route drains pending
  connection/view opens, closes owned views, stops every owned connection and
  clears only diagnostic caches. Root cleanup uses its effect-local control.
  Cleanup failures are reported and do not skip other connections or cache removal.
  The fixture also emits numeric `p02Lifecycle` stderr observations under its
  source mutex at client destruction and stream termination. Correlate new log
  records to the authenticated owned plugin process/generation and root-stop
  boundary to observe final connection and source-watch counts after the last client is
  destroyed; a new List call cannot inspect a stopped client. These fixture-only
  observations contain no resource IDs/bodies and do not add a public API.
- A clean HOME is not network isolation. The fixture has no external source
  client, but startup marketplace/telemetry behavior needs separate egress
  policy/evidence before claiming a network-free host.

Keep `pnpm bench:app`, `bench/render`, and UI `packages/benchmarks` results in
separate artifacts labeled **fake-backend/isolated renderer**, with their own
source/environment provenance. Never combine their timings with this real IPC
path or claim Chromium results measure native WebView performance. No budget
or production-provider acceptance is implied by either harness.

### Preserved baseline receipt (2026-10-24)

[`resource-baseline-2026-10-24.json`](./resource-baseline-2026-10-24.json)
is a portable allowlisted projection of the preserved accepted run, not a new
measurement. It contains all 111 timed action observations, 24 retention
observations, 18 native page observations, host/provider counters, per-action
network indices and numerical network observations, source/fixture hashes,
environment pins and the separately labeled unchanged JSDOM renderer result.
Original raw-result SHA-256 is
`0fd77e9bf167964aa95ed4ff5c9ecf737d1f3e4fbfb8e39389fa286377ce7992`;
renderer SHA-256 is
`853d6c41d263f395cac555ff2094a028f595184e919a564ff4f1aa1edb3a7ea1`.
Private paths, process identities/PIDs, network addresses, screenshots and
visible body text are excluded; original private raw artifacts remain intact.

Native finite page arithmetic medians are **cloud 1.350 ms**, container
2.100 ms, **hypervisor 1.300 ms** and Kubernetes 2.200 ms. Cloud and hypervisor
each have six pages: average their two central sorted observations, rather
than taking the upper-middle sample. These correct earlier prose summaries;
no baseline was rerun. Stress-copy pages are not included in those populations.
The receipt preserves full-precision page timestamps and roundtrip summaries.

The later root-component cleanup correction is **not measured** by this
historical run. Its source validation is a separate coordinator-controlled
barrier; do not relabel historical timings as corrected-source performance.
The lifecycle unit test uses provider/runtime/table boundary doubles only and
does not replace an actual managed host/provider smoke. From the host root,
under the approved clean launcher and only after that barrier:

```sh
node node_modules/vitest/vitest.mjs run \
  --config bench/app/resource-benchmark.vitest.config.ts --configLoader runner
node --test bench/app/resource-measurements.test.mjs
```

Use the supported runner config loader above, not the default bundled loader:
bundling creates `node_modules/.vite-temp` outside the managed producer ledger.
The dedicated config disables Vitest's result cache so this unit command also
does not create unowned `node_modules/.vite/vitest` output. Never run standalone
`pnpm run` or `pnpm exec` in a managed feature: pnpm12 may auto-install its
standalone graph. Use these installed Node entrypoints under the clean launcher.

[`resource-cleanup-2026-10-24.json`](./resource-cleanup-2026-10-24.json)
separately records the later current-host/SDK functional root-cleanup proof:
whole-root unmount observes actual provider `0/0` plus cache/DOM zero,
table-only unmount retains its intended source/inactive cache, and immediate
root remount leaves the new source active. Its fixture stderr observations are
correlated within the authenticated provider process lifetime, followed by
canonical down/unlink and sampler retirement. This is not a new latency run and
does not change or relabel the preserved historical baseline above.

## Kubernetes resource cost and native idle CPU

The [2026-10-29 investigation](../../docs/kubernetes-performance-investigation-2026-10-29.md)
records staged fixes, FreeLens source comparisons, SDK-v2 carry-forward requirements,
raw receipts, and unresolved native acceptance work.

```bash
# Actual runtime reducer, synthetic fixtures; no browser/native CPU claim.
node bench/app/resource-batch.mjs /tmp/resource-batch.json

# Explicit native PIDs; preserve cluster/build/route provenance separately.
node bench/app/native-idle.mjs \
  --pid host="$APP_PID" --pid webcontent="$WEB_PID" --pid graphics="$GPU_PID" \
  --seconds 60 --scenario dashboard-idle-run-1 --out /tmp/dashboard-idle.json
```

The reducer runner accepts an optional second positional argument naming an original
source snapshot for before/after comparison. It records the exact input source hash
before bundling. The native sampler uses cumulative process CPU time rather than
the rolling `%CPU` field, checks start identity in each CPU snapshot, and rejects
exited PIDs or processes younger than two seconds. This age guard avoids the
same-second ambiguity of `ps` start timestamps.
Neither tool selects or mutates a cluster. Do not use an uncontrolled sampler smoke
or a reducer speedup as evidence of lower native Graphics/WebContent CPU.
