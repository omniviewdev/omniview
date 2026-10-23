# Whole-app profile

The real production frontend, kubernetes plugin included, profiled in Playwright Chromium
with the Wails backend faked inside the page. Where `bench/render` measures single screens
mounted in isolation, this measures the app as a user drives it: startup, plugin loading,
routing, and the screens running inside the full shell.

```bash
pnpm bench:app                         # build, then 5 runs of every scenario (~3 min)
pnpm bench:app --runs 3 --only pods    # some scenarios
pnpm bench:app --no-build              # reuse bench/app/dist and the plugin bundle
pnpm bench:app --headed                # watch it
node bench/app/report.mjs              # Markdown summary of results/latest.json again
```

Also `task perf:app -- <args>`. First run locally: `pnpm install --frozen-lockfile`,
`task packages` (providers → runtime → Vite plugin) and
`pnpm exec playwright install chromium`. The plugin must use the current base-ui/
editors shared-dependency cohort; the historical bundled submodule is not a
compatible source for this host.

## Reproducible source cohort

CI requires `OMNIVIEW_APP_PROFILE_UI_REF` and
`OMNIVIEW_APP_PROFILE_KUBERNETES_REF` repository variables containing independently
reviewed, public full commits. It checks those sources out explicitly, rather
than changing the bundled submodule or waiting for an unpublished host npm release.
The host input is the exact checked-out PR commit.

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

```bash
A11_PROTOCOL_PROBE=1 A11_PROTOCOL_REPORT=/absolute/path/link-protocol.json \
  GOWORK=off GOFLAGS= go test -tags server ./internal/devworkspace \
  -run '^TestLinkPinnedProtocolProbe$' -count=1
GOWORK=off GOFLAGS= go run -tags server ./bench/app/build-plugin \
  --host \"$PWD\" --host-ref \"$(git rev-parse HEAD)\" \
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
| `pods` | `open`: from the home page, navigate to the Pod list of a 5,000-pod cluster until a row shows. `scroll`: 30 one-viewport steps down, then back to top, each waiting for a painted frame. |
| `logs` | `open`: Pod row menu → Logs, until the viewer shows. `stream`: 10,000 lines in batches of 100, one batch per task, until the line counter reaches 10,000. `scroll`: 30 pages of the log viewer. `drawer`: minimize/expand the bottom drawer 10 times. |

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
