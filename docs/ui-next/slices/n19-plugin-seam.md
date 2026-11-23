# N19: the plugin seam (step N19a: design and the thinnest proof)

Written 2026-11-17 against host `origin/main` 42d9f218 and the plugin repositories at the commits row N17 pinned (Kubernetes 524d123, AWS 6dd36bf, Containers 882ff04, Proxmox 31393a5, Flux 0e7ded1). Tracker row N19, decision A13 (Kubernetes stays a plugin), R1 (a channel, not a two-bundle archive), R11 (curated surface, skeleton manifest, dynamic contributions stay code).

**Amended 2026-11-17 (step N19b, owner decision A16 in `decisions.md`).** A plugin keeps its new UI in its existing `ui/` project with no double pathway: no `OMNIVIEW_UI` switch and no sibling directory in the plugin repository. On the plugin's `feature/ui-next` branch the `ui/` project simply becomes the new UI (the old UI code is deleted on that branch); the plugin's `main` keeps the old UI until the flip. This replaces the first decision L3 (a flavour switch in one `ui/`) and risk 5.1 (D1 versus D2). Sections 0, 1.5, 3, 4 and 5 are re-derived below and say where they changed.

**Evidence key.** `[path:line]` = read in this repo (`K8S`, `AWS`, `CON`, `PRX`, `FLX` prefixes: the plugin repository at its pin, `ui/` is its UI project). The citations of 1.4 and 1.5 for the Go dev tooling (`internal/devworkspace/**`, `gowatch.go`, `supervisor.go`, `build_reuse.go`, the Go tests) were read by a read-only scout; `vite.go:116,154-181`, `installer.go:682-697` and `plugin_asset_handler.go` I read myself. `[ran: …]` = I ran it, command in 1.6. `[INFERENCE]` = reasoning, not run. **Not run** says so. Sizes are my scale: S under 1 day of agent work, M 1 to 3 days.

## 0. The decisions

| # | Question | Decision |
|---|---|---|
| L1 | Reuse the old loader and shared list? | Reuse the **mechanism** (SystemJS, `System.register` bundles, the `shared://` registry, the Go asset handler, clear-by-prefix, the import timeout and the bounded pool), in a **new minimal loader** in `ui-next/plugins/`, with a **new shared list of six names** (five at N19a; N19b-1 added the runtime's curated entry). Not the old `PluginService`, not the old 34 names. |
| L2 | Name and place of the new-UI bundle? | The same as today: `assets/entry.js`, one bundle per archive (R1). The `feature-ui-next` stream archive holds the new bundle; the stable stream holds the old one. A mismatch fails by name in both directions (1.4). New builds use content-hashed chunk names. |
| L3 | Plugin layout and dev mode | **A16 (owner, 2026-11-17), replacing the first L3.** One `ui/` project per plugin and no double pathway: no `OMNIVIEW_UI` in the plugin and no sibling directory. On the plugin's `feature/ui-next` branch `ui/` is the new UI and the old UI code is deleted there; `main` keeps the old UI until the flip. `OMNIVIEW_UI` stays the host's own variable. The dev server serves `src/entry.ts` as today, and its modules take the host's instances from `window.__OMNIVIEW_SHARED__`. **Designed, not run.** |
| C1 | Contribution contract | `contributionV1`: sidebar skeleton plus a hook for per-connection entries, pages as `ListPageDefinition` plus one data hook each, a `home` page that names the route the window opens with no URL. Types in `ui-next/plugins/contract/v1.ts`; admission in `admit.ts`. |
| C2 | What a plugin may import | `react`, `react/jsx-runtime`, `react/compiler-runtime`, `@omniviewdev/kit`, and the **curated** `@omniviewdev/runtime/ui/v1` (N19b-1, built). Nothing else; the loader refuses a bundle that imports anything else, before it runs. |
| C3 | Errors | Each contribution has its own boundary (the sidebar, each page). A load failure is one of five kinds, drawn as the kit's collection state under the plugin's name; the plugin's own words never reach the page. |
| W | Where the code goes | `ui-next/k8s/**` and `ui-next/pods/**` move into the plugin as `ui/src/pods/**` on its `feature/ui-next` branch (moved, imports unchanged except the runtime entry name). The host keeps `page/`, `shell/`, `plugins/`. Section 3. |
| P | Sequence | Nine steps, five in the host, four in the plugin, three need the owner. Section 4. |

**The proof ran.** The real Go host, built from `OMNIVIEW_UI=next` in server mode, loaded four plugin bundles built outside the host's tree, in WebKit and Chromium: a 2,726 byte bundle imports four shared names, contributes a sidebar entry and a page with no route, and its `useTheme()` reads the host's provider (one kit), where the same plugin with its own copy of the kit fails that read and the check sees it; a page that throws is contained; a bundle of the old shell is refused before it runs; a plugin with no bundle is a named state. 1.6 says how and what it did not prove.

## 1. Loading

### 1.1 What exists

| Piece | Where | What it does |
|---|---|---|
| Plugin bundle | each plugin's `ui/vite.config.ts` | `format: 'system'`, `entryFileNames: "assets/entry.js"`, `chunkFileNames: "assets/[name].js"` (unhashed), `assetFileNames: "assets/[name].[ext]"`, `omniviewExternals()`: K8S `ui/vite.config.ts:42-45`, AWS `:39-42`, CON `:32-35`, PRX `:27-30`, FLX `:27-30` [read]. K8S and PRX/FLX fold CSS into the entry (`ui/vite/omniview.ts`); the others have no such plugin. All five emit one entry; K8S, AWS, CON, PRX and FLX export `plugin` (a `PluginWindow`) and some `extensionRegistrations` [K8S `ui/src/entry.ts:417,475`; AWS `:240`; CON `:26,31`; PRX `:41,63`; FLX `:15,21`] |
| Externals | `packages/omniviewdev-vite-plugin/src/index.ts:86-266`, `sharedPackages.ts:12-60` | 34 names (React, router, Monaco, Tanstack, the runtime's four entries, base-ui, ai-ui, editors, dnd-kit, date-fns, yaml). Build: Rollup externals. Dev: `resolveId` returns a shim that re-exports `window.__OMNIVIEW_SHARED__[name]` (`shims/*.mjs`, generated) |
| Shared list in the host | `ui/features/plugins/api/shared_dependencies.ts:6-70`, `preloader.ts:5-9`, `utils.ts:4-47` | The same 34 names as lazy `() => import(…)`; each is registered as a named `shared://<name>` SystemJS module whose `execute` awaits the import on first use, plus an import map. `check-shim-exports.ts:56-76` keeps the list equal to `SHARED_PACKAGES` |
| Import | `adapters/importPlugin.ts:84-97` | `systemJs.import('<origin>/_/plugins/<id>/assets/entry.js')`; dev: native ESM import of `http://127.0.0.1:<port>/src/entry.ts` after `window.__OMNIVIEW_SHARED__` is filled and the React refresh preamble installed (`:27-81`) |
| Clear | `adapters/clearPlugin.ts:22-29` | deletes every SystemJS module under `/_/plugins/<id>/` |
| Go side | `plugin_asset_handler.go:34-36,74-130`, `main.go:726-727` | serves `/_/plugins/<id>/(assets\|dist)/…` from the state root: allow-list, containment, `Cache-Control: no-store`; mounted in both native and server mode (`main.go:304-313`) |
| Service | `core/PluginService.ts` (1,951 lines), `types.ts:268-276` | a state machine over extension points and react-router routes; import timeout 30 s, five loads at once. `core/normalization.ts:11-15` imports `@/features/extensions/**` (`ui/`) |

### 1.2 Options

| Option | What | Verdict |
|---|---|---|
| A | Port the old loader and `PluginService` into `ui-next/` | **No.** N17's HSH-9 says "moves unchanged"; it cannot: `normalization.ts` and `createProductionDeps.ts` import `ui/` (rule 10), and most of the 1,951 lines serve extension points and react-router routes the new contract does not have. The engine properties that matter (bounded pool, timeout, generation guard, clear on reload) are about 150 lines |
| **B** | **A new minimal loader in `ui-next/plugins/`: SystemJS and `shared://` as today, a new list, the new contract** | **Chosen.** Plugin builds keep their format; `check-runtime-imports.mjs`-style static reads, the asset handler, installers and dev tooling are unchanged |
| C | Native ESM and an import map | Not now. An import map cannot be added after the first module fetch in every engine [INFERENCE: not tested in WKWebView]; the shared names would need generated blob modules; a native module cannot be evicted, so HSH-11's rule (after an upgrade no module of the old generation remains) would need hashed chunks everywhere and a reload per upgrade |
| D | Compile the plugin into the host | Violates A13 |

**The list is six names, not 34** (five when this was measured at N19a; the sixth is the curated runtime entry, below). N17's HSH-7 verdict says the new shell keeps the 34 names until the last plugin is rebuilt. It cannot: the new tree does not carry `@omniviewdev/base-ui`, `ai-ui`, `editors` or Monaco (R3, R4; AGENTS rule "the next build's module list stays free of the old libraries"), so a bundle that imports one cannot run in it whatever names are served. **Measured** [ran: `OMNIVIEW_UI=next` vite build, a recorder plugin over `generateBundle`]:

| Shared registration | Entry chunk | Extra chunk | Old-library modules |
|---|---:|---:|---:|
| none (today's `next` build) | 583,621 B (182.10 kB gzip) | none | 0 |
| react, kit, and the **whole** runtime barrel via `import('@omniviewdev/runtime')` | 595,168 B | **1,878,911 B (610.72 kB gzip)** | `@omniviewdev/base-ui` 2 modules (1,852,769 B), `@base-ui/react` 384, `react-router` 21 |
| react, kit, and a curated runtime module of 11 names | 588,902 B | none | 0 |
| **Built in N19b-1** (origin/main 30116c34 as the base): the curated entry `@omniviewdev/runtime/ui/v1` (10 functions, 48 types) in the shared list, the Pods scaffolding reading through it | entry 609,412 B (190.70 kB gzip) against 607,336 B (190.03 kB gzip) without it; the loader chunk 16,090 B against 15,604 B | none | 0 |
| the whole kit shared, no parts page (kit modules only) | 297,878 B to 300,899 B | none | 0 |

So the runtime must be shared as a **curated** module (R11): the barrel's peer dependency on base-ui (five files) comes along with a whole-barrel `import()`. The kit costs about 3 kB to share whole, because the shell and the list page already use almost all of it.

The six names (`ui-next/plugins/loader/specifiers.ts`, imported by Node in the fixture's build so build and host share one list): `react`, `react/jsx-runtime`, `react/compiler-runtime` (every first-party build compiles with the React Compiler and imports it), `react/jsx-dev-runtime` (development servers), `@omniviewdev/kit`, and (N19b-1, built) the runtime's curated entry `@omniviewdev/runtime/ui/v1`. Registering it costs the `next` build 2,562 B (859 B gzip): the entry chunk +2,076 B and the loader chunk +486 B; the modules are the same set, plus the entry's own file, because a dynamic import keeps every export of a module. Switching the Pods scaffolding to import through it costs 0 B (the same entry chunk to the byte). The whole barrel registered instead adds a 1,873,076 B (609 kB gzip) chunk of 575 modules: `@omniviewdev/base-ui` 2, `@base-ui/*` 428, `react-router` 21 (`scripts/ui-next-bundle.mjs --probe barrel`). The raw `@omniviewdev/runtime/api` and `/runtime` entries (`Call`, `Clipboard`: row N15) are **not** in the new list, which closes N15 for the new tree.

A plugin never imports `@omniviewdev/kit/styles.css`: the host loads it once and it declares the layer order. The plugin's own CSS goes inside `@layer ov.plugin` (below the kit's components, so it can style its own elements and never beat a kit part): the fixture's build folds it into the entry that way, as the plugins' `injectCssIntoEntry` folds it in today (`K8S ui/vite/omniview.ts`) [ran: check c].

### 1.3 The loader, as built

- `loader/shared.ts`: a lazy loader per name, registered by `registerShared` once; `loader/importBundle.ts`: `importBundle(id)`, 30 s timeout, `clearBundle(id)`.
- **Refused before it runs.** SystemJS loads a script with a script tag unless `System.shouldFetch` says to fetch it [`node_modules/systemjs/dist/system.js:685-720`]. The loader fetches every file under `/_/plugins/` through `System.fetch`, reads the first `System.register([...])` dependency list (`loader/preflight.ts`) and throws `IncompatibleBundleError` for a bare name the host does not serve. This is R11's "refuse on proof of mismatch, never on an unknown version", read from the artifact. It matters because an old bundle appends its stylesheet when its script is evaluated, ahead of linking (`K8S ui/vite/omniview.ts`), and an unlayered sheet in the new shell beats every layer the kit declares. [ran: the old-shell fixture's global is never set, both engines]
- **Not covered:** a failing chunk (not the entry) leaves one unhandled promise rejection in SystemJS 6.15.1 (`getOrCreateLoad` keeps `L` unattended when a dependency's `I` rejects) [ran: vitest reported it, so the unit test for it was dropped]. The five plugins ship one entry chunk, so it is not on the path today; it matters when a plugin splits.
- **`PluginStore`** (`host/pluginStore.ts`): loading, ready, failed per plugin; five loads at once; one load per plugin; a retry clears the plugin's modules first and drops the answer of a load it superseded. React reads it through `useSyncExternalStore`. The shell never waits for it.

### 1.4 The bundle: name, place, and the old and the new host

**Decision: `assets/entry.js`, one bundle per archive, chosen by the stream.** Evidence:

- The archive is `plugin.yaml`, `bin/plugin`, `assets/` at its root (`K8S hack/package.sh`, comment and the `tar` line). An update replaces the **whole installation**, so no file of the previous version survives under `assets/` [`backend/pkg/plugin/archive_transaction.go:550-559,647-658`; the directory-build path does `os.RemoveAll` first, `installer.go:682-697`].
- The Go tooling pins `assets/entry.js`: `internal/devworkspace/plugin_ui_build.go:65-69`, `plugin_archive.go:140-148`, `bench/app/plugin-bundle.mjs:33-36`, and about 40 Go tests (`installer_test.go`, `archive_*_test.go`). A second name would touch all of them; the same name touches none.
- **The trap** (RT1 2.2): all five configs emit unhashed `assets/[name].js`. A second Vite build into the same `assets/` overwrites same-named chunks, and the old bundle then breaks only in lazy code paths. With one bundle per archive there is nothing to overwrite. The new build also emits hashed chunk names (`chunkFileNames: 'assets/[name]-[hash].js'`), so even a merged directory cannot mix generations; the asset handler's `no-store` stays (HGO-40).
- Two bundles in one archive (`assets/entry.js` and `assets/next/entry.js`) is R1's rejected shape. It stays the **fallback** if the channel cannot carry the plugins (RT1 6.1 item 2); the asset handler already allows subdirectories (`plugin_asset_handler.go:34-36`).

| Host \ bundle | old bundle | new bundle |
|---|---|---|
| old shell | loads (today) | the bundle imports `@omniviewdev/kit`, which the old import map does not have: SystemJS fails with "Unable to resolve bare specifier", the old shell's error page shows it. Loud (R4). A stable host reaches a stream archive only by an explicit per-plugin channel choice |
| new shell | refused **before it runs**, by name: "built for another version of the app" (`incompatible`) [ran] | loads |

A plugin that has no `feature-ui-next` stream stays on its stable archive in a feature host with no log line (`channels.md` §4, "Silent skips"); that is the second row, first column. The page says what it is.

### 1.5 Dev mode (designed; **not run**)

What exists: the old loader imports `http://127.0.0.1:<port>/src/entry.ts` natively (`importPlugin.ts:27-81`). The plugin's Vite dev server rewrites shared imports to shims (`index.ts:253-264`). The host starts it with `pnpm run dev --port … --strictPort --host 127.0.0.1` in `<source>/ui` (`backend/pkg/plugin/devserver/vite.go:116,154-178`), and the child gets the host's environment: `env = os.Environ()` then `cmd.Env = env` (`vite.go:181-185,205`), with `OMNIVIEW_UI` kept by the filter (`gowatch.go:597-610`). A managed workspace's child inherits the supervisor's environment (`supervisor.go:399-409`, `launch.go:114-145`).

**Decision (L3, amended by A16): the plugin's `ui/` is the one project, and on `feature/ui-next` it is the new UI.** The plugin has no flavour switch and no `OMNIVIEW_UI`: `pnpm run dev` and `pnpm run build` in `ui/` are what they are today, and `pnpm run build` still writes `ui/dist/assets/entry.js`. What changes on that branch is the content of `ui/`: its `vite.config.ts` takes the new externals preset and hashed chunk names, and its `src/entry.ts` exports `contributionV1`. Why not a sibling `ui-next/` project (an objection of the first L3 that stands): the Go tooling assumes `ui` in six production files and 34 files with tests and docs [`vite.go:103,116,485`; `installer.go:682-697`; `internal/devworkspace/buildgraph.go:266-270`, `links.go:261-268`, `runtime_preflight.go:101-108`, `watch.go:423-425`], size M. Why not a flavour switch (the first L3, withdrawn by the owner): two stacks in one project until the flip, and one more Go change (below). What the decision costs: the branch's `ui/` diverges from `main`'s in every old-UI fix. The old shell takes fixes only after the calibration gate (A3), so the divergence is small and known; everything outside `ui/` (Go, `plugin.yaml`, packaging) flows by merging `main` into the branch, and a conflict inside `ui/` is settled by keeping the branch's tree. What the dev mode needs: a `@omniviewdev/vite-plugin` preset (the shared names, shims generated from `specifiers.ts`) and the loader's dev path (the same two steps as today, with the new names and `/src/entry.ts`), verified by running a dev plugin against `OMNIVIEW_UI=next task dev` (step N19b-3). The managed build-reuse fingerprint has no `OMNIVIEW_UI` (`internal/devworkspace/build_reuse.go:318-342,348-396`): under the first L3 that mattered for the plugin's flavour. Under A16 the plugin has no flavour; what is left is the host's own `OMNIVIEW_UI=next task dev` item (`AGENTS.md`, "Not verified"), which does not gate the seam.

### 1.6 The proof

`ui-next/plugins/fixture/` is a tiny plugin written as a plugin is, built **outside the host's bundle** by its own Vite config (`build.mjs`: Vite 7, plugin-react 5, the React Compiler, SystemJS output, `assets/entry.js`, the CSS folded in `@layer ov.plugin`). The build fails on any import that is not the plugin's own file, the shared list or a package it bundles on purpose. It writes four installed plugin directories:

| Plugin | What it is | What the check requires |
|---|---|---|
| `fixture-a-ok` | the healthy plugin: two pages, a sidebar hook | contributes with no route; one React, one kit; containment |
| `fixture-b-dup` | the same plugin with its **own copy of the kit** | the page fails (its `useTheme()` has no provider): the negative control, so the check can fail |
| `fixture-c-old` | a bundle that imports `@omniviewdev/base-ui` and sets a global when it runs | refused by name; the global is never set |
| `fixture-d-missing` | `assets/` holds no bundle | a named state |

The duplicate-kit build alone allows the kit's `react-dom` peer to be bundled. `MenuHost` uses it for portals; a normal plugin imports the host's kit and never resolves that dependency itself. Both fixtures still externalize React, and `react-dom` is not a shared name.

**How it was run** (macOS arm64, Playwright 1.64.1 WebKit and Chromium, 2026-11-17):

```sh
pnpm install --frozen-lockfile && task packages && git checkout -- packages/omniviewdev-vite-plugin/shims/_omniviewdev__runtime__models.mjs
OMNIVIEW_UI=next task build:server            # 26 s: the real Go host, -tags production,server
node ui-next/plugins/e2e/seam.check.mjs       # builds the four plugins into a throwaway HOME's .omniview-feature-ui-next/plugins, starts bin/Omniview-server on a free port with a minimal environment, drives both engines; 14 to 24 s; exit 0 (two runs)
```

```
webkit: other requests that answered 4xx while the page ran: 422 /wails/runtime
PASS webkit: contribute (sidebar entry, page, no route), one React and one kit, the control fails, containment, refusal, named states
chromium: other requests that answered 4xx while the page ran: none
PASS chromium: contribute (sidebar entry, page, no route), one React and one kit, the control fails, containment, refusal, named states
bundle fixture-a-ok/assets/entry.js 2726 B, imports [react/compiler-runtime, @omniviewdev/kit, react, react/jsx-runtime]
```

What the check asserts, per engine: the window opens `/?screen=plugins` with no hash and shows the plugin's tab, sidebar entry (current) and three rows; the sidebar's hook replaces the skeleton ("Items 3"); the bundle's `useState`, `Text` and `useTheme` are `===` the registry's (`System.get('shared://…')`), and the Theme cell shows the host provider's theme; the plugin's stylesheet starts `@layer ov.plugin` and applies; choosing "Crash" shows the kit's failure notice with the sidebar beside it and none of the plugin's words, Retry tries again, "Items" draws; the copy fails; the old bundle is refused and never ran; the missing one says so; the build's own dependency lists (healthy: four of the five names; copy: no kit; old: `@omniviewdev/base-ui`).

**Not proven:** the native window and WKWebView; real data through shared runtime hooks (the curated entry is measured in 1.2, not built); dev mode; a plugin installed from an archive and moved by channel sync; `archive-smoke`; Windows and Linux. One request, `422 /wails/runtime`, answered once in one engine per run (WebKit in the first passing run, Chromium in the second); I did not find its cause [UNVERIFIED whether the Pods scaffold shows it too]. Tests: `pnpm test ui-next` runs 29 files and 554 tests; the new ones are 99 in `ui-next/plugins/` (admission, pre-flight, failure kinds, the shared list against real SystemJS, the loader against a faked `fetch`, the store, the route, the host) and two in `shell/`. The checks that ran green: `tsc` for the app and test projects, `eslint ui-next packages/kit`, `pnpm lint:ui-policy`, `pnpm lint:css`, the vocabulary scan (0 hits), `node --test scripts/react-compiler.test.mjs` (13 pass).

## 2. The first contribution contract (`/v1`)

### 2.1 The shape (`ui-next/plugins/contract/v1.ts`)

A bundle exports **one** value, `contributionV1`. The version is the export name, so a later contract is `contributionV2` beside it, one archive can serve two host generations, and the host takes the highest it knows. No version field inside the object.

```ts
type ContributionV1 = {
  plugin: { name: string; accent?: ShellAccent };          // names the frame: "<name> workspace"
  rail?: true;
  sidebar: {
    label: string; title: string;
    nodes: SidebarNodeV1[];                                 // the skeleton: draws before any data is read
    useNodes?: (ctx: ContextV1) => SidebarNodeV1[] | undefined;   // per connection; undefined keeps the skeleton
  };
  pages: Record<string, ListPageV1<any>>;                   // by id; the id of a sidebar leaf names one
  home: string;                                             // the page the window opens: a key of `pages`
};
type ListPageV1<Row> = {
  kind: 'list';
  definition: ListPageDefinition<Row>;                      // the host's list page, ui-next/page/definition.ts
  usePage: (ctx: ContextV1) => { frame: FrameV1; source: ListSource<Row> };   // the one data hook (MNR-T8)
};
type FrameV1 = { tab; path; scope? };                       // as ShellRegistration reads them
type ContextV1 = { plugin: string; route: { page: string; connection?: string } };
```

The registration the shell reads (`ShellRegistration`) is **built by the host** from the contribution: the plugin never imports the shell. `ListPageDefinition` and `ListSource` are the types of `ui-next/page/`, unchanged. Admission (`admit.ts`) checks the shape the host reads, with one problem per defect (at most eight) and refuses a sidebar leaf that opens no page: no stub entry ships. It cannot check that an `icon` is a glyph the kit has (the kit exports no list: `Icon` throws on an unknown name, so the sidebar's boundary contains it; ask: the kit exports `isIconName`).

### 2.2 The route: how the window opens a contribution with no URL parameter

The native window loads `/` and cannot take a parameter (N12a finding F1; `mainWindowOptions`, `main.go:855-859`). So a route is optional in every part: `{ plugin?, page?, connection? }`. Absent plugin: the first plugin by id that is ready, **chosen once every plugin has settled** (the first version chose the first ready one and flashed whichever plugin loaded faster: the check caught it). Absent page: the plugin's `home`. A browser can say more in the hash, `#/<plugin>/<page>?connection=<id>`; that is also what makes a check of one page repeatable, and a click on a sidebar leaf writes it (`Shell` gained `onChoose`: the tree already computed `activate` for Enter and Space and ignored it). The window opens a contributed page with no hash; the screen selector `?screen=plugins` is temporary and becomes the default screen at the flip (step N19d moves the parts page to `?screen=parts`; the kit probes open `/`, so that step needs the kit owner).

`connection` is the scope the user chose. Until the scope menus exist (tier C) the plugin owns what an absent one means: the Pods page takes the plugin's first connection, as `PodsPage` does today (`ui-next/pods/PodsPage.tsx`, "Connection").

### 2.3 What a plugin may import

`react`, `react/jsx-runtime`, `react/compiler-runtime`, `@omniviewdev/kit`, and `@omniviewdev/runtime/ui/v1`. The Pods list used exactly these runtime names when this was written [`ui-next/k8s/*.ts`, `ui-next/pods/PodsPage.tsx`]: `useConnectionReadiness`, `useResolvedResourceTarget`, `useResourceTypes`, `useResources`, `useConnections`, `valueToJSON`, `ErrorTypes`, `isCancelledError`, `parseAppError`, and the types `HostRecord`, `ConnectionReadinessPhase`, `HostSourceStatus` (`jsonToValue` in tests); the entry built in N19b-1 has those ten functions and the 48 types their signatures mention (`packages/omniviewdev-runtime/src/ui/v1.ts`, API report `api/ui-v1.api.md`), and the scaffolding now imports only through it. **The curated entry is its own versioned module in the runtime package**, so TypeScript rejects any other name at compile time (a curated subset served under the old main entry name would typecheck against the whole barrel and fail at run time). The host mounts the providers the hooks read: the QueryClient and the theme (the entry), the activity provider (`PluginHostScreen`, and the `?screen=pods` mount point for the scaffolding). The boundary lint's definition of what plugin code may import (`packages/kit/eslint/plugin.mjs`, `pluginViolation`) is now this list (`PLUGIN_SURFACE` in `scaffolding.mjs`, compared with `specifiers.ts` by a test): its own files, the shared names, third parties; any other `@omniviewdev/*` package, the runtime's main entry included, is a violation.

### 2.3.1 Where the contract's types live

They import the kit's types (`IconName`, `DataTableColumn`, `ChipTone`) and the page and shell types, so they cannot live in the kit (D2.3: the kit knows nothing of plugins). Recommended: the same curated runtime entry, `@omniviewdev/runtime/ui/v1`, which then holds the contract's types and the data hooks together under one API report (R11). Until then they sit in `ui-next/plugins/contract/v1.ts`, which the fixture imports as types only (erased at build; the build fails on any other import out of the plugin). Owner call: whether the runtime package takes a build-time dependency on the kit's types.

### 2.4 Containment and failure states

- **Per contribution.** The sidebar's hook runs in its own boundary (a throw keeps the skeleton and the page); each page's hook and the whole page run in another (a throw is the kit's failure notice where the page was, the sidebar still there, a Retry that renders it again). A plugin's page does not take down another plugin's, nor the frame [ran, unit and browser]. A boundary catches render and lifecycle errors; a handler or an async callback is the plugin's own.
- **Load failure** is one of five kinds (`loader/failure.ts`): `missing`, `incompatible`, `broken`, `timeout`, `contract`. The page says one sentence per kind under the plugin's name ("Couldn't load Seam Fixture Old: This plugin was built for another version of the app. Update it.") with the kit's one Retry, in the same `DataView` error state the Pods list uses for a failed read. **The plugin's own text and the loader's detail go to the log only** (decision B6 is pending: whether a sanitised diagnostic may be shown behind "Details"; until it is answered nothing is shown).
- Retry clears the plugin's modules and loads it again; SystemJS keeps a failed load until it is deleted [ran: unit test].

### 2.5 What K8s computes at run time, and what is static

From RT2 3.2 (K8S 524d123) and re-read: the **sidebar tree** is computed per connection from the catalog (`K8S ui/src/hooks/useSidebarLayout.tsx:374-380`, `useResourceGroups` and `useResourceTypes`); the **Pods columns** are hook-driven in the old UI (`corev1/Pod/Table.tsx`); row actions need code. In the new tree the Pods list is already a **data definition** (`ui-next/k8s/definition.ts`) with four derived fields in code. So: static skeleton plus `useNodes` for the tree; static `definition` plus `usePage` for the list; per-resource actions and hook-driven columns are code behind later contribution kinds. The hook is the dynamic part; the static part draws first. Pod through the real chrome with the plugin's JavaScript blocked needs the definition and four derived fields (plan 2.4); the seam's first step does not claim it: the page is drawn from plugin code.

### 2.6 Later slices add (not designed here)

Detail documents and the tab contract (`describe`, `resolve`, `key`, `restore`: slice 1b); commands and row actions with enablement over resource data; panel tools and rail tools (the rail track is reserved, `rail: true`); palette providers; cell kinds beyond the list definition's; a connection picker and namespace scope (tier C), after which the host owns connection selection; the manifest skeleton (R11) that lets the host draw the sidebar before the bundle loads; telemetry of load spans (`loadTelemetry.ts`); dev-server readiness gating and reload on `plugin/update_complete` (`useInstalledPlugins.ts` invalidates the inventory; the store does not yet reload a loaded plugin whose files changed); retry with back-off; quarantine of a crashing contribution.

## 3. Where the code goes

**In the plugin repository** (`ui/src/` on its `feature/ui-next` branch: A16, the old UI code is deleted there, so no destination carries a `next/` directory). Moved, not rewritten; the only import that changes is the runtime's entry name.

| Host file | Plugin destination | Note |
|---|---|---|
| `ui-next/k8s/pod.ts`, `status.ts`, `fields.ts`, `row.ts`, `sort.ts`, `state.ts`, `usePods.ts`, `definition.ts`, `index.ts` | `ui/src/pods/data/` | imports only `@omniviewdev/runtime/ui/v1`, `@omniviewdev/kit` and `react` (`k8s/README.md` rule 2; the boundary lint enforces it) |
| `ui-next/k8s/*.test.ts(x)`, `testing.ts`, `fixtures/pods-table.json` | `ui/src/pods/data/` | the golden test reads kubectl's own cells from the fixture; vitest and testing-library are the plugin's devDependencies already (`K8S ui/package.json`) |
| `ui-next/pods/cells.tsx`, `cells.module.css`, `listDefinition.tsx`, `source.ts` (+ tests) | `ui/src/pods/` | `listDefinition.tsx` is the page's `definition`; `source.ts` maps `PodsView` to the contract's `ListSource` |
| `ui-next/pods/PodsPage.tsx`, `shellRegistration.ts` | `ui/src/pods/usePodsPage.ts`, `ui/src/entry.ts` | the connection pick, the dev "start a stopped connection" shortcut and the registration become `usePage` and the `frame`; `ActivityProvider` is the host's now |
| `ui-next/e2e/parity.mjs`, `oracle*.mjs`, `pods-cluster.check.mjs`, `pods-page.probe*.mjs` | `ui-next/e2e/` of the plugin repository, run in its PR CI | they know the Pods markup and kubectl; `host.sh` generalises (plugin id, `assets/`) and stays in the host |

**Stays in the host:** `ui-next/page/` (the generic list page), `ui-next/shell/`, `ui-next/plugins/` (loader, contract, host, fixture, check), `main.tsx`.

**Deleted in the host:** `ui-next/k8s/`, `ui-next/pods/`, the `SCAFFOLDING(N19)` regions of `main.tsx`, `?screen=pods` (`shell/probes/targets.mjs:25` and the cluster check move to the hash route, `#/kubernetes/pods`). `packages/kit/eslint/scaffolding.mjs`: `PLUGIN_CODE` becomes empty and `SCAFFOLDING` loses `ui-next/e2e` once the probes have moved: **a change to the kit's files, so the kit owner's.** After it the vocabulary scan and the boundary lint cover the whole host tree; the plugin repository gets the boundary lint's plugin-code rules for `ui/src/`.

## 4. The sequence

Each step is about an hour of agent work unless marked; exit tests are observable.

| Step | Repo | What | Exit test | Owner? |
|---|---|---|---|---|
| **N19a** (this) | host | design, loader, contract, host, fixture, check | `seam.check.mjs` passes in WebKit and Chromium; `pnpm test ui-next` | |
| N19b-1 | host | **Done** (`status/N19b.md`): `@omniviewdev/runtime/ui/v1` (10 functions and the 48 types their signatures mention), its API report (`packages/omniviewdev-runtime/api/ui-v1.api.md`, CI step "Runtime curated entry"), added to `specifiers.ts` and `shared.ts`; a graph check of its source, declarations and scripts (`check-ui-v1.ts`, part of the runtime build); a guard that the `next` build has no old-library module (`scripts/ui-flavour.test.mjs`); the Pods scaffolding reads only through it and the kit, and the boundary lint enforces that | the check's fixture calls one hook through the shared entry (passes in WebKit and Chromium); the guard goes red with the whole barrel registered (it does) | |
| N19b-2 | host | `@omniviewdev/vite-plugin` preset for the shared names (externals, shims generated from `specifiers.ts`, parity check like `check-shim-exports.ts`); hashed chunk names. A plugin's `vite.config.ts` on `feature/ui-next` calls it directly: no environment switch (A16) | a plugin built with it imports only the list | |
| N19b-3 | host | dev mode: the loader's dev path (`/src/entry.ts`, the new names). The first draft also put `OMNIVIEW_UI` into the build-reuse fingerprint (`build_reuse.go`) here; under A16 the plugin has no flavour, so that is the host's own `task dev` item and not a step | a fixture dev server against `OMNIVIEW_UI=next task dev` loads and hot-updates (S) | |
| N19b-4 | host | `archive-smoke` for a new-shell bundle: generalise `bench/app/archive-smoke.mjs` (hard-wired to K8S and the old shell) to read an archive's dependencies against `specifiers.ts` and run `seam.check` against it; `plugin-archive-smoke.yml` gets the `ui` input | smoke passes on a new bundle and fails on an old one | |
| N16 | host | the kit's licence files and first npm publish (dist-tag `feature-ui-next`) | `npm view @omniviewdev/kit` | **owner** |
| N19c-1 | plugin | `ui/` becomes the new project on `feature/ui-next` (A16): the old UI code deleted, `vite.config.ts` on the preset, a `contributionV1` with the skeleton and the Pods page stub, `@omniviewdev/kit` and the runtime's `ui/v1` entry as dependencies, a CI step | `pnpm build` in `ui/` writes `ui/dist/assets/entry.js` that the host's smoke accepts | |
| N19c-2 | plugin | move the data layer, the cells, the page definition, the tests (section 3) | the plugin's vitest passes the moved suites; the contribution renders the real Pods | |
| N19c-3 | plugin | the channel workflow builds the branch as it is (`hack/package.sh` runs `pnpm run build` in `ui/`) and passes the smoke with `ui: next` | a green channel run on `feature/ui-next` | **owner**: promote the branch and the channel on the marketplace (`channels.md` §4, §6), `min-ide-version` at or below 0.35.2, the first plugin release |
| N19d | host | the cutover: `ui-next-pods.yml` builds the plugin's `feature/ui-next` at the plugin PR's pin (no flavour variable) and installs `assets/`; checks move to `#/kubernetes/pods`; delete `ui-next/k8s`, `ui-next/pods`, `?screen=pods`; `plugins` becomes the default screen, the parts page `?screen=parts`; the kit's lint lists and probe URLs | the Pods list renders from the plugin on the kind cluster; the host tree holds no plugin code; guards green | the kit owner for `packages/kit/**` |

N19b-1 and N19b-2 can run in parallel; N19c-1 needs N19b-1, N19b-2 and a way for the plugin's install to take the kit and the runtime's `ui/v1` entry: N16 and a publish, or packed tarballs until then (`status/N19b.md` says what was run); N19d needs N19c-2.

## 5. Risks and decisions for the lead

1. **Plugin layout: decided by the owner (A16).** The first draft offered D1 (a sibling project, the M-size Go change) or D2 (a flavour switch in one `ui/`) and asked for a decision before N19c-1. The owner chose neither: `ui/` becomes the new UI on the plugin's `feature/ui-next` branch, with no double pathway. What remains of the question is the divergence of that branch's `ui/` from `main`'s (1.5). The Go tooling's assumptions (`ui/`, `assets/entry.js`) hold unchanged.
2. **The default screen.** `?screen=plugins` is explicit and the parts page stays at `/` because the kit's probes open `/`. The flip of the default is N19d, with the kit owner.
3. **`Shell` gained `onChoose`** (a click, Enter or Space on a leaf): `ui-next/shell/README.md` decision 4 ("choosing an entry does nothing") is changed by this PR. The registration stays plain data.
4. **Shared-list size.** Five names against 34: any first-party plugin needing another name (`react-dom` for a portal, `@tanstack/react-query`) adds it by a reviewed change to `specifiers.ts` and the preset, with the curated-entry rule. N17's HSH-7 verdict ("34 names until the last plugin is rebuilt") is superseded here for the reason in 1.2.
5. **`@omniviewdev/kit` must be published** before a plugin repository can build against it (N16: Apache-2.0 files first). A packed tarball works for a dry run [INFERENCE].
6. **Cell-level containment** is the old shell's (`ui/features/plugins/README.md`, "Error Isolation": a crashing cell fails alone); v1 contains at the page.

## 6. Not verified

The native window and WKWebView (Playwright WebKit only); Windows and Linux; the Pods list's REAL data through the shared curated entry (the seam check's fixture reads through it from the real host, but the fixture has no backend, so the host answers an empty list; Pods through the entry run in the real-cluster parity check of CI, which reads through the scaffolding that now imports only the curated entry); dev mode; archive install and channel sync of a new-UI archive; `archive-smoke` against a new bundle (`channels.md` §4 item 5 stays UNVERIFIED); the cost of the extra entry read per plugin (the pre-flight reads the entry once through `System.fetch`, which SystemJS then evaluates; there is no second read); line numbers after `origin/main` moves. The `422 /wails/runtime` of N19a is explained in `status/N19b.md` (the activity session calls of server mode, `backend/pkg/activity/frontend.go:105`); the race behind it is inferred from the code, not instrumented.
