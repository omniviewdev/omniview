# Status: FM2a-fix (the component tests that time out in CI)

**State (2026-11-22): DONE, the pull request is open and not merged.** Two tests of the `UI component tests` job timed out at vitest's 5 s on the CI runner and under load on laptops: `ui-next/parts/PartsPage.test.tsx` (its first two tests) and, next to it and nearly, `ui-next/App.test.tsx > walks every theme and comes back to the first`. The cause is how the tests read a page of 5,500 nodes, not what the six form parts do. The parts page test reads the page once now; the App's appearance tests draw the App without the page. No timeout is raised and every assertion is kept.

- Agent: FormParts
- Goal: find the cause with numbers, fix the cause, do not raise the timeout, do not drop the assertion that every example of every part is rendered once and captioned. The lead then added the App test.
- Owns: `ui-next/parts/PartsPage.test.tsx`, `ui-next/App.test.tsx`, `ui-next/App.appearance.test.tsx` (new), and this file.
- Worktree: `~/Repos/omniviewdev/worktrees/ui-next-fm2a-parts-test`
- Branch: `ui-next/fm2a-parts-test`, one commit on `origin/main` 1d713d3a (the numbers below were measured on 149936b0; the commit between them, #650, changes the kit's log view model, its time test, the shard table and a Logs probe).
- PR: https://github.com/omniviewdev/omniview/pull/655 (the pull request that carries this file).

## Log

- 2026-11-21: the lead reported the parts page test failing in CI on two unrelated pull requests: #648 (run 44922578216, attempt 1, job 136901684891) and #647 (run 44929041107, attempt 1, job 136921477305), a timeout at 5 s; about 1 s on a laptop. Both passed on a second attempt.
- 2026-11-21: the CI logs of both jobs read; the same test file run on three trees (before #645, after it, and `d2ab851d`) at 0, 8 and 16 busy loops, 10 runs per cell; every lookup of the page costed. A model rate limit cut the run off before anything was pushed.
- 2026-11-22: resumed on `origin/main` 149936b0 (the notice centre #647, #652 and #653 have landed; none of them touches `ui-next/parts/**`, the registry or the kit's examples, except four lines of `Icon.examples.tsx`). The fix to the parts page test written, tried against three faults in the page, and measured on 149936b0 with the original file and the fixed one run in turn.
- 2026-11-22: the lead asked that both tests of the file be measured (it had failed locally for three more agents under load: the two tests), and, when I reported that `ui-next/App.test.tsx > walks every theme and comes back to the first` is the next one (4,455 ms in #647's job; 2 of 10 timed out locally at 16 busy loops), that I fix it in the same pull request and own that test file: look the button up once, and say whether the test needs the page mounted at all.
- 2026-11-22: the App test profiled with and without the page, fixed, and measured against the original in turn (idle, 8, 16 and 40 busy loops). The gates run on the whole change.

## The cause, with numbers

**1. The CI logs.** Per-test times that vitest printed for the parts page file (milliseconds; the limit is 5,000):

| Job | the file | T1 heading of each part | T2 every example captioned | T3 Button examples | T4 reasoned-disabled | T5 document root |
| --- | --- | --- | --- | --- | --- | --- |
| #647, run 44929041107, attempt 1 (merge of 81b49cfc into `d2ab851d`) | 12,639 | 4,496 | **5,284, timed out** | 1,373 | 903 | 571 |
| #647, attempt 2 | 6,686 | 2,638 | 2,460 | 798 | 427 | 359 |
| #648, run 44922578216, attempt 1 (on `3b5292ea`) | 12,034 | 3,898 | **5,551, timed out** | 1,367 | 628 | 585 |
| #648, attempt 2 | 7,948 | 2,977 | 2,931 | 1,021 | 507 | 509 |

The same code passed on the second attempt, so the cost depends on what else the runner is doing. The runner is `ubuntu-latest` and vitest runs the 300 to 310 test files of the job in parallel on its cores; the job log prints no core count (the hosted runner of a public repository has 4 vCPU: [INFERENCE], not read from the logs). The file is the 2nd and 3rd slowest of the 300 and 311 files of those two jobs, after `ui-next/App.test.tsx` (12.4 to 13.6 s) and, in #647 only, `ui-next/shell/notices/centreList.test.ts` (32 s).

**2. The distribution on the runner**, from the logs of 83 `UI component tests` jobs (the jobs of the `PR Checks` runs 44827006661 to 44932913921 that printed the file's line):

| test | before the six parts (n = 73): median / p90 / max, runs over 4 s | with them (n = 10): median / p90 / max, runs over 4 s and over 5 s |
| --- | --- | --- |
| T1 every part under a heading | 2,605 / 3,436 / 4,303, 3 | 3,086 / 3,898 / 4,496, 1 and 0 |
| T2 every example captioned | 2,775 / 3,717 / **4,958**, 3 | 3,548 / 5,284 / **5,551**, 3 and **2** |
| T3 Button examples | 942 / 1,369 / 1,608 | 1,038 / 1,373 / 1,478 |
| T4 reasoned-disabled | 532 / 762 / 866 | 565 / 675 / 903 |
| T5 document root | 450 / 610 / 1,068 | 438 / 585 / 599 |

So the test was a latent flake before the six parts: its worst run on the runner, 4,958 ms, was 42 ms from the limit. The six parts moved the median of T2 by 28 % and its tail over the limit: 2 of 10 runs failed.

**3. It is not what a part does when it mounts.** Every example was mounted on its own in jsdom (a second pass, after a warm-up; four passes on two days): the 293 examples together take 237 to 335 ms, and drawing the whole page takes 0.23 to 0.41 s. The six form parts are 56 of the 293 examples and 29 to 35 ms of that (569 of about 4,270 nodes). The dearest examples are `DataTable/Large` (31 to 35 ms), `LogView/ManyLines` (17 to 20 ms) and `Icon/AllGlyphs` (8 to 11 ms). Of the form parts, `NumberInput` (whose arithmetic is BigInt now) mounts its 10 examples in 9.2 ms; the slowest single form example is `Select/NothingChosen` at 3.4 ms. No example of a form part starts a timer, a layout or a popover at mount. So there is nothing to fix in the parts or their examples.

**4. It is how the tests look things up.** jsdom answers a query by walking every node of the page, which is 5,551 nodes. Measured on 149936b0, 100 repetitions of one lookup:

| lookup | cost |
| --- | --- |
| `querySelector` of the first example (node 7) | 0.015 ms |
| `querySelector` of the last example (node 5,532) | 10 to 16 ms |
| `querySelector` of a selector that matches nothing (a full walk) | 10 to 13 ms, 1.8 to 2.3 µs a node |
| `getByRole('heading', { level: 3, name })` | 30 ms |
| `getAllByRole('heading', { level: 3 })`, one call | 22 to 38 ms |
| one pass over `[data-example]` into a map | 4.6 to 5 ms |

T2 made 293 lookups, one for each example, so it walks 293 times half the page (2,776 nodes at about 2 µs): 1.5 to 1.9 s by that arithmetic, 1.3 to 1.6 s measured. T1 made 35 `getByRole` calls: 0.8 to 1.1 s. Both were also preceded by their own draw of the page (the file drew it five times). Their cost is (lookups) times (nodes), and both grow with every part and example added. The six parts took the registry from 237 examples, 29 parts and 4,680 nodes to 293, 35 and 5,509: lookups times nodes grew by 1.46 for T2 and 1.42 for T1; measured idle, T2 went from 1,119 to 1,576 ms (1.41) and T1 from 953 to 1,231 ms (1.29). On the runner, which is two to three times slower than an idle laptop and has a heavy tail, that is the whole difference between 4,958 ms and 5,551 ms.

**5. The same file under load, on three trees** (the original test, 10 runs a cell, with the machine's own load average at 28 to 72 and my busy loops on top; milliseconds, median / max):

| busy loops | tree | T1 | T2 | timed out at 5 s, of 10 runs: T2 and T1 |
| --- | --- | --- | --- | --- |
| 0 | before #645 (`1ab0fcc4`) | 953 / 1,529 | 1,119 / 1,739 | 0 and 0 |
| 0 | after #645 (`3b5292ea`) | 1,231 / 1,797 | 1,576 / 2,106 | 0 and 0 |
| 0 | `d2ab851d` | 1,250 / 2,625 | 1,651 / 2,422 | 0 and 0 |
| 8 | before #645 | 2,038 / 5,199 | 3,301 / 5,840 | **2** and **1** |
| 8 | after #645 | 3,880 / 6,217 | 4,051 / 6,184 | **3** and **2** |
| 8 | `d2ab851d` | 3,823 / 8,058 | 4,464 / 9,523 | **4** and **2** |
| 16 | before #645 | 2,694 / 4,245 | 2,919 / 6,228 | **3** and 0 |
| 16 | after #645 | 3,574 / 6,509 | 4,082 / 7,853 | **4** and **4** |
| 16 | `d2ab851d` | 3,564 / 6,094 | 4,274 / 7,176 | **4** and **2** |

Every one of the 31 failures was `Test timed out in 5000ms`, and every one was T1 or T2. It timed out under load on the tree before the six parts too (3 of the 20 runs of T1 and T2 at 8 loops, 3 of 20 at 16); with the parts it was 5 and 8 of 20, and 6 and 6 on `d2ab851d`.

**6. The App test is the same cost.** `ui-next/App.test.tsx` draws the whole `App`, and the page of parts is inside it (`Frame` renders `<PartsPage />`). On the runner (65 jobs with the file's lines, from run 44863468428 to run 45037646548), in milliseconds:

| test | median | p90 | max | runs over 3.5 s, 4 s, 5 s |
| --- | --- | --- | --- | --- |
| renders the single screen | 1,045 | 1,403 | 1,590 | 0, 0, 0 |
| three controls and the parts examples | 1,250 | 1,789 | 1,997 | 0, 0, 0 |
| default theme, density and text size | 636 | 905 | 1,016 | 0, 0, 0 |
| flips the theme, density and text size | 2,039 | 2,701 | 3,036 | 0, 0, 0 |
| **walks every theme and comes back to the first** | 2,791 | 3,882 | **4,455** | 21, 3, 0 |
| never writes a style or a custom property on the document root | 1,329 | 1,804 | 1,960 | 0, 0, 0 |
| the file | 9,055 | 12,150 | 13,603 | |

The walk was at 89 % of the limit at its worst on the runner (4,455 ms in #647's job, 3,812 ms in #648's), and no run has failed yet. Locally, the original file at 40 busy loops: the walk's median 4,512 ms, max 5,279, **3 of 10 timed out**; the flips test 3,132 / 3,576. Earlier, at 16 busy loops with a busier machine: median 4,202, max 5,317, 2 of 10 timed out. Profiled on 149936b0 on a laptop (idle, three runs), the walk's cost is:

| | with the page (5,601 nodes) | with the page replaced by nothing (50 nodes) |
| --- | --- | --- |
| draw the App | 202 to 210 ms | 9 to 12 ms |
| nine `getByRole('button', { name: 'Next theme' })` | 685 to 745 ms (75 to 83 ms each) | 49 to 63 ms |
| nine `userEvent` clicks | 92 to 96 ms | 64 to 66 ms |
| nine `fireEvent` clicks | 3 ms | 2 to 3 ms |

A flip does not re-render the page (nine `fireEvent` clicks cost 3 ms in all), and the button is the same element through every flip (`isConnected` after nine). The lookup is dear because of the page: `getByRole` with a name computes the accessible name of each of the 380 buttons on it. So 70 % of the walk is nine lookups of one element, and the rest is mostly drawing the page, which the walk does not use.

## The fix

**`ui-next/parts/PartsPage.test.tsx`:**

1. **The page is drawn once** (`beforeAll`, from `@testing-library/react/pure`, which registers no cleanup after each test; `afterAll` takes the page away) and every test reads it. Before, each of the five tests drew it (0.2 s on a laptop, 0.5 s on the runner).
2. **One pass over the figures** (`querySelectorAll('[data-example]')` into a map, 5 ms) replaces 293 `querySelector` calls; one `getAllByRole('heading', { level: 3 })` replaces 35 `getByRole` calls.
3. **One test for each part** (`it.each` over the registry, 35 tests): a slow or wrong part is named, and the 5 s bound applies to it alone. It asserts, as before, that each example of the part is rendered exactly once and captioned with its name in words (`WithIconDisabled` is "With icon disabled"). A further test asserts that no figure is drawn that the registry does not have, which with the per-part tests keeps the old count assertion (`total` figures).
4. The headings test now compares the set of the page's own level-3 headings (those that are not inside an example) with the set of parts, so a part with no heading, a duplicate or a stranger fails it (the old one failed on a missing or a doubled heading).
5. The focus test puts the focus back in a `finally`, since the tests now share the page.

**`ui-next/App.test.tsx` and `ui-next/App.appearance.test.tsx` (new):**

1. **The walk looks the button up once.** It is the same element through every flip, and a click on one that had gone would not move the theme, so the sequence assertion would fail.
2. **The App does not need the page for the three appearance tests.** The defaults, the flips and the walk are about the three controls, the state they flip, the kit's theme provider and the attributes it writes on `<html>`; the page of examples under them is not what they prove. `Frame` is not exported (`App.tsx` is not in this change), so `<App />` is the smallest App a test can mount, and the smallest thing that still proves the walk is that App with the page replaced by nothing: `App.appearance.test.tsx` draws the real `App` with `vi.mock('./parts/PartsPage', () => ({ PartsPage: () => null }))` (a mock is per file, hence the new file). The controls, the state, the provider and the attributes are the real ones.
3. **`App.test.tsx` keeps the real page** for the three tests that are about the whole screen: it renders, it draws the three controls with the kit Button and the examples under them, and it writes nothing on the document root (a claim about the whole screen, page included).

The assertions are the same, word for word; the tests that moved keep their titles. No timeout is raised, nothing but that one module is mocked, no timer is used. The page (`PartsPage.tsx`), `App.tsx`, the kit and the examples are not touched.

**The assertions still fail when they should** (faults put in the source for a run and taken out again, each seen red): in `PartsPage.tsx`, captions not lower-cased and headings lower-cased (the headings test and all 35 part tests failed); the first example of `Button` drawn twice and a stranger figure (`Button/Busy: expected [ <figure>, <figure> ] to have a length of 1 but got 2` and `expected [ 'Stranger/Example' ] to deeply equal []`); the last example of `Button` missing and no heading for `Tabs` (`Button/WithIconDisabled: expected [] to have a length of 1 but got +0` and the headings test). In `App.tsx`, the next theme made two steps on: the flips test (`expected 'light' to be 'dark'`) and the walk (`expected [ 'void', 'light', 'carbon', ... ] to deeply equal [ 'void', 'dark', 'light', ... ]`) failed, and the three real-page tests, which are about other things, passed.

## Before and after, on `origin/main` 149936b0

Milliseconds, median / max of 10 runs of each test, the original file and the new ones run in turn inside each iteration (so what else the machine does reaches both), `TZ=UTC`. "Busy loops" are `while :; do :; done` processes I started on top of the machine's own work (its load average when each cell began is in the notes under the tables). The cell with 40 loops is two busy threads for each of the 18 cores and is as slow as the CI runner or slower (the original T2's median is 5,439 ms there and 3,548 ms on the runner), so it is the one to read the margin from.

**The parts page file** (35 part tests and the stranger test are one row, the slowest of them in the run; the 8-loop column is in the notes):

| test | idle | 16 loops | 40 loops |
| --- | --- | --- | --- |
| T1 every part under a heading | 1,079 / 1,319 → 126 / 183 | 2,255 / 2,680 → 247 / 539 | 3,706 / 4,915 → 452 / 632 |
| T2 every example captioned (after: the slowest of the 35 part tests) | 1,516 / 1,711 → 2 / 4 | 3,000 / 3,146 → 6 / 82 | 5,439 / 6,485, **6 of 10 timed out** → 0 / 62 |
| after only: no figure the registry lacks | 0 / 0 | 0 / 2 | 0 / 1 |
| T3 Button examples | 407 / 441 → 204 / 294 | 842 / 1,109 → 479 / 657 | 1,548 / 1,931 → 819 / 977 |
| T4 reasoned-disabled | 196 / 216 → 8 / 10 | 412 / 617 → 14 / 60 | 773 / 977 → 19 / 52 |
| T5 document root | 173 / 201 → 0 / 0 | 387 / 825 → 0 / 2 | 671 / 828 → 0 / 0 |
| **slowest test of a run** | 1,516 / 1,711 → **204 / 294** | 3,000 / 3,146 → **489 / 657** | 5,439 / 6,485 → **819 / 977** |
| the file, hooks included (the one draw of the page is in it) | 3,400 / 3,729 → 353 / 505 | 6,902 / 7,467 → 824 / 970 | |

At 8 loops: T1 1,581 / 1,890 → 170 / 593; T2 2,087 / 2,994 → 3 / 19; T3 661 / 1,168 → 295 / 752; T4 306 / 446 → 11 / 14; T5 270 / 683 → 0 / 0; slowest 2,087 / 2,994 → 295 / 752; the file 5,113 / 6,593 → 491 / 1,371. An earlier, identical matrix of 10 more runs (the file differed by one `try`/`finally` in the focus test) had at 16 loops a slowest test of 776 ms against the original's 7,261 ms (which timed out once).

**The App files** (before: the six tests of `App.test.tsx`; after: `App.test.tsx` for the first, second and last, `App.appearance.test.tsx` for the other three):

| test | idle | 16 loops | 40 loops |
| --- | --- | --- | --- |
| renders the single screen | 335 / 403 → 332 / 388 | 378 / 406 → 393 / 423 | 1,512 / 1,864 → 1,214 / 1,973 |
| three controls and the parts examples | 382 / 402 → 381 / 494 | 454 / 515 → 483 / 619 | 1,904 / 2,733 → 1,620 / 2,138 |
| default theme, density and text size | 212 / 250 → **18 / 26** | 245 / 259 → **22 / 27** | 1,043 / 1,490 → **66 / 142** |
| flips theme, density and text size | 623 / 661 → **75 / 98** | 763 / 826 → **84 / 92** | 3,132 / 3,576 → **264 / 347** |
| **walks every theme and comes back to the first** | 982 / 1,084 → **63 / 67** | 1,197 / 1,304 → **67 / 75** | 4,512 / 5,279, **3 of 10 timed out** → **115 / 207** |
| never writes a style or a custom property on the root | 471 / 546 → 521 / 602 | 557 / 600 → 619 / 766 | 1,722 / 2,762 → 1,972 / 2,737 |
| **slowest test of a run** | 982 / 1,084 → **521 / 602** | 1,197 / 1,304 → **621 / 766** | 4,512 / 5,279 → **1,972 / 2,737** |
| the files, hooks included (the two new files added up) | 3,009 / 3,219 → 1,408 / 1,592 | 3,614 / 3,757 → 1,690 / 1,783 | |

At 8 loops: default 280 / 460 → 23 / 28; flips 908 / 1,149 → 90 / 124; walk 1,238 / 1,468 → 66 / 85; the others within noise; slowest 1,238 / 2,403 → 620 / 791. The three real-page tests did not change (they draw the page, as before), and are now the slowest of the App files.

Notes: the machine was shared. Its load average when the cells began: parts page matrix 47, 22 and 25 (idle, 8 and 16 loops); App matrix 9, 7 and 13; the 40-loop cell 17. The idle cell of the parts page matrix is therefore not idle. The numbers compare an original and a fixed file inside one iteration, which is what they are for.

## Margin against the runner

- **Target** (under 1.5 s for the slowest test under 16 busy loops, locally): met by both. The parts page file's slowest test is 489 ms at the median and 657 ms at the worst of 10 runs (776 ms in the earlier matrix), where the original's was 3,000 / 3,146 ms (and 7,261 ms in the earlier matrix). The App files' slowest test (the root-write test, unchanged) is 621 / 766 ms, where the original's slowest (the walk) was 1,197 / 1,304.
- **Under the runner-like cell (40 loops)**: the parts page file's slowest test is 819 / 977 ms, five times under the limit, where the original timed out 6 times in 10; the three App appearance tests are 66 to 264 ms at the median and 347 ms at the worst, where the walk timed out 3 times in 10. The slowest App test after the change is the real-page root-write test, at 1,972 / 2,737 ms, 1.8 times under the limit at a load that is heavier than the runner's (its runner numbers are median 1,329, worst 1,960 ms).
- **On the runner itself**, the fixed tests' seconds are those of the first CI run of this change: they are in the pull request's description (a file cannot carry the numbers of the run that tests it), next to the numbers above.
- **Growth.** The fixed tests' cost grows with the nodes of the page once (one draw, one role query), not with parts times nodes: the next 56 examples add about 0.1 s on the runner, not 1.5 s. The three real-page App tests grow with the page (a draw and three role lookups each); they are at about a third of the limit on the runner, and the rule below applies to them too.

## Verification

Worktree `~/Repos/omniviewdev/worktrees/ui-next-fm2a-parts-test`, branch `ui-next/fm2a-parts-test`. The commands below ran on `origin/main` 149936b0 plus this change, with the kit built (`task packages`); `uptime` before them: load average 6.0 at 09:37, after the busy loops of the measurements had been killed. Main moved by one commit (#650) before the push: the branch was rebased onto it, the kit rebuilt, and the three test files (46 of 46), the lint of them and `tsc -p tsconfig.test.json` were run again; the full root `pnpm test` and `pnpm lint` were run again too, see the first two rows.

| Command | Result |
| --- | --- |
| `TZ=UTC pnpm test` (the full root suite) | exit 0: 326 test files passed and 1 skipped; 5,472 tests passed and 3 skipped |
| `pnpm lint` | exit 0: 0 errors, 8 warnings, all in `ui/` and `packages/omniviewdev-runtime`, none in a changed file |
| `pnpm exec tsc -p tsconfig.app.json --noEmit`, `pnpm exec tsc -p tsconfig.test.json --noEmit`, `pnpm --filter @omniviewdev/kit run typecheck` | exit 0, 0, 0 |
| `pnpm --filter @omniviewdev/kit run verify` | exit 0: 100 test files and 2,788 tests (2,774 before the rebase: #650 added tests), build, API report (nothing in the kit changed by this pull request) |
| `node --test scripts/react-compiler.test.mjs`, `node scripts/check-tracked-outputs.mjs` | exit 0, 0 |
| the three files in a shuffled order (`--sequence.shuffle`, seeds 7 and 2026) | 46 of 46 passed with both seeds (40 of the parts page file, 3 and 3 of the App files); the parts page file shares one drawn page, so its tests must not depend on order |
| the faults in `PartsPage.tsx` and `App.tsx` (above) | each seen red by the test named for it, and each taken out again (`git diff` of both files is empty) |
| the 10-run matrices (above) | 0 failures in any fixed file in any cell, 400 tests a cell for the parts page file |

The seam check and the probes are not run: no path under `packages/kit/`, `scripts/` or `src/` changes, and nothing a probe reads (the page, the kit, the examples) changes.

## Not verified

- The runner's core count (the logs do not print it), and the runner's numbers for the fixed tests until the CI run of this change: see above.
- Windows, the real host and the other component tests of the job: not looked at. The full root `pnpm test` ran.

## For the lead

- **A rule for `AGENTS.md`** (not written: the file is yours): a test of a page with thousands of nodes reads the page once and does not look things up in it one by one (each lookup walks the page: 5 ms to 80 ms, and 300 of them are seconds on the runner); and a test that is not about a big page does not draw it. The parts page grows with every part, so every lookup in it gets dearer with each one.
- `ui-next/shell/notices/centreList.test.ts` took 32 s for 132 tests in #647's job, the slowest file of the suite by a factor of 2.5. No test of it timed out in the logs I read; I did not look at why. Flagged only.

## Dev tools

The load matrix (one script; the busy loops' PIDs are kept and killed by PID from a `trap`, never by name; trees and files run in turn inside one iteration, so what else the machine does reaches each of them; a variant is `name=worktree|test file`, and a copy of the original test file under a scratch name, in the worktree, is the "before"):

```bash
#!/usr/bin/env bash
# matrix.sh <label> <runs> <loops>... -- <name=worktree|test file>...
set -u
LABEL=$1; RUNS=$2; shift 2
LOADS=(); while [ "$1" != "--" ]; do LOADS+=("$1"); shift; done; shift
TREES=("$@"); OUT=/tmp/matrix/$LABEL; mkdir -p "$OUT"; PIDS=()
cleanup() { if [ ${#PIDS[@]} -gt 0 ]; then kill "${PIDS[@]}" 2>/dev/null; wait "${PIDS[@]}" 2>/dev/null; fi; PIDS=(); }
trap cleanup EXIT INT TERM
run_one() { local name=$1 path=${2%%|*} file=${2#*|} load=$3 i=$4
  ( cd "$path" && TZ=UTC pnpm exec vitest run "$file" --reporter=json --outputFile.json="$OUT/$name-L$load-$i.json" > "$OUT/$name-L$load-$i.out" 2>&1 ); }
for load in "${LOADS[@]}"; do
  for ((k = 0; k < load; k++)); do ( while :; do :; done ) & PIDS+=($!); done
  sleep 3; echo "loops=$load $(date +%T) $(uptime)" >> "$OUT/cells.txt"
  for ((i = 1; i <= RUNS; i++)); do for t in "${TREES[@]}"; do run_one "${t%%=*}" "${t#*=}" "$load" "$i"; done; done
  cleanup; sleep 5
done
```

Each report's `testResults[].assertionResults[].duration` is the per-test time; the medians and maxima are taken over the 10 runs of a cell. The runner's times are read from the job logs (`gh api repos/omniviewdev/omniview/actions/jobs/<id>/logs`, the file's line such as `✓ ui-next/parts/PartsPage.test.tsx (5 tests) 7948ms` and the test lines under it).
