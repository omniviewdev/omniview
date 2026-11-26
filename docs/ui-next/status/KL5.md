# KL5: the plugin's sidebar on its landing (generic tree features)

Goal: KL2 hid the sidebar on a page read in no connection (the landing). The design mock shows a navigator there (All, Recent, Connected, Needs attention with counts, and a collapsible group of the connections with a coloured glyph and a warning or error badge). Owner decision: the PLUGIN supplies those nodes through its sidebar contribution; the host adds the generic tree features (VS Code tree-view style) and holds no connection-organisation logic.

- Worktree: `~/Repos/omniviewdev/worktrees/landing-sidebar`
- Branch: `feat/landing-sidebar` (from `origin/main` d1b735cb6). Nothing committed, pushed or opened as a PR: the lead does that.

## What changed

Contract (`ui-next/plugins/contract/v1.ts`, minor and additive; the rule is written at the head of the file, on the custom page's terms):

- `SidebarNodeV1` gains `page?: string` (the page a leaf opens when its `id` is not that page's key), `params?: Readonly<Record<string, string>>` (the route parameters it opens it with) and `connection?: string` (a leaf that opens one of the plugin's connections), and, from the shell's `ShellTreeNode`, `status?: { role: StatusRole; label: string }` and `tone?: DataColor`. A leaf opens one thing; a group opens nothing.
- `SidebarContextV1` gains `connections: ConnectionsHostV1` (the handle a custom page gets; the same object for as long as the plugin is).
- `CustomPageContextV1`: `context.route.params` is the route's text parameters (it was always empty).

Host:

- `contract/sidebarTargets.ts` (new): the one place that reads a leaf: `readTarget` (what it opens, or the sentence that says what is wrong), `dressProblems` / `dressed` (a `status` and a `tone` the shell can draw; the rest taken off the row), `currentOf` (which leaf is the page on screen), `leafOf`. Never throws.
- `contract/admit.ts`: the skeleton's leaves are checked through it (`page` names a page the plugin has, a leaf opens one thing, `status`, `tone`); `openable` keeps the leaves that open a page with parameters or a connection and takes off what the shell cannot draw.
- `host/PluginHost.tsx`: the sidebar hook is given `connections`; on a page read in no connection the hook's answer IS the sidebar (no skeleton under it; none drawn while it answers none); that answer is kept apart from the plugin's pages (`pluginScopeNodes`) so the palette still lists the pages; a press reads the leaf (`choose`): a page with its parameters, or a connection through the host's existing opener (`subjectOpener`, source `sidebar`); a custom page is given its route's parameters.
- `host/palette.ts`: a leaf with parameters is a row for that place (one row for each place); a leaf that opens a connection is no row (the palette lists connections itself).
- `shell/registration.ts` (`ShellRowStatus`, `status`, `tone`), `shell/Tree.tsx`, `shell/Tree.module.css`: the badge and the colour; the trailing columns are now the count, the badge and the disclosure, each its own (a group with a count and its chevron lay on one column before).
- Fixture: the landing variant's sidebar hook answers a navigator (`fixture/src/landing-navigator.ts`: All, two filters with parameters and counts, a group of connection leaves with a colour and a badge on those that need a look); the landing reads `context.route.params.filter`.
- Docs: `plugins/README.md` (rules 11 and 13, a section for plugin authors, table rows), `shell/README.md` (two rows).

## Decisions to confirm

1. **`page` is a third member.** Two leaves that open one page with different parameters cannot both be called by its key (ids are the tree's identity), so a leaf needs its own `id` and a way to name the page. It is in the lead's text only implicitly ("opens the node's page").
2. **`SidebarContextV1.connections` is required**, as `open` was (Q2a): host-filled, a plugin that reads it on an older host tests for it. A plugin's own test that builds a `SidebarContextV1` has to give it.
3. **The navigator is kept apart from the plugin's pages.** The host kept one published list for each plugin, which the palette lists pages from; a navigator is not a list of pages, so what a hook answers for a page read in no connection is `pluginScopeNodes`. Without it the palette would list only the navigator's entries while the landing is on screen.
4. **Which leaf is selected**: the leaf with the page and the very parameters on screen; else the page's leaf that names none (a page opened with a parameter nobody listed; an object's page selects its list, whose parameters are none); else none. A leaf that opens a connection is never selected. For the bare landing a plugin gives "All" as a plain leaf whose `id` is the landing's key.
5. **The badge is the kit's `Status` in a 16 px box that clips its word** (the kit draws a state as glyph and word; no kit change, no second role-to-glyph table). The word stays in the row's text (the row is named "Label 3 Needs sign-in") and is the glyph's tip (an attribute for the window's one tooltip, no listener of the row's own).
6. **A connection leaf reuses `subjectOpener`** (Problems and Operations rows open a connection with it): `go`, which shares a start that is under way, and an error notice `Couldn't open <name>` with the host's sentence when the start or the open fails.
7. **A params-only change draws the page again from scratch** (the tab's key holds the parameters and `PageHost` keys the page by it; measured: mount, unmount, mount). The Body's own state does not survive it; its data (the host's store) does.
8. **Groups start closed** (there is no initial-open member and none was asked for), and the sidebar's title and landmark name stay the contribution's own (`SidebarV1.title`, `label`): a plugin cannot retitle its sidebar for the landing.
9. **The tab of a landing with a filter reads like the one without** (a custom page's face is its definition's); two tabs of the landing with different parameters are told apart by nothing.

## Optimisations read (docs/ui-next/optimisations.md)

LIB-11, LIB-12, LIB-15 (the tree store: a row renders itself, rows are `visibleRows`, O(visible rows)) and MNR-T6 (no per-row menu or tooltip state, hover-only controls are not mounted per row): the tree is unchanged in that; a row that has no badge and no tone is the row it was (no node, no attribute), the badge costs one attribute for the delegated tooltip, the tone one data attribute the stylesheet reads. `currentOf`, `openable` and `choose` are O(leaves) and allocate only a small result for each leaf (the host already did one pass per render).

## Checks (once, after the last edit, 2026-11-25)

- Kit `verify`: 125 files, 3,100 tests (the vocabulary guard among them), build, dist check, API report: exit 0.
- `tsc -p tsconfig.app.json`, `tsc -p tsconfig.test.json`, the kit's `typecheck`: exit 0.
- `eslint ui-next packages/kit --report-unused-disable-directives`: exit 0, no warning. `pnpm lint:ui-policy`, `pnpm lint:css`: exit 0.
- Full root `pnpm test`: 457 files passed, 1 skipped; 10,147 tests passed, 3 skipped. `node --test scripts/react-compiler.test.mjs`: 13 of 13.
- Probes, locally, `env -i HOME PATH FONT_DELAY_MS=40`, the kit rebuilt with `OMNIVIEW_UI=next`: shell probe, rail probe and strip probe (it holds the count slot's arrival, whose columns I changed): "no failures" each. `uptime` before them: load averages 9.15 7.53 5.90 (shell), 6.57 7.05 5.79 (rail), 6.59 7.03 5.81 (strip): the machine was shared, so a timing in them proves no budget.
- New tests (19 cases in 15 `it`s, the five refusals one table): `sidebarTargets.test.ts` (what a leaf opens, five refusal sentences, the dress, the selected leaf), `admit.test.ts` (skeleton admission, `openable`), `Tree.test.tsx` (badge, tone), `palette.test.ts` (parameter and connection leaves), `PluginHost.landing.test.tsx` (the navigator and the hook's context, a parameter leaf, a connection leaf, a failed open, a saved window), `fixture/src/landing.test.tsx` (the fixture's navigator is valid). Negative controls (run, then undone): a press that drops the parameters fails the parameter test only; a custom page given no parameters fails the two tests that read them; the skeleton drawn on the landing fails the KL2 test that already held it.

## Browser (real Go host, `OMNIVIEW_UI=next task build:server`, the fixture written with the landing variant, WebKit and Chromium at 1440 x 900)

56 of 56 checks (28 each; load average 5.1 at the start): the navigator shows on the landing (the plugin's own label, no skeleton, one tab stop, the rail entry current, no lane); counts All 2, Connected 0, Needs attention 0 until a connection starts; Connected opens the landing with its parameter in the same tab and is the selected leaf (All is not); All opens it bare; ArrowDown moves the focus and selects nothing, Enter opens a leaf with its parameter, ArrowRight opens the group and enters it, End and Home jump; a connection leaf starts the connection and opens its home in a new tab beside the landing, and on that page the skeleton and the lane are back; with the fixture's `connection-mode` = `unauthorized`, pressing south tells `Couldn't open south` (the host's sentence) and opens no tab, then south's row says "south Needs sign-in" with a 16 px warning glyph at the row's end inside it, Needs attention counts it, the glyph is amber (`--ov-warning-fg`), north's green (`--ov-success-fg`), an untoned entry keeps the plugin's accent; hovering the badge opens the tooltip with its label; axe on the sidebar: 0 violations; a reload restores the landing at its parameter with that leaf selected; no page or console error but the 422 the host answers a failed start with. A scratch variant gave the group a count and a badge: count, badge and chevron are three columns of a 24 px row in both engines.

## Not verified

- The Pods cluster check (`scripts/ui-next-pods`) and the seam check; the kit, table, fonts, tooltip and detail probes (no file they read changed); the native WKWebView and Windows.
- The real Kubernetes plugin (it has not adopted this; see below) and a navigator of hundreds of connection leaves (the tree is not windowed; its rows are what they were).
- 1280 x 800 and the other themes on the live host (the probes run both viewports on the fixtures); a screen reader reading the row name.
- Keyboard focus after a connection leaf opens a tab; what the sidebar does while the plugin's list of connections is still unread (the fixture holds the counts as `null`).

## How a plugin adopts it

Vendor the contract and kit at a host commit that has this (`hack/vendor-host.sh`), then in the sidebar hook: for a page read in no connection answer the navigator from `context.connections` (`useSyncExternalStore(connections.subscribe, connections.getSnapshot)`): a plain leaf whose `id` is the landing's key for "All", leaves with `page` + `params` + their own `id` for the filters, a group whose leaves carry `connection`, `tone` and, where a state needs a look, `status`; answer on the first render and keep the array while nothing changed; for any other page answer what it did (or `undefined`). The landing's `Body` reads `context.route.params`. A test of the plugin that builds a `SidebarContextV1` has to give it `connections`. The fixture is the working example (`fixture/src/landing-navigator.ts`).

## Dev tools

- `/tmp/kl5/verify.mjs` (scratch, not committed): builds the connections process, writes the landing variant into a temporary state root, starts `bin/Omniview-server` (`OMNIVIEW_CHANNEL=feature-ui-next`, a free port, a temporary `HOME`) and drives both engines with Playwright; `ENGINES=webkit|chromium`, screenshots in `/tmp/kl5/shots`. `/tmp/kl5/group.mjs`, `/tmp/kl5/checks.sh`, `/tmp/kl5/probes.sh` are scratch too.
- The fixture's navigator (`landing-navigator.ts`) is written only with the landing variant, on request.

## Backend catalog

None required by this slice.

## Log

- 2026-11-25: read the contract, the tree, the registration, `choose`, the tab model's keys and the session; wrote `sidebarTargets.ts` and the tree's badge and tone; host wiring; tests; the fixture's navigator; README.
- 2026-11-25: checks and probes as above; real host in both engines (56 of 56).
- 2026-11-25: a slip while cleaning up: `pkill -f bin/Omniview-server` ran once, and a process whose command line was the relative path `bin/Omniview-server` (not one of mine, which start with an absolute path) was shutting down right after; nothing of that name runs now. The owner of the host that is on screen is told (HostVerbs), and so is the lead in the final message.
