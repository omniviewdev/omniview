# Status: HM3d (two flaky component tests, found by CI on #735)

- Agent: HomeAndConnections. Row: HM3 (the lead's tracker, not edited here). Two tests failed on an unrelated PR (#735) and on its rerun: my S3 test of the list page's refresh limit (written in HM3b, #724) and `ui-next/shell/panel/terminal/screen.test.ts` (not mine, found in the same rerun).
- Worktree: `~/Repos/omniviewdev/worktrees/fix-listpage-refresh-limit-test`, branch `fix/flaky-component-tests` from `origin/main` d2aa3ae15 (#734 included). No PR: the branch is merged into #735 so that one CI run proves both.
- #734 (Alex, d2aa3ae15) landed while this was being proved: the same cause and the same fix for the S3 block (`vi.useFakeTimers()` in its `beforeEach` replaces the file's real-time-following clock with a plain one). This branch kept main's line, dropped its own version of it in the rebase, and keeps what #734 does not have: the test that HOLDS the fix against real time, its twin for the detail page, and the terminal test.

## Cause, from reproduction (not from CI)

| Test | CI failure | Cause | Reproduction in the 2-CPU container (native arm64 Linux, `--cpus 2`, node 26.13, 8 CPU hogs beside the test) |
|---|---|---|---|
| `ListPage.test.tsx` > "a Refresh that does not finish (S3)" > "says it after thirty seconds when the read never settles, and Retry asks the read again" | `Unable to find an accessible element with the role "article" and name "Info: Refresh Items"` | The file's fake clock is `vi.useFakeTimers({ shouldAdvanceTime: true })` (for the user-event tests): it FOLLOWS REAL TIME, 20 ms for every 20 ms that go by. The test stands one millisecond from the limit (`advanceTimersByTimeAsync(REFRESH_LIMIT_MS - 1)`, assert, then `(1)`), so any real gap of 20 ms or more between two awaits of the test (a starved runner) moves the clock past the limit, the page has already said "Refresh did not finish", and the test looks for "Refreshing…". | The original, 200 repeats under 8 hogs: `Unable to find an accessible element with the role "article" and name "Info: Refresh Items"` (the CI message). Deterministic: a real 100 ms sleep between the two ticks (the new regression test) fails with the same message on the file's clock. |
| `screen.test.ts` > "a replay: a terminal the page took back after a reload" > "writes what the host kept in slices of at most a slice, ..." | `Error: Test timed out in 5000ms.` | It was ONE SECOND OF CPU on an idle 18-core machine (1141 ms; the next slowest test of the file is 206 ms): 1.1 million bytes made by `Uint8Array.from` with a mapping (a call for each byte) and compared with `toEqual`, a deep equality of 1.1 million numbers. A loaded runner takes it past 5 s. | The original, 20 repeats under 8 hogs: `Error: Test timed out in 5000ms.` on every repeat. |

Not a cause: the order of the tests, state left by another file's fake timers (the detail page's S3 block uses a plain fake clock and was not reported failing), a real timer under `userEvent`. Three FULL-suite runs of the ORIGINAL tests in the 2-CPU container (449 files, 312 to 355 s, environment 31 to 34 percent of the time, as CI's 36) did not fail either test: the failure needs a starved machine, which CI had twice (the first run of #735 and its rerun) and the full suite alone in the container did not.

## What changed

- `ui-next/page/ListPage.test.tsx`: the test that holds #734's clock: a real 100 ms sleep (the real `setTimeout`, taken at import) between the two ticks of the S3 test must not matter. Seen red on the file's real-time-following clock with the CI message, green on #734's; the rest of the file keeps `shouldAdvanceTime`, which its user-event tests rely on.
- `ui-next/page/DetailPage.test.tsx`: the twin of that test. The detail page shares `useRefreshFeedback`, and its S3 block already used a plain fake clock; the test passes before and after and holds it so.
- `ui-next/shell/panel/terminal/screen.test.ts`: the bytes are made by a loop (`counting`) and compared in one pass (`firstDifference`, which also says WHERE they differ) in the two tests that compared a run of bytes with `toEqual` (131 KB and 1.1 MB). The slices test takes 21 ms where it took 1141 ms; no timeout was raised.

## What ran

- Red first: the S3 regression test on the file's clock, `TestingLibraryElementError: Unable to find an accessible element with the role "article" and name "Info: Refresh Items"`; the terminal test by its timing (1141 ms natively, `timed out in 5000ms` under hogs).
- Green: `vitest run ui-next/page` 222 passed, `ui-next/shell/panel/terminal/screen.test.ts` 217 passed, eslint on the three files and `tsc -p tsconfig.test.json` clean.
- In the 2-CPU container under 8 hogs, 200 repeats each, on the final files (the rebased tree, #734's clock in the S3 block), clean: the list page's S3 block (4 tests, 105 s), the detail page's S3 block (3 tests, 63 s), the terminal replay block (54 tests including the slices test, 13 s).
- The container: `g3-seam-arm64:latest` (the local seam image; node 26.13.0, pnpm 12.14.0, native arm64: the local CI image `omniview-ci:local` is amd64 and ran `ui-next/page` in 230 s under emulation against 22 s here), a copy of the worktree with its own `pnpm install` and `task packages`.

## What did not run

- The full suite with the fixes is run 5 times in the container after the push (reported to the lead); `ui/vite-optimizer.test.ts` fails in that container, with the original tests as well (it takes 10 s and fails, 3 of 3 runs), so it is left out of those runs.
