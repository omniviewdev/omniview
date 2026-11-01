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
pnpm bench:app --headed                # watch it
node bench/app/report.mjs              # Markdown summary of results/latest.json again
```

Also `task perf:app -- <args>`. First run locally: `pnpm install --frozen-lockfile`,
`task packages` (providers → runtime → Vite plugin) and
`pnpm exec playwright install chromium`. The pinned Kubernetes submodule consumes
the published base-ui 0.8.0, editors 6.1.0, and runtime/Vite-plugin 0.9.0 cohort.
Older plugin archives built against MUI or legacy UI contracts are incompatible.

The Logs scenario selects a container from the opened Logs submenu, not from the
parent action list. Adding actions such as Debug must not change which workload
is measured; line counts, scrolling, drawer toggles, and run counts stay unchanged.

The Pod scenario opens the native page from a 5k-pod corpus, then scrolls up to
30 viewport steps within that page. Current V2 Kubernetes requests 256 records per native page. Fixtures
honor that bound and return real next cursors; they do not return the full corpus
as one page. Older full-list baseline timings are not comparable. The shared
browser bridge dispatches both named V2 calls and generated binding IDs.
Scroll workloads stop at the real positive scroll boundary, reject no-op steps and
unexpected end positions, and verify the reset. Reports expose actual forward steps
and total steps (including the reset); wall and busy per-step timings use that
actual total rather than the requested 30-step budget.

## Reproducible source cohort

CI reads the checked-out host's `e2e/source-cohort.json`, with full commit strings
for `plugin-sdk`, `ui`, and `kubernetes`. UI and Kubernetes checkouts use validated
cohort outputs; Kubernetes must match the host's `plugins/kubernetes` gitlink.
The SDK entry must equal the independently reviewed repository variable
`OMNIVIEW_RESOURCE_V2_REVIEWED_SDK_REVISION`. A branch cannot approve its own
SDK change. The original isolation ancestry minimum remains
`5b3ef764d1cf738835a723a749a0cb6c45f85e44`. The profiling release advances the
reviewed isolation checkpoint to SDK v0.11.0,
`eb0d5c8c533c6501c4a57da338435956f82d7b84`, after independent security review of
the five protected files. The delta only adds the opt-in profiler lifecycle to
`pkg/sdk/plugin.go`; state-root, profile-contract, and store protections remain
unchanged. Admission requires the baseline to precede that pinned checkpoint, the
checkpoint to precede the selected SDK, and all five selected protected files
to match the checkpoint byte-for-byte. Neither cohort approval, tags nor
environment variables can substitute another isolation checkpoint.
Review selected commits before updating the branch-owned cohort and
gitlink; checkout reachability is required, publication is not. This avoids global UI/Kubernetes ref changes when older `main` and an
upgraded PR need different compatible sources. The host input remains the exact
checked-out PR commit, or selected branch commit for manual dispatch.

The source builder reuses canonical workspace `Init`/`Create`/`Link`, native pnpm
12.14.0, the actual protocol-probe report, and the existing JavaScript build graph
and output-ownership producers in a disposable collection with its own private
home. Its manager uses the same session-aware `RequireStopped` guard as the real
workspace CLI; a private home is not a substitute for proving the workspace is
stopped before linking or retirement. Only the real Kubernetes UI dependency
closure is built: base-ui, ai-ui,
editors, providers, runtime, Vite plugin, then Kubernetes. The host's committed
Wails bindings are compiler inputs, just as for `task packages`; no native host,
plugin backend, SDK attestation or app service is substituted or launched.
Source manifests keep their declared versions. Canonical `workspace:*` overrides
select the reviewed sources, including an explicitly unpublished next-release
source cohort; no version is stamped by this helper and no future registry
package is fetched as a fallback. Managed local edges in standalone lockfiles
are seed inputs: their versions become actual source links in the generated
aggregate lock. A source runtime/Vite plugin 0.5.0 and Kubernetes `^0.5.0` can
therefore be profiled before npm publication, without rewriting the standalone
Kubernetes lock to claim a release exists. Refresh that consumer lock only after
the real npm release, before merging/tagging the production plugin. Registry
edges retain their lock evidence. Install scripts remain disabled and strict
peers are audited recursively.

Source install policies must agree explicitly. In particular, the reviewed host
and Kubernetes sources must both declare `allowBuilds.esbuild: true`, with
Kubernetes retaining `unrs-resolver: false`. The managed install still uses
`--ignore-scripts`; the builder does not rewrite policies, approve all scripts,
or relax peers. Kubernetes commit
`5df15b06b80790c3a8e9255d300f40795fde9bef` has the modern UI and output contracts,
but its explicit `esbuild: false` conflicts with the host and must not be used
unchanged for this composition. Published runtime 0.4.2 is not an alternative:
its base-ui peer range is `^0.2.1`, not the host source runtime's `~0.4.3`.

With installed/built host packages and the reviewed sources checked out:

Candidate CI uses `e2e/source-cohort.json` as its exact SDK/UI/Kubernetes
selection. `OMNIVIEW_RESOURCE_V2_REVIEWED_SDK_REVISION` must equal that SDK commit;
UI and Kubernetes refs come only from that cohort in candidate workflows, not
legacy repository UI/profile variables. The selected UI commit is
`cd50e0d0663c1d416ed48c147382a5040d6c3c7c`, with base-ui 0.9.0 and editor 6.1.1,
matching the current host dependency ranges. Do not change legacy repository
variables to approve candidate sources. Explicit direct-CLI `UI_SOURCE_REF` or
`KUBERNETES_SOURCE_REF` values must still match the selected cohort.
The Kubernetes gitlink must also match. Commits must be reachable by checkout,
but candidate testing does not require a module or npm publication.
The candidate workflows map this dedicated repository variable to their internal
`REVIEWED_SDK_REVISION` environment variable. They never fall back to
`OMNIVIEW_E2E_REVIEWED_SDK_REVISION`. Keep that legacy variable unchanged while
stable `main` still consumes the earlier SDK; candidate approval must not change
unrelated pre-merge CI. Configure the new variable only after independent review.
An absent repository-level legacy variable does not prove that no effective
organization-level variable exists.
The independent SDK isolation-core baseline remains
`5b3ef764d1cf738835a723a749a0cb6c45f85e44`; candidate approval does not
authorize protected isolation changes or replace review with release-tag trust.
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
  --host \"$PWD\" --host-ref \"$(git rev-parse HEAD)\" \
  --sdk "$SDK_SOURCE" --sdk-ref "$REVIEWED_SDK_COMMIT" \
  --ui /absolute/path/ui --ui-ref \"$REVIEWED_UI_COMMIT\" \
  --kubernetes /absolute/path/kubernetes --kubernetes-ref \"$REVIEWED_KUBERNETES_COMMIT\" \
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
- **Fake backend.** `page/fake-backend.ts` installs the `bench/render` transport and fixtures
  (bindings → handlers by name, `emit` for backend events), and adds what the full shell
  asks for at startup: the installed plugin list, a connection, watch state, log sessions.
  The page reads its setup from `window.__OV_BENCH__` (`{ plugins, pods }`), set by the
  runner before navigation, and exposes controls on `window.__ovBench`. Calls are answered
  in-page, so there is no IPC cost in the numbers.
- **Plugin.** The real Kubernetes UI `dist/assets` directory is served at
  `/_/plugins/kubernetes/assets/` by `vite preview`, where the app's SystemJS loader
  fetches it, exactly as from `~/.omniview/plugins` in the native app.
  `OV_K8S_PLUGIN_DIST=<assets-dir>` selects an explicitly built external bundle;
  `OV_K8S_PLUGIN_METADATA=<plugin.json>` selects its matching source metadata.
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
| `pods` | `open`: from the home page, open the native Pod page from a 5,000-pod corpus until a row shows. `scroll`: up to 30 viewport steps within the native page, then back to top, each waiting for a painted frame. |
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
one-shot fixture List cursor after a ready source watch. It is coordination,
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
The runner closes Chromium and explicitly stops its fixture source
watches/connections/cache; the owner must then `workspace down` and inspect
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
- The container diagnostic deliberately supplies the existing hook's
  `idAccessor`; default Resources still omits it and remains unsubscribed.
  Native engine-local ID collisions and legacy first-match cache behavior
  remain limitations. No old listener fix, atomic List/watch cutover or scope
  identity claim is made.
- Source watches, source rows copied, frontend subscription calls, host
  forwarding refcounts, persistent gRPC listener streams and future query
  leases are different quantities. Only available counters/observations are
  reported; unavailable query semantics/counts are not measured zero.
  Current `IsResourceWatchRunning` has no SDK gRPC RPC despite its generated
  host binding. Cleanup instead invokes the supported `StopResourceWatch`,
  waits on the actual provider's source-watch gauge over the real List path,
  then stops connections. It does not suppress the unavailable inspection
  surface or infer source cleanup from frontend unmount.
  Table-only `window.__p02.unmount()` intentionally retains sources and inactive
  queries for retention sampling. Toggling off the entire diagnostic or leaving
  its route instead drains pending connection/watch starts, stops every owned
  source and clears only its diagnostic caches. This root cleanup uses its own
  effect-local control, not the deleted global. Cleanup failures are reported
  and do not skip remaining connections or cache removal.
  The fixture also emits numeric `p02Lifecycle` stderr observations under its
  source mutex at client destruction and watch termination. Correlate new log
  records to the authenticated owned plugin process/generation and root-stop
  boundary to observe final connections/watch counts after the last client is
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
