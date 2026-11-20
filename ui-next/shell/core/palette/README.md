# The command palette model

The palette's state and its rules, as pure TypeScript: no React, no DOM (`purity.test.ts` fails the build if one is imported), no timer but the scheduler it is given. Rules come from the design lab: chapter 16 section D (S63 to S73), SE1, S142, and `shell-search.js` (the mock's matcher, runner and composition, ported). **Step C1a: logic and tests only. Nothing imports this folder; the `next` bundle does not change.** The UI step draws the snapshot and wires the seam below.

| File | What |
| --- | --- |
| `types.ts` | The contract: provider, candidate, row, section, snapshot, seam, limits. |
| `match.ts`, `rank.ts` | The mock's matcher (whole 100, prefix 88, word start 76, substring 58, letters inside one word, initials), title 6 / keywords 3 / context 1, AND over the words; a bounded top-K with a deterministic tie-break (score, order, shorter title, title and key by code unit, never by locale). |
| `results.ts` | A candidate becomes a row only here: validated, copied, frozen; a row is data (label parts with ranges, tile, route or command, availability). |
| `runner.ts` | The asynchronous half: 150 ms debounce, 5 s timeout, 4 in flight, a superseded request aborted and its answer never delivered. |
| `compose.ts`, `status.ts` | Sections, caps, order, the 50-row bound, empty and no-result states; the runs of the status band, the Sources list, the footer's keys, the sentence. |
| `store.ts` | The store: one immutable snapshot, `subscribe`, `subscribeTo`, the operations, the keyboard. |
| `recents.ts`, `saver.ts` | The last eight destinations, a versioned document with `migrate` (the tab model's), repaired on read; written by the shell's saver. |
| `testing.ts` | Test support: a manual clock and the fixture. Nothing in the model imports it. |

## The provider contract (to be added to the contribution contract in the UI step)

A provider is a source of results with an `id`, the `plugin` that owns it, a section, and **exactly one** way to answer:

```ts
match(query, scope): Candidate[]                      // SYNCHRONOUS: a small set already in memory (tabs, pages, commands, settings)
search(query, scope, signal): Promise<Candidate[] | { rows, limited?, partial?, live?, message? }>   // ASYNCHRONOUS, cancellable: a set too large to hold
```

`match` returns the candidates that could answer; the model scores, filters and ranks them (a provider may return its whole list and ignore the query; it runs on every keystroke and must be cheap; at most 50,000 candidates are read). `search` does its own matching and returns the best candidates in order; the model never ranks them again, only bounds them (20 rows), checks them and groups them. `scope` is `{ plugin, chips, scope, kind }`: the plugin the palette is narrowed to, the chips under it (connection, type, resource), the kind filter. Only that plugin's providers and the host's are asked while narrowed (S69); `supports(scope)` lets a provider opt out.

A **candidate** is plain data: `id` (unique in the provider, stable: it keeps a row focused), `kind` (`tab page home scope type resource command setting tool`), `title`, `context`, `keywords`, `icon` and `tone` (the kit's `KindTile`), a `route` (and `reveal`, never part of the route) **or** a `command` (a registry id with plain `arg` and `target`, never code) **or** a `tab`, `into` (the step `→` takes inward), `unavailable` (a reason), `shortcut` (the host's chord: never invented, A9), `order`. A candidate that is not valid data is dropped and counted against its provider.

An asynchronous provider's rows always form a section of its own (`{ id, title }`, prefixed with the plugin's id): a late answer must not move a row that is already actionable (S68). A plugin's providers are registered when it loads (`registerProvider`) and withdrawn when it leaves (`removePlugin`), together with its pending requests, its rows and the chips that narrowed the search to it (PO1).

**Failure is per provider.** A provider that throws, rejects, answers what is not a list, never answers (5 s) or answers in part is contained: the others answer, the palette stays usable, and the status band says which source failed (`runs`, a Retry where retry helps; more than three fold into `+N` and the Sources list).

## Very large clusters: query on demand, not a registry of everything

The palette never holds the objects of a connection. A plugin does **not** register "every workload" as commands or entries: that is a registry whose size is the cluster's, rebuilt when the cluster changes, and ranked by the host on every keystroke. It answers `search(query, scope, signal)` instead: the question is asked after 150 ms of quiet, the request is aborted when the query moves on (the signal), the plugin returns the best 20, and the model says how many there were (`limited`: "first 20 of 5,000"). The chips narrow the question (connection, then type, then resource) so the plugin queries one list, not all of them. The same rule decides the deferred **log target picker** (decision A20: a session starts from the resource): a picker that lists every target is a registry; "Open logs" is a command row on the resource's own row (`command` with a `target`), found by the same query. Ranking stays local only for what is small and static, where ten thousand commands rank in a few milliseconds (`perf.test.ts`).

## What the snapshot says, and the rules it keeps

- **Sections** in the order Recent, Tabs, Go to, Commands, Settings, then one per plugin source; with a query the section that holds the best match leads (SE1: `cart` before Helm Charts), equal sections keep the order, rows of an earlier query do not lead. At most 50 rows, taken from the longest section one at a time; "N more in X" opens the kind.
- **Incremental merge, nothing moves under the cursor** (S71): while the user has not moved, the pre-selected row follows the best openable match; once they move (arrows, pointer) the active row is kept by id, the sections keep their order, a late section is appended after them and the rows above are the same rows (`async.test.ts`). Rows of a source that has not answered the new query stay, undimmed and inert, until it answers.
- **Kinds** All, Go to, Tabs, Commands, Settings; the first character of an empty input `# @ > /` selects one (S67); **chips** (S69) `→`, `←`, Backspace, Home, End, named; **empty** (S73): Recent without the place the user is on, then the plugin homes (suggestions when narrowed), never a row that cannot open; **no result**: `No results for "…"`, Search everywhere when narrowed, suggestions.
- **Opening** (S64): `activate(row, event)` calls the tab model with `source: 'search'` (a preview tab, the setting "Open search results"), the disposition from the modifiers (`dispositionOf`); a command runs on Enter and ignores them. Unavailable rows refuse with their reason and stay; degraded rows open their recovery page; a tab that closed since is "closed".
- **The sentence** ("4 results", "No results. 1 source didn't answer") is told to the live region once, when the results have been still for 450 ms (S86); **hints** are the real keys of the active row (S70).

## What the host wires in the UI step

`PaletteSeam`: `open` is the tab store's `open`, `activate` its `activate`, `availability` and `describe` the plugin host's `Contributions`, `announce` the live region, `run` the command registry (which revalidates). `refresh()` when tabs or health change; `record(route)` when a tab is switched to; `removePlugin` when a plugin leaves; recents are restored with `restoreRecents` and saved with `createPaletteSaver` through the session. The plugin-facing provider types join `ContributionV1` then (a `search` member beside `panel`: minor, an optional member).

## Tests, and the oracle

`match`, `rank`, `results`, `recents`, `runner` (a manual clock: a provider that takes 300 ms costs no time), `store`, `async`, `activate`, `oracle`, `perf`, `purity`. **The design lab's harness has no unit of its own for the palette**; `oracle.test.ts` lists the harness cases it ported (the modifier mapping, preview tabs, availability, the singleton reveal, a plugin that throws, the persist rules, hints only for bound commands, QA-SF-09) with file and line, and the ones it did not (the chord router, the menus, the window session) with the reason.

## Not built, on purpose

The `+` menu and All tabs (they share the row, not this step); the command registry and keymap; a live-update channel (`live` is a flag a provider reports); structural sharing of rows between snapshots (a view keys by `row.id`); the native sheet mirror.
