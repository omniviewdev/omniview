# Status: C1a (the command palette model)

**State (2026-11-19): READY FOR REVIEW, with open items below.** Logic and tests only; nothing imports the model and the `next` bundle is not changed.

- Agent: PaletteModel
- Goal: the framework-free command palette MODEL: providers registered by the host and by plugins (a synchronous `match`, an asynchronous cancellable `search`), debounce and cancellation, bounded results, an incremental merge that never reorders what the user has focused, the mock's ranking with a deterministic tie-break, versioned recents, results as data (label parts with ranges, tile, route or command), failures contained per provider, a plugin that leaves takes its providers and pending results with it, and the design note `ui-next/shell/core/palette/README.md` (the provider contract, very large clusters as query on demand: decision A20).
- Owns: `ui-next/shell/core/palette/**` (new) and this file. Nothing else.
- Worktree: `~/Repos/omniviewdev/worktrees/ui-next-c1a-palette-model`
- Branch: `ui-next/c1a-palette-model` (base `origin/main` be06aa2d)
- PR: https://github.com/omniviewdev/omniview/pull/550

## Sources read

- Chapter `research/int-ui/16-ide-shell.md` (design lab, `app/OmniviewNativeLab/frontend/mock/research/int-ui/`): section D (S63 to S73), SE1 (ranking), S142, A5, A16, A20; chapter 05 (keyboard shortcuts and command palette); `shell-search.js` (the matcher, the async runner `touch` / `start` / `pump`, `compose`, `snapshot`, the keys, recents); the audit `shell-qa-search-feedback.md` (QA-SF-06, 09, 25, 26) and the Kubernetes review pack item 30 (`cart` before Helm Charts).
- The harness `tests/shell-model-harness/` has **no unit of its own for the palette**. Its cases that the palette depends on are ported in `oracle.test.ts` (header: ported with file and line, not ported with the reason).

## Log

- 2026-11-19: worktree from `origin/main` be06aa2d, install, `task packages`; read AGENTS, decisions, the tab and panel models, the chapter and the mock.
- 2026-11-19: matcher and ranking, tests first and seen red (22 + 11), PR #550 opened as partial.
- 2026-11-19: results (candidate to row), recents (versioned, `migrate`), the runner (manual clock), each tests first and seen red; then the store, compose and status, the oracle and perf tests, the README. 207 tests in the folder, both tsc projects and eslint clean.

## What was built

`match.ts` `rank.ts` `results.ts` `runner.ts` `compose.ts` `status.ts` `store.ts` `recents.ts` `saver.ts` `types.ts` `index.ts` and their tests (`match` `rank` `results` `recents` `runner` `store` `async` `activate` `oracle` `perf` `purity`), `testing.ts` (a manual clock and the fixture), `README.md`.

## The oracle: ported and not

Ported (`oracle.test.ts`): P1 the modifier mapping of S64 (R2Store/unit.cjs:314), P2 preview tabs and the "Open search results" settings (261), P3 availability (113), P4 K1, the singleton and its reveal (1598 to 1711), P5 a plugin whose functions throw (955), P6 the persist rules, written after a delay, only when changed, flushed (ShellStore/unit.cjs:445 to 479), P7 a chord only when the host binds it (273), Q1 QA-SF-09. Also from the audit: QA-SF-06 and QA-SF-26 (`store.test.ts`, `match.test.ts`), QA-SF-25 (`async.test.ts`), and SE1 / review pack 30 (`rank.test.ts`, `store.test.ts`).

Not ported, with the reason (the header of `oracle.test.ts` has the same list): the chord router and its guards, and `host.search` on the key (ShellStore/unit.cjs:289 to 433): the chords are `core/chords.ts` and the host's; the live model closing the palette on a tab change (R2Store:1090): the host calls `close()`; the + menu and All tabs view models (R2Store:1555 to 1597): menus, a later step; command registration and `commands.list` (ShellStore:234 to 272): the registry is the host's and does not exist yet; the storage envelope and the window session (ShellStore:435 to 505, R2Store:1208 to 1345): `session/` (S3a); the live region (ShellStore:563): the UI's.

## Decisions and deviations from the mock (for the lead)

1. **The default active row is the first row that can be opened**, not the first row: an unavailable row can lead nothing, and Enter would refuse it (the mock pre-selects it).
2. **Once the user moves** (arrows, pointer) the section order is frozen and a late section is appended after it; before they move the pre-selected row follows the best match (SE1). This is my reading of "merge without reordering what the user has focused" and of S71.
3. **Async providers always have a section of their own** (refused at registration otherwise), and a section of a plugin's own is prefixed with the plugin's id and named `<plugin> · <title>`.
4. **The sentence is told once, 450 ms after the results settle, and never for an empty input** (the mock announces after a provider answers only).
5. **An IME composition ends with a search** (the mock's `applyTyped` returns early there, because the query was already patched while composing: no async search follows a composed text).
6. `search` rows are not ranked again by the host (the mock shows the provider's order); `match` candidates are always ranked by the host.

## Backend catalog

| Class | Where | What | Evidence | Interim in the UI |
|---|---|---|---|---|
| TANGENTIAL | plugin SDK / a plugin's backend (not located) | A plugin's `search(query, scope, signal)` should not pull a whole list and filter it in the renderer: it needs a backend call with a query and a limit (names, prefix first) per connection and type. | [INFERENCE] from the design (query on demand, README "Very large clusters"); the SDK's list calls were not read in this step | none: no provider exists yet |

## Verification

Run on this head (macOS arm64, Node 26.12, 2026-11-19), all exit 0: `pnpm exec vitest run ui-next/shell/core/palette` 11 files, 207 tests; root `pnpm test` 219 files passed and 1 skipped, 2,944 tests passed and 3 skipped; `tsc -p tsconfig.app.json`, `-p tsconfig.test.json` and the kit's typecheck; the kit's `verify` (generate check, tests, API report); `node --test scripts/react-compiler.test.mjs` 13 of 13; `pnpm lint` 0 errors, the 8 warnings that are on main, none in the folder; `node scripts/check-tracked-outputs.mjs`; the vocabulary scan (0 hits). **The `next` bundle is byte-identical**: `OMNIVIEW_UI=next vite build` at this head and at `origin/main` be06aa2d (a worktree of its own, deleted after) give trees with no difference (`diff -r`, and the same SHA-256 over the sorted file hashes, `6b6ef694…2d99`); nothing outside the folder imports the model.

Performance (a laptop, jsdom, fastest of three): see `perf.test.ts`; the bound is 100 ms for ranking ten thousand commands for 1, 3 and 8 characters, through the store as well.

## Not verified

Not run: the browser probes (kit, table, fonts, tooltip, shell, strip, rail, detail with `FONT_DELAY_MS=40`), the seam check and `node --test scripts/ui-flavour.test.mjs`: nothing in the folder is imported, so the pages they load cannot change (the bundle comparison above is the proof); the PR's own CI runs the probes. The model was never drawn or run against a real host or plugin (the contribution contract does not carry providers yet). No fuzz test of random operations was written (the tab and panel models have one): the invariants are held by the unit tests only. Structural sharing of rows between snapshots is not built (a view keys by `row.id`). Windows, Linux and WebKit were not run. CodeRabbit was rate limited on the first push (its comment says so): 0 review comments to answer.

## Dev tools

| Tool | What | Where | Keep? |
|---|---|---|---|
| `testing.ts` | A manual clock and a fixture palette over the tab model's fixture world | `ui-next/shell/core/palette/testing.ts` | yes: test support, imported by tests only (a purity test checks) |
