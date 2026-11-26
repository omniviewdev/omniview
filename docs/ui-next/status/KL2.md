# KL2: the plugin's landing (the host's generic seam)

Goal: nothing let a plugin show a page that belongs to no connection, so opening a plugin with two or more connections dumped the person on the host's Home (rule R4, `contributions.ts` `complete`). This adds the generic seam that lets any plugin draw its own landing page from kit parts (owner decision: the plugin, not the host, draws and owns the landing). The host stays plugin-agnostic: no plugin word in `ui-next/` or `packages/kit/` (the vocabulary guard is green).

- Worktree: `~/Repos/omniviewdev/worktrees/plugin-landing`
- Branch: `feat/plugin-landing` (from `origin/main` 7c8c30ec0). Nothing committed, pushed or opened as a PR: the lead does that.

## What changed

Contract (`ui-next/plugins/contract/v1.ts`, minor and additive; the rule is written at the head of the file, on the overview page's terms):

- `CustomPageV1 = { kind: 'custom'; scope: 'plugin' | 'connection'; title: string; icon: IconName; layout?: 'document' | 'pane'; Body: ComponentType<{ context: CustomPageContextV1 }> }`, a member of `PageV1`.
- `CustomPageContextV1 = ContextV1 & { connections: ConnectionsHostV1 }`.
- `ConnectionsHostV1 = { subscribe(listener): () => void; getSnapshot(): ConnectionsViewV1; open(key, { newTab? }): Promise<ConnectionOpenResultV1>; refresh(): Promise<void> }`; `ConnectionsViewV1 = { loaded; failed; connections: readonly ConnectionV1[] }`; `ConnectionV1 = { key; name; description?; state: ConnectionStateV1; word; role: StatusRole; reason? }`; `ConnectionOpenResultV1 = { ok: true } | { ok: false; reason }`.
- `ContributionV1.landing?: string`: a key of `pages` that must be a `custom` page of scope `plugin`.

Host (one line each):

- `contract/admit.ts`: admits `custom` pages (scope, title, icon, layout, Body: a function or a React-made object) and `landing` (one sentence for a missing page, a list, detail or overview page, a custom page of scope `connection`).
- `contract/paletteRows.ts`: a palette row's route to a custom page with parameters is refused in the words "a custom page".
- `host/contributions.ts`: `homeOf` is the landing when declared; `complete` (the routing rule below); `describeCustom`; `readsNoConnection`.
- `host/connectionsHost.ts` (new): `context.connections`, the window's own store, words and actions cut to one plugin; one frozen handle per plugin; stable snapshot identity.
- `host/PluginHost.tsx`: `CustomContribution` (Body in the page's boundary) and `ConnectionFace` (the lane of a page of scope `connection`); no sidebar and no `ports` for a page read in no connection; layout from `layout`; opens that name no connection wait for no list when the plugin has a landing (`hasLanding`: `+`, the rail, Home's row, a link).
- `host/connections/actions.ts`: a tab on a page read in no connection that is moved to a connection goes to the plugin's `home` in it.
- `plugins/README.md`: rules 11 and 12, a short section for plugin authors, rows for the new files.
- `fixture/`: the connections fixture's landing variant (`entry-landing.tsx`, `landing-pages.tsx`, `build.mjs` `writeConnectionsPlugin(root, binary, { landing: true })`); the default plugin, and so every seam scenario, is unchanged.

## The routing rule, as implemented (`complete`)

1. A route whose page is a `custom` page of scope `plugin` keeps no connection: the one inherited from the tab it is opened from is not carried to it and one it names is dropped (other parameters stay). The route object is returned as it is when nothing changes.
2. With a `landing` declared and no connection named (after the tab it is opened from lends its own): a route that names no page the plugin has (`$home` or an unknown page) is the landing, whatever the source (including a tab that is described again, `refresh`); a route to a page of a connection is the landing too, except for `refresh` (a tab already open keeps its route). Never Home, the connection last used, or the plugin's first.
3. No landing: unchanged (rule R4 as it was). A connection named: unchanged (`$home` is the plugin's `home` in it).
4. `home(plugin)` (what the rail's fallback route, Home's row, the empty window's row, `+`, the palette's plugin row and the Problems and Operations rows open) is the landing; a connection chosen (`actions.go`) still opens `home`.

## Choices to confirm (where the lead's text left a gap)

- **`layout?: 'document' | 'pane'` is added** to `CustomPageV1` (not in the lead's shape): a kit `DataView` is `height: 100%`, so a collection page needs the pane. Default `document`. Remove it if a landing is never a collection (the fixture's second page uses it).
- **`icon: IconName`, flat**, as the panel tool and the rail declare it; the host draws no tile, so there is no `tile`.
- **Sidebar while a page read in no connection is on screen: none.** The window draws the rail and no sidebar track (a Home-like frame), because every sidebar entry is a page of a connection and, with no connection to carry, would open the landing again. An empty tree is not drawn (an empty `role=tree` is an axe fault). Cost: the frame loses 244 px when the tab moves from a page of a connection to the landing; a restored window reserves the track until its plugins have settled, then releases it once (the known frame-shape case in `shell/README.md`).
- **Lane:** a page of scope `plugin` publishes none and its tab has no scope. A page of scope `connection` gets the connection face from the window's own list (the NAME, with the picker); verified in jsdom only.
- **`open(key)` is Home's row:** `actions.go(plugin, key, { how: 'smart' | 'new', source: 'landing' })`. Smart open from a landing (no scope) to a connection (a scope) opens a NEW tab and leaves the landing, as Home's row does; `newTab: true` also skips the "a tab that shows it is shown" rule. Observed in both engines.
- **`home` may be a page read in no connection:** not refused (it is coherent: the page opens wherever it is asked). `landing` is refused for anything but a custom page of scope `plugin`.
- **Labels are not in the view:** the window's list carries id, name and description only (see the backend catalog).
- **Known limit:** the window remembers the route a plugin was last shown at (`routes`); after the landing is shown, a palette page row or a sidebar entry for that plugin that names no connection opens the landing until a page of a connection has been shown again. Skipping plugin-scope routes there would fix it for tabs shown this session, not for a restored session (the host does not know the page kinds at seeding); not done.

## Compatibility (both ways, as for the overview page)

- Old plugins on this host: every existing admit, palette, contribution and fixture test is unchanged but two assertions and one title that quote the list of kinds in a message, which changed their words on purpose (`"list", "detail", "overview" and "custom" pages`); a plugin with no `landing` is completed as before (`contributions.test.ts`).
- A plugin that uses the kind on a host that lacks it: the first run of the new admit tests on the unmodified admission printed `pages.landing.kind is "custom", and this version draws "list", "detail" and "overview" pages` (with the problems of reading it as a list), the `contract` failure: a typed refusal at admission, never drawn wrong. A `landing` must name a custom page, so it is refused with the bundle.

## Log

- 2026-11-25: read the contract, `complete`, the rail, Home and the connections store; wrote the contract and the admission tests red first (18 failed on the unmodified admission), then admission (151 admit tests green).
- 2026-11-25: `connectionsHost.ts` and its tests (11); `complete`, `describe`, `home` and their tests (69 in `contributions.test.ts`); `PluginHost` wiring and `PluginHost.landing.test.tsx` (18); `actions.ts`; palette rows; fixture variant and its tests (11); README.
- 2026-11-25: real host (`OMNIVIEW_UI=next task build:server`, load average 4 to 7) with the fixture written with the landing: 46 of 46 checks in WebKit and Chromium at 1440 x 900 (23 each): Home's row opens the landing (one tab, not Home); `+` opens a second landing tab; the landing lists both connections in the host's words (Disconnected, then Connected after its start); no sidebar and no lane on it, the plugin's rail entry current; Open starts north and opens its Overview in a new tab (sidebar and lane back); the card's right-click menu (kit `useMenu`) opens south in a new tab; the kit `Link` takes the tab to the second page (a pane with a data view, footer "2 Connections") and back; on a Home tab the plugin's row and the rail entry open the landing; a reload brings back every tab and the landing draws its cards; no page error and no console error.
- 2026-11-25: final checks, clean environment: kit `verify` (125 files, 3,100 tests, vocabulary guard, API report, dist check), both tsc projects, `eslint ui-next packages/kit --report-unused-disable-directives`, `lint:ui-policy`, `lint:css`, `node --test scripts/react-compiler.test.mjs` (13 of 13), full root `pnpm test` (454 files passed, 1 skipped; 10,045 tests passed, 3 skipped). The first full run failed once: `connectionName.test.ts` lists the files that read a route's connection parameter and my helper was called `connectionOf(`; renamed (`toldOf`), green.

## Not verified

- The native WKWebView and Windows; the Kubernetes Pods cluster check (`scripts/ui-next-pods`) and the real plugin (it has no landing, so the rule above changes nothing for it); the seam check (`seam.check.mjs`: no scenario opens a plugin with a landing and the default fixture is unchanged), the kit, shell, strip and rail probes (CI runs them at night; no file they read changed but `registrationOf`, which only differs for a custom page of scope `plugin`).
- A page of scope `connection` in a browser (jsdom only); keyboard and axe on the fixture's landing; focus after `open`; the landing with hundreds of connections (the card grid holds them in the page, not windowed).
- No negative control was run for the new tests (a perturbation of each rule, as rule 28 asks for probes).
- What a real plugin does with the sidebar's entries while the landing is on screen (none are drawn).

## How a real plugin adopts it

The plugin repo vendors the contract and the kit from a host commit: `hack/vendor-host.sh <clean host checkout>` in `omniview-plugin-kubernetes` on `feature/ui-next` writes `ui/vendor/omniviewdev-kit-<version>.tgz`, `omniviewdev-runtime-<version>.tgz`, `ui/vendor/shared-specifiers.json`, `ui/vendor/HOST_COMMIT` and `ui/src/contract/{v1,page,definition,detailDefinition,shell}.ts` (this change keeps `v1.ts` types-only and imports nothing new from the host), names the tarballs with `file:` specifiers in `ui/package.json` and pins their integrity in `ui/pnpm-lock.yaml`. The host pins the plugin the other way: `KUBERNETES_PLUGIN_REF` in `.github/workflows/ui-next-pods.yml`, checked by `scripts/ui-next-pods/pin.mjs` (`HOST_COMMIT` must be the host under test or an ancestor), so: this host PR merges first, the plugin PR vendors from the merge commit, then the host's pin moves. In `ui/src/entry.ts` the plugin adds the page and the key (`landing: 'landing'`, a `custom` page of scope `plugin` whose `Body` reads `useSyncExternalStore(context.connections.subscribe, context.connections.getSnapshot)` and calls `context.connections.open(key)`), keeping `home` as the page a chosen connection opens. [INFERENCE: once the plugin declares a landing, a deep link with no connection (`#/<plugin>/<page>`) opens the landing, so a check that opens one needs `?connection=<id>`; not read.]

## Dev tools

- `/tmp/kl2/verify.mjs` (scratch, not committed): builds the connections process (`buildConnectionsProcess`), writes the landing variant with `writeConnectionsPlugin(root, binary, { landing: true })` into a temporary state root, starts `bin/Omniview-server` (`OMNIVIEW_CHANNEL=feature-ui-next`, a free port, a temporary `HOME`) and drives WebKit and Chromium with Playwright; screenshots in `/tmp/kl2/shots`. `ENGINES=webkit` runs one engine.
- The fixture's landing variant (`fixture/src/entry-landing.tsx`, `landing-pages.tsx`) is a dev tool as well: written only on request, so no scenario sees it.

## Backend catalog

None required by this slice. One note, host TypeScript side and not Go: the Go answer of `GetAllConnectionStates` carries the SDK connection's `labels` and `lifecycle` (`packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models.ts:93,99`), but the window's `StateRecord` reads only `id`, `name` and `description` (`ui-next/plugins/host/connections/api.ts:8-12`), so a landing cannot show labels. TANGENTIAL; interim: absent from `ConnectionV1`.
