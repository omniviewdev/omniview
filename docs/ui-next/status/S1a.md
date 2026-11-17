# Status: S1a (the tab and open model of the shell: logic and tests, no UI)

- Agent: TabModel (S1a)
- Goal: the framework-free tab and open model of the real shell, in `ui-next/shell/core/tabs/` (new): tab identity keyed by a plugin-agnostic route, titles `{name} · {Kind}` with the shortest distinguishing qualifier, smart open, same-tab / new-tab / background open, per-tab history, close and reopen, pinned and preview, an immutable snapshot with subscribe and per-slice selectors, a versioned serialisable state with `migrate`, and keep-alive as derived state with a cap. Not wired to any component. Oracle: the 99 checks of the design lab's `tests/shell-model-harness/R2Store/unit.cjs`.
- Worktree: `~/Repos/omniviewdev/worktrees/ui-next/s1a-tab-model`
- Branch: `ui-next/s1a-tab-model`
- Base: `origin/main` 19720e3a
- Owns: `ui-next/shell/core/tabs/**` and this file. Touches no component, no kit file, no `TRACKER.md`, no `AGENTS.md`.
- PR: see the pull request of this branch (ready, not merged)

## Log

- 2026-11-17: worktree from `origin/main` 19720e3a; `pnpm install`, `task packages`; baseline `next` bundle measured before any change (entry 609,412 B, 190,702 gzip; loader 16,090 B; `jsx-dev-runtime` 650 B).
- 2026-11-17: read AGENTS, shell README and core, optimisations 7 and 11, ch16 C, D, K, L and M, the mock's `shell-core.js` (tab and window model, 1126-2360; session 2651-2776) and the harness. The harness runs the mock's own `shell-core.js` in a vm: 99 cases (92 `test`, 7 `atest`), 98 green and 1 red against the mock as it stands (`K4: the plugin world is one fixture`, a plugin-world fixture, out of scope).

## The oracle: what became of the 99 checks

`tests/shell-model-harness/R2Store/unit.cjs` of the design lab runs the mock's own `shell-core.js` in a vm and holds 99 checks (92 `test`, 7 `atest`); the file's name list is the order below. Against the mock as it stands 98 pass and one fails (case 75, the plugin world). Counted here: **47 ported whole, 16 ported in part, 36 out of scope** (total 99). The TypeScript tests are in `ui-next/shell/core/tabs/*.test.ts` (141 tests); they port the assertions, not the mock's API: a page-driven `go()` became `navigate` and `replace`, a promise from the guard became a `confirm` result, `announce` became a result the caller words. Out of scope means one of: windows and split panes (no window kind exists, AGENTS "Out of scope"), the mock's page-model seam, the plugin world and lab, a menu or palette view model, the command registry, health and operations, the panel and layout, DOM concerns (IME, focus).

| # | line | case | outcome | where, or why |
|---|---:|---|---|---|
| 1 | 74 | plugin registry: validation, ownership, conflicts, audit | out | plugin admission is `ui-next/plugins/contract/admit.ts` (N19a); the model takes `Contributions` |
| 2 | 91 | health derivation (S88) | out | plugin health is not built; the model reads `Contributions.availability` |
| 3 | 113 | availability (S65) | in part | `open.test` availability: refused with its reason, degraded opens, unknown plugin refused; the health words and glyphs are the health slice |
| 4 | 137 | seed: one window, one pane, Home, invariants | ported | `open.test` "the strip at the start" (one strip) |
| 5 | 147 | smart open: dedupe, navigate in place, new tab for another plugin | ported | `open.test` smart open |
| 6 | 173 | smart open respects scope | ported | `open.test`; the default scope comes from `Contributions.complete` |
| 7 | 187 | dispositions: here, new, background, window; aliases | ported | `open.test`; `window` is returned as a request; the aliases `open` and `tab` are the old core.js vocabulary and are not kept |
| 8 | 220 | singleton tabs: precedence, duplicate refused | ported | `open.test`; other-window parts out (no windows) |
| 9 | 251 | identity none | ported | `open.test` |
| 10 | 261 | preview tabs | ported | `open.test` incl. the settings |
| 11 | 300 | a new tab goes after the active tab, never into the pinned zone | ported | `open.test` |
| 12 | 314 | how(event): modifier mapping | ported | `open.test` `dispositionOf` (the platform is an argument) |
| 13 | 332 | close: right neighbour else left; closed list newest first | ported | `close.test` |
| 14 | 350 | close the last tab opens Home; of another window closes it | in part | Home and the closed list in `close.test`; windows out |
| 15 | 377 | reopen: newest first at the old index; pinned zone | ported | `close.test` |
| 16 | 402 | closing many reopens in the original order | ported | `close.test` |
| 17 | 416 | close variants skip pinned tabs | ported | `close.test` |
| 18 | 438 | guard: a dirty draft asks once (async presenter) | in part | `confirm` and `confirmed` in `close.test`; the presenter and `draft.save()`/`discard()` are the UI |
| 19 | 474 | guard: a batch asks once; navigation, reload, back, window | ported | `close.test` (window out) |
| 20 | 499 | guard: no presenter means cancel; drafts clear on close | ported | unconfirmed is `confirm`, never a change; `setUnsaved` |
| 21 | 513 | history: pushes, replaces, Back and Forward, switching tabs | ported | `history.test` (page-driven `go()` became `navigate` and `replace`) |
| 22 | 552 | history is capped at 50 | ported | `history.test` |
| 23 | 564 | the closed list keeps 25 | ported | `close.test` |
| 24 | 578 | pin and reorder | ported | `arrange.test` |
| 25 | 604 | split, move to the other pane, unsplit | out | panes: the new shell has one strip and no second pane |
| 26 | 650 | unsplit keeps pinned tabs first | out | panes |
| 27 | 662 | split minimum sizes (S4a) | out | layout and panes |
| 28 | 680 | move to window and tear off keep the tab id | out | windows (AGENTS: no new window kind); ids are strings that survive a move |
| 29 | 726 | windows: names, rename, focus, close and reopen | out | windows |
| 30 | 750 | next, previous, goto, last | ported | `arrange.test` (the split-window part is out) |
| 31 | 770 | activate: outgoing state stored, scroll restored, visible hooks | in part | page state kept per tab and the no-op activate in `arrange.test`; scroll, render and `onVisible` are the page host's |
| 32 | 795 | activate waits whole during an IME composition | out | DOM: the page host defers a call; the model is a synchronous state change |
| 33 | 828 | navigation during a composition | out | DOM |
| 34 | 837 | closing the current tab loads the neighbour; the closed entry keeps page state | ported | `close.test` |
| 35 | 849 | duplicate | ported | `close.test` |
| 36 | 867 | tab state derives from plugin health | in part | tabs keep route and state through an availability change (`store.test`); ready, loading, failed are the health slice |
| 37 | 884 | closePlugin | ported | `close.test` |
| 38 | 895 | setScope: key, title, history entry follow | ported | `history.test` (`replace`, and `navigate` with `history: replace`); the 24-character label in `face.ts` |
| 39 | 909 | openNew builds the New tab menu | out | a menu view model, not the tab model |
| 40 | 925 | operations drive busy and attention | in part | attention set and cleared on show (`arrange.test`); busy and operations out |
| 41 | 955 | a plugin whose functions throw never breaks the model | ported | `open.test`, `persist.test` |
| 42 | 977 | a moved preview tab becomes permanent | in part | pin, move and keep (`arrange.test`); panes out |
| 43 | 1001 | strip events apply to the model | out | event wiring is the UI's; the store exposes the operations |
| 44 | 1034 | fuzz: 4000 random operations keep every invariant | ported | `fuzz.test`, with the saved session checked every 50 steps |
| 45 | 1063 | live model without the frame | out | the mock's page-model seam (`S`) |
| 46 | 1090 | live model: a second tab swaps S | out | `S` |
| 47 | 1107 | page state that is not plain data does not break a switch | ported | `arrange.test` |
| 48 | 1119 | live: a host page has no scope | in part | a page that says no scope has none (`identity.test`, `open.test`); the `S` parts out |
| 49 | 1163 | live: a page of another plugin keeps its scope | in part | an entry carries its own scope (`history.test`); `S` out |
| 50 | 1182 | restore drops the scope a host tab was saved with | ported | `persist.test`: a tab is described again from its plugin |
| 51 | 1199 | tooltips do not repeat the plugin name | ported | `identity.test` |
| 52 | 1208 | session persistence: round trip | ported | `persist.test` (windows and split out) |
| 53 | 1245 | deep link at load | in part | open after restore adopts or creates, never replaces another tab (`open.test`); the URL is the shell's |
| 54 | 1282 | a corrupted, foreign-version or unusable store falls back | ported | `persist.test` reasons; the warning is the shell's |
| 55 | 1307 | a damaged session is repaired | ported | `persist.test` |
| 56 | 1333 | plugin restore(route) may rewrite or drop a saved tab | ported | `persist.test` |
| 57 | 1346 | panel state persists per window | out | the panel |
| 58 | 1363 | stale layout of windows that are gone | out | layout |
| 59 | 1376 | layout paths persist per window and plugin | out | layout |
| 60 | 1417 | mutation fuzz: 600 damaged sessions | ported | `persist.test` |
| 61 | 1468 | commands: the chords are live | out | command registry and keymap |
| 62 | 1516 | no-op operations write nothing | ported | `store.test` |
| 63 | 1525 | detached models do not touch the live state | in part | two stores share nothing (`store.test`); the live and detached architecture is the mock's |
| 64 | 1547 | the model keeps one owner per name | out | the mock's global namespace |
| 65 | 1555 | New tab menu data | out | a menu view model |
| 66 | 1577 | view(): the items the strip needs; destinations for tab rows | in part | `selectors.strip` (`store.test`); close labels are copy, destination rows are the palette |
| 67 | 1598 | K1: an open singleton is activated and pointed | ported | `open.test` reveal requests |
| 68 | 1636 | K1: a destination not open yet makes the tab | ported | `open.test` |
| 69 | 1648 | K1: Background applies the route to a clean singleton | ported | `open.test` |
| 70 | 1674 | K1: a singleton with unsaved changes | ported | `open.test` |
| 71 | 1692 | K1: Window moves the singleton; IME delays | in part | `window` with `existing` (`open.test`); IME out |
| 72 | 1711 | K1: a non-singleton keeps "go where it already is" | ported | `open.test` |
| 73 | 1726 | K3: a dotted path persists under its own key | out | store persistence infrastructure |
| 74 | 1761 | K3: subscribe takes a segment array | out | same |
| 75 | 1775 | K4: the plugin world is one fixture (the case red against the mock) | out | plugin world |
| 76 | 1805 | K4: set merges one record | out | plugin world |
| 77 | 1847 | K4: user-changeable members persist | out | plugin world |
| 78 | 1872 | K5: a fresh profile is calm | out | lab scenarios |
| 79 | 1909 | K5: a scenario leaves the signals other files wrote | out | lab |
| 80 | 1941 | K5: ?lab=1 | out | lab |
| 81 | 1946 | view(): host flag, the three facets, accounts, peers | in part | the facets and qualifiers (`identity.test`); an account is an AWS concept, peers need panes |
| 82 | 1978 | X2: Shell.health.describe | out | health vocabulary |
| 83 | 2005 | X3: Shell.msg | out | copy |
| 84 | 2016 | X7: a host page has an empty path | ported | as data: `identity.test` (Settings has no tip) |
| 85 | 2024 | CO-20: one tab per singleton key everywhere | in part | open, reopen, duplicate, Back, restore and the fuzz keep one; windows out |
| 86 | 2047 | CO-20: a saved session is repaired, never discarded | ported | `persist.test` |
| 87 | 2076 | CO-20: Shell.lab.reset | out | lab |
| 88 | 2101 | summary: the plugin world | out | plugin world |
| 89 | 2108 | CO-20 fuzz: 3000 operations over singletons | ported | `fuzz.test` |
| 90 | 2142 | CR1: opening in a new window announces | out | windows; the `window` request is tested |
| 91 | 2150 | CR3: reopen skips a closed tab of an unavailable plugin | ported | `close.test` |
| 92 | 2175 | CR3: an uninstalled plugin is unavailable by name | ported | `close.test` |
| 93 | 2186 | CR2: a deep link onto a restored singleton asks its page once | ported | `open.test` |
| 94 | 2211 | CR4: ?lab=1 survives URL writes | out | lab |
| 95 | 2235 | CR5: no compat shim is left | out | true by construction: the model has none |
| 96 | 2249 | CR2: start-up waits for AWS.start() | out | the mock's boot order; the analogue (describe again when a plugin arrives) is in `store.test` |
| 97 | 2260 | facets: the parent crumb of an item page | ported | `identity.test` |
| 98 | 2270 | a tab moved by a strip command keeps focus | out | focus is the UI's |
| 99 | 2291 | QT-09: attention carries the record's message | in part | the attention flag (`arrange.test`); the reason text belongs to operations |

## Log (continued)

- 2026-11-17: tests first. The suites were written before any source file: `open`, `close`, `history`, `arrange`, `identity`, `store`, `keepAlive`, `persist`, `fuzz`, `perf` and `purity` tests, with a fixture world (`testing.ts`: `host`, `cloud`, `stack`, `access`, `broken` and two plugins whose pages read alike). Red run, before the model existed: `pnpm test ui-next/shell/core/tabs` failed 10 of 11 files (nothing to import) and 2 of the 3 `purity` tests (no sources to scan).
- 2026-11-17: model written to pass them: `json`, `route`, `face`, `plugins` (the guarded seam), `identity`, `keepAlive`, `state`, `resolve`, `open`, `close`, `arrange`, `persist`, `saver`, `disposition`, `selectors`, `store`, `index`. First green run: 135 of 141; the six failures were three wrong expectations in my tests, one real gap (Back, `navigate` and `replace` could put a second tab on a singleton page, found by the fuzz; fixed in the model), one identity that changed when only a title did (`refresh` rebuilt `location`; fixed), and the mounted list not frozen (fixed).
- 2026-11-17: exit tests run (below). README written. Not wired to any component.

## Result

| Check | Result |
|---|---|
| Ported harness cases | 47 whole, 16 in part, 36 out, of 99 (table above) |
| `pnpm test ui-next` | 40 files, 698 tests green; the model's are 11 files, 141 tests |
| `pnpm exec tsc -p tsconfig.app.json --noEmit` and `tsconfig.test.json` | clean |
| `pnpm exec eslint ui-next packages/kit --report-unused-disable-directives` | clean |
| `pnpm lint:ui-policy` | clean |
| `pnpm --filter @omniviewdev/kit exec vitest run eslint` (vocabulary guard scans `ui-next/`) | 187 tests green; the new directory holds no plugin word |
| `next` bundle (`node scripts/ui-next-bundle.mjs`) | identical to `origin/main` 19720e3a: entry 609,412 B (190,702 gzip), loader 16,090 B (6,327), `jsx-dev-runtime` 650 B (430): **+0 B**, 0 modules of `shell/core/tabs` in the build (nothing imports it) |
| 500 open tabs (`perf.test.ts`) | 500 opens about 15 ms, 500 shows with the strip read after each about 1 ms, 500 closes about 19 ms, about 35 ms in all (macOS arm64, Node 26, jsdom, after a warm-up run); the test's budget is 2,000 ms and guards a quadratic loop, not a slow machine. A second test asserts that an open, a navigation, a show, a pin and a close ask the plugins the same number of questions at 5 tabs and at 500 (a show, a pin and a close ask none) |

Run from the worktree root; the suite takes about 1.2 s.

## What the mock leaves open, and what this step did

1. **Keep-alive (the owner's call, see the next section).** The mock keeps every shown page.
2. **Scope is the plugin's, not the host's.** The mock treats `scope` as a host concept and inherits the active tab's scope for a destination that names none. Here the route is `{ plugin, contribution, params }` only; the scope a tab shows comes from `Contributions.describe().scope`, and "inherit" is `Contributions.complete(route, { from })`, which the plugin implements. Decide when the plugin contract (N19) gets `describe` and `complete`.
3. **Which pages are singletons** is the description's `singleton` flag (the mock hard-coded Settings, Plugins and Developer Tools). A singleton's key ignores its parameters.
4. **`how: 'window'` is handed back**, with `existing` when a singleton already holds the page; no state changes. The shell decides what it does until a window kind exists.
5. **S24 says a drag makes a preview permanent; the mock does it only for moves between panes.** Here any reorder does, and so do pin, keep and a second navigation.
6. **Back, Forward and `navigate` onto a singleton page that is open in another tab show that tab and leave this one where it is** (S26: one per app). The mock lets a second one through; the fuzz found it. `replace` into one is refused.
7. **A navigation to the route the tab already shows pushes no history entry** (the mock pushes a duplicate).
8. **Reopen**: a closed tab whose plugin drops it on restore is removed from the list, and an unnamed reopen goes on to the next one (the mock stays stuck on the first). `restore` that throws leaves the tab as saved; one that answers nonsense drops it.
9. **A tab whose plugin says nothing yet is kept**, with the face it was saved with, and described again when `Contributions.subscribe` fires. The shell may instead wait until plugins settle before restoring (N19a chooses the first ready plugin once every plugin has settled); the model works either way.
10. **Page state is never saved.** S32 says it is not "unless the plugin opts in" and defines no opt-in; none is built. The closed-tab list is not saved either (neither does the mock).
11. **The All tabs list is the strip**: the chapter names no overflow menu of hidden tabs (the strip scrolls, S53), and the pinned zone always leads, so "pinned first" needs no sort. A recency list for a switcher or the palette's Recent (S73) is not built.
12. **Not enforced by the model:** a title of at most three words (S17; admission's job). Enforced: the scope label at 24 characters, at most 4 facets, 50 history entries, 25 closed tabs.
13. **Saving**: 400 ms debounce and flush on close (HSH-25); the mock used 200 ms. Where the document goes (the Wails `SaveState`) is the shell's.
14. **Default failure hook** is the console (`onError`); the shell should pass its logger.
15. **`recent` was dropped** in favour of `mounted` (an earlier draft derived the mounted pages from a recency list, which brought an evicted page back when a neighbour closed).

## Open question for the owner: keep-alive

The old shell mounts a tab the first time it is shown and keeps it mounted, hidden, until it closes, with no cap (HSH-21); nothing measures what N hidden pages cost (optimisations.md section 7, and 12). The model exposes the policy as data so the UI layer can decide, and ships a **default that is a placeholder**: `{ cap: 5, keepUnsaved: true }`, one page on screen and four hidden, four being the number of source views the runtime lets linger for hidden and closed pages (RTM-05). To decide:

1. How many hidden pages may stay mounted, and which leaves first (here: least recently shown; `cap: null` is the old policy).
2. Whether a hidden page keeps its effects (React `Activity` releases them) or is unmounted; the model only says which pages are in the list.
3. Whether a tab with unsaved changes is exempt (here: yes, and it does not count toward the cap), and whether pinned tabs should be.
4. Whether raising the cap should bring back evicted pages (here: no; they mount when shown).
5. Where a tab's scroll offset lives: here `setPageState`, plain data in the tab, never saved; a page host must store it before its page unmounts.

## Not verified

The model is not wired to a component, so nothing was run in the real host (browser server mode or WKWebView). Not run: the full `pnpm lint` and `pnpm test` (only `ui-next`, the kit's lint guards and `lint:ui-policy`), `node --test scripts/react-compiler.test.mjs scripts/ui-flavour.test.mjs`, a differential run of random operations against the mock's own model (the harness cases were ported and read, not executed against both), Windows and Linux. Timings are from one machine.

## Files

`ui-next/shell/core/tabs/`: `README.md`, `types.ts` (the contract), `index.ts`, and the sources `json`, `route`, `face`, `plugins`, `identity`, `keepAlive`, `state`, `resolve`, `open`, `close`, `arrange`, `persist`, `saver`, `disposition`, `selectors`, `store`; `testing.ts` (test support) and the eleven `*.test.ts`. The shell's `README.md` paragraph "What this leaves open for the tab-system slice" is the other agent's file; it should point here when the tab strip is wired.
