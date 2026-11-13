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

Run the suite from the host checkout with an external Kubernetes checkout. CI
checks out the latest published GitHub release tag and saves its full commit in
the `render-bench-results` artifact as `kubernetes-commit.txt`. Locally, select
the compatible checkout and revision to measure, then install its dependencies:

```bash
export KUBERNETES_SOURCE=/absolute/path/omniview-plugin-kubernetes
git -C "$KUBERNETES_SOURCE" rev-parse HEAD
pnpm --dir "$KUBERNETES_SOURCE/ui" install --frozen-lockfile
```

The benchmark imports the selected checkout's UI source against the host's shared
packages. No installed marketplace plugin or cluster credentials are needed.
Without `KUBERNETES_SOURCE`, the default is `../omniview-plugin-kubernetes`
relative to the host. Production React and JSX are the default. Use
`BENCH_REACT_DEV=1` only for debugging.

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
  guard; they do not bypass it or wait for source synchronization to authorize reads.
  Kubernetes fixtures advertise `k8s:/pods`, return tagged V2 Values and host-owned
  record identities, and honor native page sizes and cursors. Source views emit
  ordered snapshots in chunks of at most 256 records, followed by snapshot status.
  The 1k/5k labels describe source corpus sizes, not simultaneous mounted row counts.
  Older full-list baselines are not comparable.
  Representations carry only format IDs and revisions. Schema fixtures use the exact
  `{ route, type, target }` request shared by `ResolveSchema`, `ResolveEditorSchema`,
  and the nested `GetSchemaFields` request. The synthetic Pod provider has no schema
  resolver: fields and editors report `UNSUPPORTED`, not known absence or an invented
  document. Unknown targets and unreferenced documents fail.
  Historical result files remain unchanged.
  Log creation consumes the current encoded JSON request and preserves its correlation
  ID and session options in the current session DTO. Drawer and whole-app fixtures
  retain live sessions until the real close call removes them; unknown session reads fail.
  `servePods` returns a controller. `applyChange` delivers a change batch to every complete
  live source view as one `changes` event with the view's real `viewGeneration` and the next
  `sequence` (`upserts`, and `removes` keyed by the host record key; a recreated Pod is a remove
  and an upsert under a new uid), and `views()` counts what each view delivered.
  `fixtures/updates.ts` drives a declared, seeded sparse-update workload through it.
  View IDs come from one counter for the whole page, so a later `servePods` host never issues an ID
  an earlier one did, as the real host never repeats its UUIDs. The runtime keeps a released source
  view open for a while, and a repeated ID would reach the view an earlier host left behind.
  The Pod benches fail unless the first row comes from a source view the mount opened on the current
  host, so a reused view cannot pass as a cold mount.
  `fixtures/metrics.ts` answers the current finite-metrics protocol (view source selection,
  catalog, open/attach/refresh/close observation and `metric/observation` events) as a healthy
  provider or as an absent metrics API. `fixtures/activity.ts` implements the whole Activity
  FrontendService protocol; an unhandled call resolves to `null`, which is neither a healthy nor
  an unavailable provider, so a fixture must answer each call a scenario makes.
- The Kubernetes Pod table is rendered from the selected external checkout against
  the app's own `@omniviewdev/runtime` / `@omniviewdev/base-ui` (as plugins get
  them at runtime through the shared-deps import map). Record the checkout commit
  when comparing results.

## Reading the numbers

Each bench is one user-visible action, timed until its result is on screen:

| Bench | What one sample is |
|---|---|
| k8s pod table: mount until first row | Mount the native Pod page from the named corpus until the first row shows |
| k8s pod table: scroll up to 30 viewport steps within native page | Stop at the real native-page scroll boundary, then return to top; each positive step delivers the scroll event, flushes the React commit, and forces layout |
| k8s pod table: sort by name | Click the Name header until the top row changes (cycles asc → desc → unsorted) |
| log viewer: mount + stream 10k lines | Mount, receive 100 backend batches of 100 lines, until the newest line is visible |
| log viewer: scroll 100k-line buffer | As the table scroll, on a full 100k-line buffer with follow off |
| bottom drawer: open logs tab | Mount the drawer, open a log session tab, stream 1k lines, until the last is visible |
| bottom drawer: drag-resize | 41 mousemoves, one per frame; ~683 ms at 60 Hz is the floor, anything above is overrun frames |
| app shell: mount App | Mount the real `<App />` until the welcome page shows (warm module-level caches) |

Pod scrolling rejects zero movement, unexpected end positions, and failed resets.
The available native-page scroll range bounds the workload; clamped no-op
assignments are not counted as viewport steps.

`scrollStep` wraps scroll delivery in React's `flushSync` before forcing layout.
Without that commit boundary, virtualized rows can remain at the previous offset,
and a timing sample can omit the rendering work it claims to measure. Compare
scroll timings only with runs that include this commit boundary.


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
