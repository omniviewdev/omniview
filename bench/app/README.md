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
`pnpm exec playwright install chromium`. Set `KUBERNETES_SOURCE` to an external
Kubernetes checkout at the revision being measured. Its UI manifest and lockfile
record standalone dependencies. Canonical candidate runs instead use the
workspace-selected SDK, UI, and runtime sources.
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

## Published plugin archive acceptance

Run the production frontend against an extracted release archive, without
rebuilding or linking the plugin:

```bash
node bench/app/archive-smoke.mjs --directory /absolute/path/extracted-plugin
```

The directory must contain `plugin.yaml` and `assets/` from the same archive.
Verify the archive's SHA-256 before extraction. Install the frozen host
dependencies, build providers → runtime → Vite plugin, and install the pinned
Playwright Chromium first, as above. The harness removes its temporary build and
closes its browser and HTTP server on success or failure.

This gate uses the production React renderer, host shared-module registry,
SystemJS loader, and published Kubernetes frontend bytes. It checks the homepage,
the empty-kubeconfig plugin route, and cluster-search interaction. Every shipped
System.register module, including lazy routes, has its named external imports
checked against the actual host namespaces. A missing export, route failure,
uncaught exception, or console error fails acceptance.

The Wails backend is a deterministic in-page fixture. This is not proof of native
WKWebView behavior, real Kubernetes/backend lifecycle, archive installation, or
every lazy screen's behavior. Keep the real application E2E suite as a separate
gate. Add workload-specific tests when changing resource views or connections.

`.github/workflows/plugin-archive-smoke.yml` runs on relevant host PRs and is a
mandatory dependency of both desktop publication and npm publication. Its default
input pins a published Kubernetes archive and checksum. Update that pin only
after the intended compatibility cohort is published and tested.

Plugin release workflows can call this reusable workflow with `host-ref` and
`archive-artifact` (an artifact from the same workflow run containing
`kubernetes-linux_amd64.tar.gz`). This tests the candidate bytes before marketplace
publication, rather than testing an already published version or rebuilding from
linked source. Merge the host workflow before merging a plugin caller.

### Upgrade-state regression

Plugin bundles use stable chunk names such as `entry2.js`. Clearing only the
SystemJS entry leaves child modules alive; loading new code can then read old
minified exports and fail with an undefined function. `clearPlugin.test.ts`
executes two real SystemJS generations with changed child exports and checks that
another plugin's registry entries survive retirement.

The asset handler also sends `Cache-Control: no-store` for every plugin asset,
not only `entry.js`. `plugin_asset_handler_test.go` checks updated bytes and cache
policy for entry modules, child chunks, lazy chunks, and stylesheets.

These are confirmed invalidation defects, not proof of the exact reported
`Is()/ls` incident. Deleting `~/.omniview` fixed that incident but removed the
failing profile. Do not recommend deleting a profile as routine recovery: retain
a private copy first, record the host/plugin versions and stack, and compare
installed asset hashes with the release archive. Do not upload kubeconfigs,
credentials, or the full profile.

## Reproducible application sources

CI resolves the SDK commit from the host's declared `go.mod` dependency and
checks out that commit for the managed workspace. UI packages come from the host
lockfile; CI checks out the latest published Kubernetes GitHub release tag and
passes its full checked-out commit to the builder. The host input remains the
exact checked-out PR commit, or the selected branch commit for manual dispatch.
Managed workspaces record the SDK checkout's commit and source digest.

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

With installed/built host packages, select a compatible Kubernetes source checkout
and the SDK commit resolved by the host module. The builder uses the selected
Kubernetes checkout's committed HEAD; it does not include uncommitted changes:

```bash
export KUBERNETES_SOURCE=/absolute/path/omniview-plugin-kubernetes
KUBERNETES_COMMIT="$(git -C "$KUBERNETES_SOURCE" rev-parse HEAD)"
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
  --kubernetes "$KUBERNETES_SOURCE" --kubernetes-ref "$KUBERNETES_COMMIT" \
  --link-evidence /absolute/path/link-protocol.json -- --runs 3
```

The builder uses committed source refs, not uncommitted checkout edits. It keeps
the private collection alive while the original host runs `pnpm bench:app`,
passing the actual Kubernetes `dist/assets` and matching `plugin.json` through
`OV_K8S_PLUGIN_DIST` and `OV_K8S_PLUGIN_METADATA`. On exit it unlinks, restores
owned outputs, and retires its worktrees and branches. Ownership conflicts retain
the collection and report its path instead of deleting uncertain files.

## How it works

- **Build.** `vite.config.ts` here loads the selected host checkout's own `vite.config.ts` (its
  `--app-root`, default this checkout) and adds only instrumentation: `ui/main.tsx` is rewritten
  at build time to import `page/fake-backend.ts` first, and an inline script at the top of
  `index.html` reads the page config. The app's source and build settings are not changed;
  in particular the minifier is whatever the app config says. `--react profiling` (the default
  of the legacy scenarios) also resolves `react-dom/client` to `react-dom/profiling` and wraps
  the root in `page/profiler.tsx`, so `<Profiler>` works in production React. That is an
  attribution build: React render, commit and slowest-commit columns include profiling
  overhead, and React's profiling renderer adds its own logging, so its timings are never
  comparable with a normal build's. `--react normal` keeps the app's production React and adds
  no `<Profiler>`. Archive smoke (`OV_PLUGIN_ARCHIVE_SMOKE=1`) is a separate acceptance gate,
  not a way to select a build: `run.mjs` refuses to start with it set.
- **Fake backend.** `page/fake-backend.ts` installs the `bench/render` transport and fixtures
  (bindings → handlers by name, `emit` for backend events), and adds what the full shell
  asks for at startup: the installed plugin list, a connection, source state, log sessions.
  The page reads its setup from `window.__OV_BENCH__` (`{ plugins, pods, metrics, instance, … }`),
  set by the runner before navigation, or from the `ovbench` query parameter in a page opened
  without a runner, and exposes controls on `window.__ovBench`. Calls are answered
  in-page, so there is no IPC cost in the numbers.
- **Plugin.** The real Kubernetes UI `dist/assets` directory is served at
  `/_/plugins/kubernetes/assets/` by `vite preview`, where the app's SystemJS loader
  fetches it, exactly as from `~/.omniview/plugins` in the native app.
  `OV_K8S_PLUGIN_DIST=<assets-dir>` selects an explicitly built external bundle;
  `OV_K8S_PLUGIN_METADATA=<plugin.json>` selects its matching source metadata. Relative
  override paths resolve from the host root, as in `vite.config.ts` (both use
  `plugin-bundle.mjs`), not from the working directory.
  Empty overrides and missing, empty or non-file `entry.js` entries fail before
  profiling. Without an override, the runner builds the external checkout's UI if
  missing. It defaults to `../omniview-plugin-kubernetes` relative to the host.
  The checkout must independently satisfy the host's current consumer contract.
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
- **Frontend.** `meta.frontend` identifies every file in the served `dist` by a tree SHA-256
  (the build manifest `.ov-bench-build.json` is excluded: it describes the tree). It records
  the React variant (`reactBuild`, `reactDom`), the minifier Vite resolved
  (`minify.effective`) and whether it was the app's own setting or forced, and the state of the
  build manifest. A build made by this runner carries a manifest; with `--no-build` the React
  variant, minifier and build provenance are taken from it only while it verifies against the
  bytes present. Without a verified manifest they are `unknown`: the runner identifies the
  reused bytes, not how an earlier process produced them.
- **Host and plugin source.** `commit`, `dirty` and `hostSource` identify the host checkout
  by its full HEAD, tracked dirty state, and a SHA-256 of
  `git diff --binary --no-ext-diff --no-textconv HEAD`. Other runners can use
  different diff flags, so their tracked-diff hashes are not necessarily interchangeable.
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
node --test bench/app/plugin-bundle.test.mjs bench/app/report.test.mjs bench/app/report-scroll.test.mjs \
  bench/app/stats.test.mjs bench/app/wheel-driver.test.mjs bench/app/options.test.mjs bench/app/provenance.test.mjs
```

## Scroll and metric baselines (#460)

The scroll scenarios measure Pods-table scrolling with the real production frontend, the real
Kubernetes plugin bundle and a fixture backend in the page. They have their own workload ids,
protocol, build selection and report, separate from the legacy scenarios above. Everything they
record is **renderer-only fixture evidence**: no IPC, no native Omniview backend, no host or
plugin process. A Chromium result is not WKWebView, and a requestAnimationFrame interval is not
compositor output.

### Baseline and candidate builds

The harness lives in one checkout (the candidate) and builds any host checkout selected by
`--app-root`, so the same harness bytes measure both. Nothing is written into the selected
checkout: the build goes to `--dist`, its `vite.config.ts` is read with Vite's runner loader (no
`.vite-temp`), and the optimizer cache is redirected next to `dist`. The selected checkout needs
its dependencies installed and the Kubernetes UI built; the harness installs nothing.

```sh
# Baseline: its frontend sources, UI packages and plugin bundle, built by the candidate's harness.
node bench/app/run.mjs --build-only --react normal --label baseline \
  --app-root /abs/baseline/omniview \
  --plugin-assets /abs/baseline/kubernetes/ui/dist/assets \
  --plugin-metadata /abs/baseline/kubernetes/plugin.json \
  --dist .local/bench-app/builds/baseline-normal/dist

# Candidate: the harness checkout itself.
node bench/app/run.mjs --build-only --react normal --label candidate \
  --plugin-assets /abs/candidate/kubernetes/ui/dist/assets \
  --plugin-metadata /abs/candidate/kubernetes/plugin.json \
  --dist .local/bench-app/builds/candidate-normal/dist
```

`--react normal` builds the app's own production configuration: its React is the production
build and no `<Profiler>` exists, and the minifier is whatever `vite.config.ts` says (today
`minify: false`, an unminified bundle of about 22 MB; the report prints the resolved value).
`--react profiling` is the attribution build described above. `--minify on|off` forces the
minifier for an intentionally different build; it is recorded as forced, and `report.mjs
--compare` refuses to pair it with an app-configured build.

Each build writes `.ov-bench-build.json` beside its bytes: the React variant, the minifier Vite
actually resolved, mode, the host's git state and tracked-diff hash, the harness tree hash and,
for `@omniviewdev/base-ui`, `ai-ui`, `editors`, `providers` and `runtime`, the resolved real
path, version, the git identity of a linked checkout and the tree hash of the `dist` the app
consumed. A declared range such as `~0.17.1` proves none of this: whether a source-linked build
or a published package was bundled shows in `source` (`linked-checkout`, `package-store`,
`host-workspace`) and the hashes. A reused build is trusted only as far as its manifest
verifies against the bytes present, and a scroll scenario refuses one that does not.

### Running

```sh
node bench/app/run.mjs --no-build --dist .local/bench-app/builds/baseline-normal/dist --label baseline \
  --only scroll --metrics healthy,unavailable,hidden --cpu-throttle 1,4 \
  --plugin-assets /abs/baseline/kubernetes/ui/dist/assets --plugin-metadata /abs/baseline/kubernetes/plugin.json
node bench/app/run.mjs --no-build --dist .local/bench-app/builds/candidate-normal/dist --label candidate \
  --only scroll --metrics healthy,unavailable,hidden --cpu-throttle 1,4 \
  --plugin-assets /abs/candidate/kubernetes/ui/dist/assets --plugin-metadata /abs/candidate/kubernetes/plugin.json
node bench/app/report.mjs --compare .local/bench-app/results/<baseline>.json .local/bench-app/results/<candidate>.json
```

Run baseline and candidate serially, on the same machine, with nothing else competing for CPU.
Results and a Markdown report go to `.local/bench-app/results/` (ignored by git); `--out` and
`--markdown` override. Add `--smoke` for a quick check that a cell works (2 s warmup, one 3 s
trial); it is reported as a deviation from the reference protocol. A browser and the preview
server are closed on success, failure and SIGINT/SIGTERM.

| Option | Meaning |
|---|---|
| `--only scroll` | `pods-paced`, `pods-reversal`, `pods-jump` (or name them); the legacy scenarios stay the default |
| `--react normal\|profiling` | Required for scroll scenarios (a reused build supplies it from its manifest) |
| `--app-root`, `--dist`, `--no-build`, `--build-only`, `--label` | Which checkout is built, where, whether to reuse it |
| `--plugin-assets`, `--plugin-metadata` | The Kubernetes UI `dist/assets` and `plugin.json` served and recorded (same as the `OV_K8S_PLUGIN_*` variables) |
| `--metrics hidden,unavailable,healthy` | Metric state of the Pod table (see Fixtures); one cell each |
| `--updates none,sparse`, `--update-rate`, `--update-batch`, `--update-recreate-every`, `--update-seed`, `--metric-refresh-ms`, `--metric-changed-fraction` | The declared sparse-update workload |
| `--cpu-throttle 1,4` | CDP CPU throttling per cell (the legacy scenarios take one value) |
| `--warmup-seconds 30 --trial-seconds 20 --trials 3` | The reference protocol (also the defaults) |
| `--speed 1200 --input-hz 60 --reversal-segment-seconds 2 --jump-pages 30` | Declared input |
| `--pods 5000` | Pods served |
| `--capture full\|frames\|off`, `--mutations`, `--no-raw`, `--overhead-control` | Sampler scope, row/node mutation counting (default on only for profiling), raw series in the JSON, and one light-capture plus one no-capture control trial |
| `--serve-only`, `--port` | Build if needed and serve for a native WebView (below) |

### Workloads

A cell is (scenario, metric state, update workload, CPU throttle), keyed
`pods-paced[metrics=healthy,updates=none,cpu=4x]`. Its workload id and declared parameters are
recorded, and the compare report pairs only equal ones.

| Id | Driver | What it is |
|---|---|---|
| `pods-paced/v1` | Node→CDP wheel | Constant downward velocity (default 1,200 px/s) as wheel events at a declared cadence (default 60/s) for the trial length |
| `pods-reversal/v1` | Node→CDP wheel | The same input with the direction reversed every segment (default 2 s), oscillating between two offsets that keep a margin from both scroll boundaries |
| `pods-jump/v1` | in-page settling driver | The existing viewport-jump workload (the scroll step of `whole-app/v1`): up to 30 viewport-sized jumps, each waiting for a painted frame, then a reset. It does not measure continuous input; its duration is the workload's, not `--trial-seconds` |

Wheel input is never driven from the page. A rAF- or timer-driven `scrollTop` loop inside the
page slows down exactly when JavaScript stalls and hides the lag it should expose. The driver
(`wheel-driver.mjs`) sends `Input.dispatchMouseEvent` events from Node on an absolute schedule,
never waits for an acknowledgement before the next, and records for each event when it was due,
when it was sent and when the browser acknowledged it. It does no layout and no `flushSync`, and
it rests a pointer over the table first, as a user's is. Before the warmup it sends a short known
burst and compares it with what the page saw and the table did; a delta scale other than 1 is
applied and recorded, and input that does not scroll at all is an error.

Per cell: page load to the first row and a table whose height implies the served Pods, a check
that the metric state is what the cell declares (hidden columns must open no observation; healthy
and unavailable must complete one, else the cell fails), an idle refresh-rate probe, the
calibration, the warmup (the same workload, unmeasured), then the trials with a one-second
quiesce between them.

### What is recorded per trial

Two windows. The **input window** runs from the first wheel event the driver sent to the last
(the declared duration; the jump driver's own run): frame intervals, coverage and scroll lag are
computed over it. The **capture window** runs from `capture.start` to `capture.stop`, the input
window plus the time the table needs to settle: CDP counters, long tasks and React totals cover it.

| Signal | Source and meaning |
|---|---|
| Frame intervals | Deltas of requestAnimationFrame timestamps, with p50/p90/p95/p99/max by nearest rank (a real frame, never interpolated), counts above 20, 33.4, 50 and 100 ms, an estimate of missed refresh slots against the measured idle cadence, and the largest gaps with their time |
| Coverage | Per frame, the fraction of the visible body (below the sticky header) covered by mounted rows, how far mounted rows extend beyond each viewport edge in px (negative is an uncovered strip), and the mounted-row count. Holes are samples below 0.999; samples at a scroll boundary are counted, not scored |
| Input delivery | Requested px; what the page's wheel listener saw (events, px, delay between the event's own timestamp and its handler); scroll position at input end and after settling; residual and delivered fraction; path length |
| Scroll lag | Distance between where the declared input says the viewport should be (a step function of the planned schedule) and the sampled scroll position, on epoch clocks (`performance.timeOrigin + now` on both sides), in px and in ms at the declared speed |
| Main thread | CDP `Performance.getMetrics` deltas: task, script, layout and style durations, thread time, layout and style-recalc counts, node objects (`cdpNodes`: attached **and detached**, not yet collected: churn, not retained DOM), listeners, heap. Long tasks and long animation frames where the engine has them |
| DOM | Attached elements in the document (start, end, max), separate from `cdpNodes` |
| React (profiling build) | Commits split mount/update with their durations, base duration, slowest commit, a bounded list of slow commits |
| Mutations (`--mutations`) | Top-level rows and nodes added and removed, attribute changes: mount churn without React |
| Bridge, demand, updates | Backend calls by name; metric observation opens, attaches, refreshes, closes, targets requested; the update ledger (events, upserts, removes, recreated) |
| Errors | Page errors, console errors, failed requests and HTTP ≥ 400 per trial and at load, visible alerts and status messages at ready, backend calls answered with no fixture |

A signal the engine does not supply is `null`, shown as a dash in the report: never zero.

### Fixtures

The fixtures speak the current host protocols; a handler that returned `null` would be neither a
healthy nor an unavailable provider.

- **Source views** (`bench/render/fixtures/kubernetes.ts`): snapshots in 256-record batches, then
  `changes` events with the view's real `viewGeneration` and the next `sequence`, `upserts` and
  `removes` keyed by the host record key. A recreated Pod is a remove of the old incarnation's key
  and an upsert under a new uid.
- **Sparse updates** (`fixtures/updates.ts`): `--updates sparse` emits a declared number of
  `changes` events per second, each touching a declared number of Pods drawn uniformly from the
  whole corpus by a seeded generator (restart count, phase flip, and every Nth touch a
  delete-and-recreate), and refreshes metric samples on a declared period for a declared fraction
  of targets. The runner asserts nothing about row selection or sort/filter semantics; those are
  for focused tests. It records the update ledger and the fixture's corpus size and per-view
  sequence counters, nothing about what the table showed afterwards.
- **Metrics** (`fixtures/metrics.ts`): `GetMetricViewSourceSelection` (the host's default
  `inherit`), `GetResourceMetricsCatalog` (the native catalog: CPU in cores, memory in bytes),
  `OpenMetricsObservation` → `AttachMetricsObservation` → `metric/observation` events with the
  generation/sequence fence, a progress frame and a data frame, refresh on the observation's own
  interval, `CloseMetricsObservation`. `healthy` answers `ok` with values and source times.
  `unavailable` answers what the Kubernetes native provider answers when the metrics API is
  absent: every pair `failed` with its message, `complete: false`, the scan failure as a
  warning; the catalog and columns are present and the cells show a gap. `hidden` serves the
  healthy provider and seeds the plugin's persisted column visibility (the choice a user makes
  by hiding the columns), so no metric column exists and no observation may open.
- **Activity** (`fixtures/activity.ts`): the whole Activity FrontendService protocol with
  revisions and `activity/change/<id>` events. The former stubs left every producer call
  unhandled, so the first notification crashed the store and surfaced an "Activity observation"
  error toast.
- **Instance identity**: with `instance: "production"` in the page config the build's bootstrap
  script embeds the boot identity a native host embeds, and `GetInstanceInfo` answers the matching
  descriptor, so the shell shows no "Instance unavailable" chip. Without it (the legacy
  scenarios, archive smoke) the page is a plain preview, as before.

### Native WebView use

The sampler and controls are page code, not CDP, so a WKWebView driven by hand reads the same
numbers. Serve the built frontend and open the printed URL:

```sh
node bench/app/run.mjs --serve-only --no-build --dist <dist> \
  --plugin-assets <assets> --plugin-metadata <plugin.json> --port 9400
# http://127.0.0.1:9400/?ovbench={"plugins":["kubernetes"],"pods":5000,"metrics":"healthy","instance":"production"}#/_plugin/kubernetes/cluster/bench/resources/k8s%3A%2Fpods
```

In the page, `window.__ovBench.help()` lists the API. A typical session:
`await scroll.prepare({ expectedRows: 5000 })` (returns `wheelPoint`), `await capture.probeRefresh()`,
`capture.start({ raw: false })`, scroll with a trusted native pointer over `wheelPoint`,
`await scroll.waitSettled()`, `capture.stop()`, `fixture.stats()`. Unsupported signals (long
tasks, long animation frames, JS heap, CDP-only counters) are reported as unsupported or null. The
WKWebView is the actual frontend with the fixture backend: it is not the native Omniview backend or
IPC, and it is not an M1-class native acceptance run.

### Limits

- requestAnimationFrame callbacks and DOM geometry are not compositor output or pixels. Coverage
  compares mounted rows with the scroll offset the main thread sees, which can lag the
  compositor's; the margins beyond the viewport edges bound the lead that is absorbed. Keep native
  pixel evidence separate.
- The sampler reads geometry in the frame callback. That can run style and layout earlier than the
  frame would and costs something. `--overhead-control` adds one `frames` trial and one `off`
  trial, then reports per-second CDP differences. Each control is a single sample.
  The `off` control cannot measure frame intervals; `frames` cannot measure viewport coverage or input lag.
- Headless Chromium paces frames at a virtual 60 Hz; the measured idle cadence is recorded, and a
  display that is not about 60 Hz is flagged because 120 Hz runs are kept separate.
- Wheel events can be coalesced by the browser before the page sees them; `page saw` records
  what arrived. CDP CPU throttling slows the renderer's main thread only.
- Three trials do not support a significance claim; the compare report's verdict uses a fixed 2%
  band. The nominal-scroll targets printed for paced cells are informational, not a gate.
- The fixture is in-page: no IPC cost, no host or plugin process, no network. Metric and update
  rates are declared fixture rates, not measured cluster rates.
- Heap, retained DOM growth over repeated open/scroll/close cycles, renderer/host/plugin memory
  and native pixels are not measured here.

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

## Capture modes, the page and runner contract, and the generic table surface

`--capture` selects how much the page samples during a trial:

| Mode | Flag | What the page samples | Null by design |
|---|---|---|---|
| full (default) | `--capture full` | frame intervals from one `requestAnimationFrame` loop; per-frame viewport coverage, scroll offset and mounted rows (every `--coverage-every` frames, default 1); wheel and scroll accounting; long tasks; long animation frames; an all-DOM element count at most once a second | nothing the engine supports |
| light | `--capture frames` | frame intervals and long tasks | coverage, scroll position at input end, lag, wheel accounting |
| none | `--capture off` | nothing; Node still records its own timing and CDP counters | every page signal |

To price the capture, run the measured trials at `full` with `--overhead-control`. After the measured trials of each cell the runner adds one control trial at `frames` and one at `off`, and reports the per-second CDP difference in task, script, style and layout time (full − frames is the geometry reads, frames − off is the frame loop). Each control is a single sample, so treat a small difference as noise:

```
node bench/app/run.mjs --no-build --dist <dist> --label <x> --only pods-paced --metrics healthy --cpu-throttle 4 --overhead-control --plugin-assets … --plugin-metadata …
```

Never compare timings across capture modes, and never compare a `--capture off` or `frames` run with a `full` one for the signals the lighter mode does not have.

### Page and runner contract

The sampler is bundled into the app build, so a build and a runner from different harness revisions can disagree. Three guards fail loudly instead of reporting required fields as null:

- A reused build whose manifest names a different harness revision than the runner is refused for scroll scenarios. Rebuild with `--build-only`, or pass `--allow-harness-drift` for a diagnostic run that must not be compared. The recorded `meta.harness.builtWith` is the revision that built the page.
- Before a cell measures anything, the page's `capture.capabilities().schema` must equal `CAPTURE_SCHEMA` in `capture-contract.mjs` (bump it whenever the page's result shape or option handling changes).
- Every trial is checked against its mode. A full capture must have coverage samples, the scroll position at the end of input, input accounting and, for wheel workloads, lag; the trial fails with the reason otherwise.

The page also ignores options passed as `undefined`, so a runner that has no value for an option gets the default.

### Generic host table surface (`--surface generic`)

`--surface plugin` (default) measures the Kubernetes plugin's own Pod table. `--surface generic` measures the host's generic resource table over the same 5000 Pods: the route `#/resources/kubernetes/bench?type=k8s%3A%2Fpods` is the host's `ResourceBrowser`, which mounts `components/tables/Resources` (`EnumerableResourceTable` → `ResourceTableContainer`) for any type that advertises `enumerate`. The fixture serves the same Pod source view and a resource definition with six columns (Name, Namespace, Status, Node, Pod IP, Created). The Pods have no exec handler, so there is no row-action column, and there are no metric columns, so `--metrics` does not apply and cells are keyed `generic:<scenario>[metrics=none,…]`. The sampler, workloads and input are unchanged (the table container and rows carry the same `data-ov-table-container` and `tbody > tr[data-index]` hooks). Generic and plugin cells never pair in a comparison. For a native WebView, load the same hash route with `?ovbench=`.

## Local renderer sprint (#459)

This pass uses CLI-managed candidate and frozen-baseline workspaces, the same
`58011ba2993e` harness, normal production React, 5,000 fixture Pods and independent
60 Hz wheel input. Baseline commits: host `605ee4ea171570ac39d7882a4baa636e92bd3ecf`,
UI `05ea0050b6dd3ede23cbfa638a624df8fe20b8e2`, Kubernetes
`c082860e746a413f04294c4d4772d8deffe38b9d`.
These are renderer measurements with an in-page backend, not native IPC or
real-cluster measurements. No CI or release workflow changes belong to this pass.

Early matched runs used 30 seconds of warmup and three 20-second trials:

| Workload | Baseline | Initial candidate | Meaning |
|---|---:|---:|---|
| Healthy metrics, 4× CPU, sparse immutable updates: median frame p95 | 1,199.9 ms | 250 ms | Combined early fixes; still unacceptable |
| Healthy metrics, 4× CPU, no updates: median frame p95 | 116.6 ms | 150.1 ms | No established scrolling improvement |
| Generic table mounted rows, short functional smoke | 5,000 | 36 resting / 48 peak | Bounded DOM, not a frame-time comparison |

The initial candidate is not the final implementation. Later profiles identified
repeated alphanumeric sorting as a major sparse-update cost. A deterministic
5,000-record probe applied 50 immutable two-row updates, including deletion and
recreation. It compared exact sorted IDs and current record objects after every
update. Upstream sorting made 2,747,070 comparisons; adaptive input ordering made
250,068. Fifty no-op renders added no comparisons. This proves reduced comparison
work, not a corresponding frame-time speedup. The temporary probe was removed;
behavioral sorting regressions remain in the shared UI suite.

Later wall-time runs are not acceptance evidence: host load reached 73 on
18 cores, independent input delivery stalled, and the unchanged control build
also slowed. Do not attribute those results to candidate code. Repeat matched
normal/throttled, metric-state and live-update runs on a quiet local host before
claiming a frame budget. CPU throttling does not certify M1 Pro performance.

Functional browser checks exercised generic-table selection, sorting, search,
column hide/show and source-view teardown. DOM coverage does not prove compositor
pixels are never blank. Native WKWebView, real backend behavior and final
frame-time acceptance remain separate gates. Raw profiles stay local; this pass
does not upload cluster data or add Grafana diagnostics.

The final linked functional build mounted 56 resting rows and at most 92 rows
across distant positions in the 5,000-Pod collection. At each settled stop,
unavailable metrics had zero busy cells and zero pulsing skeletons, with no
resource-error notices. Keyboard focus exposed the full healthy metric value
and reference text. Closing the connection tab left no source views and no
active metric observations.

A later serial baseline/candidate reference rerun still failed the frame budget
and input-delivery gate: driver lateness p95 exceeded one second in every
candidate trial. Keep those raw receipts as failed diagnostics, not accepted
performance evidence. Do not merge on the strength of comparison counts alone.
