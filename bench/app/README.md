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

Also `task perf:app -- <args>`. First run locally: `task packages`,
`git submodule update --init plugins/kubernetes` and `pnpm exec playwright install chromium`.

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
- **Plugin.** The kubernetes plugin's built UI bundle (`plugins/kubernetes/ui/dist`, built
  by the runner if missing, or `OV_K8S_PLUGIN_DIST=<dir>`) is served at
  `/_/plugins/kubernetes/assets/` by `vite preview`, where the app's SystemJS loader fetches
  it, exactly as from `~/.omniview/plugins` in the native app.
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
