# KL7: the landing's four seams (the sidebar hook's parameters, `setParams`, `expanded` and `pluginScope`) and two kit corrections

Goal: the Kubernetes plugin adopted the landing seams (KL2 custom pages, KL4 `context.connections`, KL5 the sidebar on plugin-scope pages) and hit four gaps that forced workarounds (a hidden `Link` it clicks to move its own tab, a page drawn again from scratch on every filter, a navigator that cannot see the page's parameters, a sidebar that cannot start a group open or be called something else on the landing). This closes them generically in the host and the kit; the host and the kit stay plugin-agnostic (the vocabulary guard is green).

- Worktree: `~/Repos/omniviewdev/worktrees/landing-seam-fixes`
- Branch: `feat/landing-seam-fixes` (from `origin/main` 3e9b2e6b8). Nothing committed, pushed or opened as a PR.

## What changed

Contract (`ui-next/plugins/contract/v1.ts`, minor and additive; the rule is written at the head of the file, on the sidebar-on-a-landing terms):

- `CustomPageContextV1.setParams: (next: Readonly<Record<string, string>>, options?: SetParamsOptionsV1) => void`, with `SetParamsOptionsV1 = { history?: 'push' | 'replace' }` (default `replace`). Host-filled, like `connections`: a plugin's test double of the context has to give it, and a plugin that calls it on an older host tests for it.
- `SidebarNodeV1.expanded?: boolean` (from the shell's tree node): a group that starts open. Initial state only.
- `SidebarV1.pluginScope?: SidebarPluginScopeV1` with `SidebarPluginScopeV1 = { label?: string; title?: string }`: what the sidebar is called on a page read in no connection; a member left out is the sidebar's own.
- The sidebar hook's `context.route.params` is the route's text parameters (it was always `{}`).

Host:

- `host/PluginHost.tsx`: `NodesSource` passes `textParamsOf(route)` (the same object while the text is the same, so a render of the host runs no hook again); `CustomContribution` builds `setParams` for its tab; `pageKeyOf` is the key the page host draws a page from scratch for; `sidebarOf` takes `pluginScope` on a page read in no connection.
- `host/contributions.ts`: `askedParams` (what a `setParams` call asks of the tab's route: text only, `connection` kept and never settable, a problem sentence for anything else).
- `contract/admit.ts`: refuses a malformed `sidebar.pluginScope` by name; `openable` already keeps `expanded` (the node is spread).

Shell:

- `shell/tabs/PageHost.tsx`, `shell/Shell.tsx`: optional `pageKey(tab)`; the page's React key is `pageKey(tab) ?? location.key`, plus the tab's generation. Default behaviour unchanged.
- `shell/registration.ts`, `shell/core/tree.ts`, `shell/Tree.tsx`: `ShellTreeNode.expanded`; `startingOpen(rows, seeded)`; `TreeRecord.seeded`. A group that says `expanded` opens ONCE, the first time the tree has it on screen (when the tree mounts, when a later answer brings it, or when it comes into view inside a closed group); `seeded` keeps which groups were given their start, in the tree's state and in the window's memory of its trees, so what the person did afterwards wins (a group they closed is not opened by the next answer nor when the tree comes back). The walk is over the visible rows, not the nodes (optimisations LIB-11, LIB-12, LIB-15 hold).

Kit:

- `DataView` passes the `data-*` of its `quickFilters` to the strip (`dataAttributes(quickFilters)`). The standalone `QuickFilters` already passed `data-*` to its root (its own test says so); the loss was in `DataView`, which handed the strip five named props and dropped the rest, so a plugin that gives a `DataView` a strip with `data-*` (to find it again) never had them on the element. One test.
- `ValuePicker`: no change (see "Choices to confirm", 5).

Fixture landing variant: the landing has a `QuickFilters` strip whose press calls `context.setParams(..., { history: 'push' })`, a `SegmentedControl` for the order (`sort`, a second route parameter; `replace`), and a search whose text is the page's own state; the navigator's filters carry the `sort` the hook now sees, its Connections group says `expanded: true`, and the bundle gives the sidebar `pluginScope: { title: 'Plugin', label: 'Seam Connections plugin navigation' }`.

Docs: `plugins/README.md` (rules 11 and 13 updated, new rule 15, the navigator section and its sample, two table rows, the fixture row), `shell/README.md` (the page host's key, a row for `expanded`), `shell/core/tabs/README.md` ("Place and page are two things").

## How in-place parameters work (keying, history, restore)

A custom page's PLACE is still its page and its parameters (`location.key`: the tab's identity for `open`'s "a tab that shows the key is shown", saved with the tab); its PAGE, what the page host draws from scratch, is its plugin, its page and, for a page of a connection, its connection (`pageKeyOf`, handed to the page host as `pageKey`). A change of the parameters alone, by `setParams`, a link, a sidebar leaf with `params`, Back or Forward, therefore leaves the mounted Body in place and gives it a new `context` (new `route.params`); a different page, a different connection, another tab and a reload are drawn from scratch as they were, and a list, a detail and an overview page keep their place as their key.

`setParams` calls the tab model's own operations on the route the tab is at now (a late call from a page the tab has left is dropped): `replace` (the default) is the model's `replace`, which takes the history entry and keeps the tab's page memory; `push` is `navigate` with `history: 'push'`, which adds an entry (Back returns to the parameters it left), asks the unsaved-changes question and starts the new entry's page memory clean, as for a link. A call that names the parameters the page has is the model's no-op; text only and never `connection` (the call is ignored with one `console.warn` line, `[plugins] <plugin> page <page>: setParams was ignored: <why>`). Because the tab's route is what changes, the sidebar's current row, the saved session (a reload restores the parameters) and Back and Forward follow the model's rules with no code of their own.

**Keep-alive and page memory (decision):** keep-alive is by TAB (`state.mounted` holds tab ids; a page slot is `key={tab id}`), and a tab's page memory (`pageState`) by tab and history entry (H7), so neither ever keyed on the parameters and neither changes: two tabs of one page with different parameters are two slots with a Body each and a change in one leaves the other as it was (a test and the browser run show it). What changed is only the key INSIDE a tab's slot, from the place to the page, for a custom page. A page the keep-alive cap lets go is drawn from scratch with the tab's current route.

## Choices to confirm

1. **`setParams` is required on `CustomPageContextV1`** (host-filled, as `connections` is), so a plugin's own test double of the context needs it; optional would make every call site write `?.`.
2. **A `setParams` call that holds a non-text value or a `connection` member is ignored whole, with a console line**, rather than cleaned: a half-applied route would be harder to find than a call that did nothing and said why.
3. **The sidebar hook is told the route's parameters for every kind of page**, not only custom pages (a list page's and an overview page's own hooks are still told none: what an address adds to a route to them is no identity they read). A detail page's parameters are its object's.
4. **`expanded` is applied once per group, when the tree first has it on screen**, not only when the tree mounts: the connections of a landing arrive after the first answer of the hook, so a mount-only rule would never open a group that only exists once they are read (the browser run checks this case). The record the window keeps of a tree gained `seeded`.
5. **`ValuePicker` already matches the mock, so it is unchanged.** The mock's multi-select trigger (`core.js:1811`, run in Chromium with `H.valuePicker`) says `All platforms` for `{ mode: 'all' }`, `1 selected` for one value, `2 selected` for two and `None selected` for an empty set: it never says the one value's label, and the kit says exactly that (`ValuePicker.test.tsx` holds `1 selected`). A comment on the summary line says why, so nobody "fixes" it. If the owner wants the label for one value, that is a change from the mock.
6. **A `pluginScope.label` of its own makes the navigator another tree for the window's memory of open groups** (the tree is keyed by the rail entry and the label). That is right (it is another list); a plugin that gives only `title` keeps one tree.

## Checks (once, after the last edit; clean environment, `uptime` load average 5 to 9 at the start of each)

- `pnpm --filter @omniviewdev/kit run refresh`, then `verify`: 125 files, 3,101 tests (+1, DataView), generate check, stylelint, build, dist check and API report (unchanged): exit 0.
- `tsc -p tsconfig.app.json`, `tsc -p tsconfig.test.json`, the kit's `typecheck`: exit 0.
- `eslint ui-next packages/kit --report-unused-disable-directives`, `pnpm lint:ui-policy`, `pnpm lint:css`: exit 0.
- Full root `pnpm test`: 463 files passed, 1 skipped; 10,455 tests passed, 3 skipped (KL5's run: 457 / 10,147). `node --test scripts/react-compiler.test.mjs`: 13 of 13. No Go touched, so no Go lint.
- Kit probe (`env -i HOME PATH FONT_DELAY_MS=40 node packages/kit/probes/kit-probe.mjs`, the kit rebuilt with `OMNIVIEW_UI=next` first; `uptime` before it: load averages 7.26 7.05 5.93, after it 3.06 5.11 5.36, so a timing in it proves no budget): exit 0, "no difference from the mock, no failure": 148 button measurements with 0 differences in each engine at each viewport (1440 x 900 and 1030 x 720, which the probe still runs), 225 theme state checks at 1440 x 900, glyph geometry and status paints as before. It is run because `DataView` and the `ValuePicker` comment changed.
- New tests: `Tree.test.tsx` (3: opens at mount and tells the host; opens once when a later answer brings it and the user's choice wins; not opened again from the window's memory), `core/tree.test.ts` (2), `PageHost.test.tsx` (1: `pageKey`), `admit.test.ts` (the `pluginScope` table, its admission, `expanded` kept by `openable`), `PluginHost.landing.test.tsx` (8 for the Body in place: `setParams` replace, push with Back and Forward, a link and a sidebar leaf, two tabs, another page draws again, a call that is not text, a call that names what the page has, a page of a connection keeps its connection; 1 for the hook's parameters, the selected entry and the group that starts open; 2 for `pluginScope` and its fallback), the fixture's `landing.test.tsx` (2 new, 2 changed), `DataView.test.tsx` (1). Negative controls run and undone: no `pageKey` in the host fails exactly the four Body-in-place tests; the hook told `NO_PARAMS` fails the hook test only; `sidebarOf` ignoring `pluginScope` fails the two `pluginScope` tests only; a tree that does not remember `seeded` fails the memory test only; with no implementation the other two Tree tests fail; `DataView` without the pass-through fails its one test.

## Browser (real Go host, `OMNIVIEW_UI=next task build:server`, the fixture written with the landing variant, WebKit and Chromium at 1440 x 900)

29 of 29 checks in each engine (load average at the start 8.9 Chromium, 8.1 WebKit). The landing's sidebar is `Seam Connections plugin navigation` headed `Plugin` (on a connection's page `Seam Connections navigation`, `Connections`, and the plugin's words again when the landing tab is shown); the Connections group, which arrives after the tree, opens by itself. After typing `abc` in the landing's search: a filter through `setParams` (push), the order through `setParams` (replace), a sidebar leaf (it carries the order the hook now sees), Back and Forward each keep the typed text AND the very same input element (a tag set on the DOM node), and the focus stays on the chip pressed; the sidebar's current row follows (Needs attention stays selected when the order is added, which needs the hook's parameters); Back after a replace is one step; closing the group is not undone by the next answer; a second tab of the landing keeps its own state and parameters beside the first; going to the other page and back draws the landing from scratch (text gone, new element); a reload restores the filter and the order, selects the entry that carries both, and the group starts open again; no page error and no console error.

## Not verified

- The native WKWebView and Windows; the Pods cluster check (`scripts/ui-next-pods`) and the real plugin; the seam check (no scenario opens the landing variant); the shell, strip, rail, table, fonts, tooltip and detail probes (the page host's default key and the tree without `expanded` are as they were); a connection switch on a page of scope `connection` in a real engine (jsdom only: `pageKeyOf` includes the connection, so it draws again as before); the hook's parameters with a navigator of hundreds of leaves; a screen reader on the strip and the order control.
- A group that says `expanded` and sits inside a group the user opens later is covered by `startingOpen`'s unit test and not in a browser. The kit probe ran because kit parts changed; the other probes did not.

## What the plugin should now do (Kubernetes, `ui/src/landing/`)

- `go.tsx`: delete `useGo`, the hidden `Link`, `anchor`, the module-level `moved` and the focus-return effect (the Body is no longer redrawn, so the focus stays on the control that was pressed); call `context.setParams(paramsOf(place), { history })` from the strip and the facets (the strip is a navigation: `push`; a facet may `replace`). The host does nothing for the place the tab is at, so `samePlace` guards nothing and can go. Keep `rememberedPresentation`/`rememberPresentation` only if the presentation must survive a keep-alive eviction; it need not survive a filter any more (move it into the page's state).
- `place.ts`: `placeOf` and `paramsOf` stay; its header comment ("draws the page again, from scratch") is no longer true, and a search is no longer lost on a move (the page's state stays), so the search can stay in state through every move.
- `navigator.ts`: read `route.params` in the hook and give each state entry the facets the page has (`paramsOf({ scope, platform, region })`), so choosing a state keeps them and the selected entry is the one whose parameters are the page's: the workaround that showed the strip's entry only while no facet is chosen can go. Put `expanded: true` on the Connections group (it arrives after the first answer: that works). In `entry.ts`, `sidebar.pluginScope = { title: 'Connections', label: 'Kubernetes connections' }` is the mock's wording for the landing (`k8s-connections.js:952`); `title: 'Resources'` and `label: 'Kubernetes resources'` stay for a connection's pages. A plugin test double of `CustomPageContextV1` needs `setParams`; vendor the host at the commit that has this (`hack/vendor-host.sh`).

## Dev tools

- `/tmp/kl7/verify.mjs` (scratch, not committed): builds the connections process, writes the landing variant into a temporary state root, starts `bin/Omniview-server` (`OMNIVIEW_CHANNEL=feature-ui-next`, a free port, a temporary `HOME`) and drives WebKit and Chromium with Playwright; run it from the repository root (the fixture's build resolves `babel-plugin-react-compiler` from the working directory); `ENGINES=webkit|chromium`, shots in `/tmp/kl7/shots`.
- `/tmp/kl7/mock-picker.mjs` and `/tmp/kl7/mock-server.cjs` (scratch): the mock's `server.js` is CommonJS under a `"type": "module"` package, so a `.cjs` copy serves it; the script runs `H.valuePicker` in Chromium and prints the trigger's text for each selection.
- The fixture's landing variant is a dev tool too: written only on request, so no scenario sees it.

## Backend catalog

None required by this slice.
