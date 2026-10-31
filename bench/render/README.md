# Render benchmarks

Headless benchmarks of heavy screens, run in Chromium through Vitest browser mode.
They exist to put a number on each step of the MUI → `@omniviewdev/base-ui` migration.

```bash
pnpm bench:render                      # all benches (~2 min)
pnpm bench:render bench/render/log-viewer.bench.tsx
BENCH_QUICK=1 pnpm bench:render        # 3 iterations each, for checking a bench works
BENCH_REACT_DEV=1 pnpm bench:render    # React dev builds (readable errors; slow numbers)
BENCH_VERBOSE=1 pnpm bench:render      # keep app console output, log unhandled backend calls
node bench/render/report.mjs           # Markdown table from results/latest.json
```

First run locally: `pnpm exec playwright install chromium` and `task packages`.

Run the suite from the host checkout with its pinned Kubernetes submodule initialized.
The Kubernetes benchmark imports `plugins/kubernetes/ui/src` against the host's
shared packages; no installed marketplace plugin or cluster credentials are needed.
Production React and JSX are the default. Use `BENCH_REACT_DEV=1` only for debugging.

## How it works

- **No Wails backend.** `harness/backend.ts` installs a custom `@wailsio/runtime`
  transport. Generated `Call.ByID` bindings and handwritten `Call.ByName` clients
  share one service-method fixture namespace. Current host envelopes come from
  handlers such as `handle('resource/servicewrapper.Enumerate', fn)`. Unhandled
  calls resolve to `null`. Backend events are delivered with `emit(name, data)`, which
  goes through the real `Events.On` listeners. Screens therefore run their real data
  paths (react-query, `useResources`, log session streams).
- **Screens, not components.** Benches mount screens inside `harness/providers.tsx`
  (the provider stack from `ui/App.tsx`) and find things the way a user does: visible
  text, the scrollable area, a header label. Nothing depends on MUI or base-ui class
  names, so the same bench keeps running while a screen is migrated. When the app
  shell's providers change, update `AppProviders` to match `App.tsx`.
- **Production React.** React and the base-ui libraries run their production builds and the app's
  React Compiler setting is kept, so numbers resemble the shipped app.
- **Fixtures** (`fixtures/`) are deterministic: seeded pods with realistic specs/status and
  metrics, and log lines with JSON and ANSI-coloured content.
  Shared defaults explicitly answer `CheckConnection` with `CONNECTED` for the requested
  synthetic connection ID. Render and whole-app profiles exercise the real readiness
  guard; they do not bypass it or wait for watch synchronization to authorize reads.
  Kubernetes fixtures advertise `k8s:/pods`, return tagged V2 Values and host-owned
  record identities, and honor native page sizes and cursors. The current Pod screen
  requests 256 records per native page; 1k/5k labels describe source corpus sizes,
  not simultaneous mounted row counts. Older full-list baselines are not comparable.
  Historical result files remain unchanged.
  Log creation consumes the current encoded JSON request and preserves session options
  in the current session DTO. Drawer and whole-app fixtures retain live sessions until
  the real close call removes them; unknown session reads fail.
- The kubernetes Pod table is rendered from the `plugins/kubernetes` submodule source
  against the app's own `@omniviewdev/runtime` / `@omniviewdev/base-ui` (as plugins get them
  at runtime through the shared-deps import map). Run `git submodule update --init
  plugins/kubernetes` first. The bench uses whatever commit is checked out there.

## Reading the numbers

Each bench is one user-visible action, timed until its result is on screen:

| Bench | What one sample is |
|---|---|
| k8s pod table: mount until first row | Mount the native Pod page from the named corpus until the first row shows |
| k8s pod table: scroll up to 30 viewport steps within native page | Stop at the real native-page scroll boundary, then return to top; each positive step delivers the scroll event and forces layout |
| k8s pod table: sort by name | Click the Name header until the top row changes (cycles asc → desc → unsorted) |
| log viewer: mount + stream 10k lines | Mount, receive 100 backend batches of 100 lines, until the newest line is visible |
| log viewer: scroll 100k-line buffer | As the table scroll, on a full 100k-line buffer with follow off |
| bottom drawer: open logs tab | Mount the drawer, open a log session tab, stream 1k lines, until the last is visible |
| bottom drawer: drag-resize | 41 mousemoves, one per frame; ~683 ms at 60 Hz is the floor, anything above is overrun frames |
| app shell: mount App | Mount the real `<App />` until the welcome page shows (warm module-level caches) |

Pod scrolling rejects zero movement, unexpected end positions, and failed resets.
The available native-page scroll range bounds the workload; clamped no-op
assignments are not counted as viewport steps.


Compare runs on the same machine only. CI numbers (ubuntu-latest, shared runners)
are for spotting large regressions; look at the job summary or the
`render-bench-results` artifact.

Vitest's default reporter keeps benchmark tables in the console. Its JSON reporter
writes `results/latest.json`; `report.mjs` reads each test's `benchmarks` tasks and
their latency statistics in milliseconds. Failed tests and missing samples fail
the report command instead of producing successful empty reports.

## Adding a bench

Use `screenBench(name, fn, { setup, teardown, iterations })` from `harness/bench.ts`.
The helper registers an enclosing `test` and awaits its context `bench` fixture;
keep callers in files matched by `benchmark.include` (`*.bench.tsx` here).
Iteration, timing, and warmup budgets go to `.run()`. Setup and teardown use
per-benchmark `beforeAll` and `afterAll` hooks outside the measured workload.
Do expensive preparation in `setup` (it runs once before warmup and once before the
measured run), assert in `setup` that the interaction changes what is on screen, and
wait for visible results with `waitFor` from `harness/dom.ts`.
