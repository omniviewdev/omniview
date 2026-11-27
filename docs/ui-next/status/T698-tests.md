# T698 tests: the test defects and the tests decided by time (#698 item 23)

Branch `test/terminal-test-defects`, from origin/main `d91a8d70f` (the red sha: every red below was seen on it).

| sha | change |
|---|---|
| `c3758dbea` | `channel_cap_test.go`: the cwd is compared with `filepath.EvalSymlinks` of the directory, not with a suffix of the unresolved path |
| `9dd433dd4` | `xtermEngine.test.ts`: the find tests no longer depend on the order |
| `abbd47748` | `review_test.go`, `terminal_transport_test.go` (exec), `channel_pr704_test.go`: wall-time bounds replaced |

## What was found

1. Symlinked TMPDIR: one test failed in the whole of `./backend/pkg/terminal/... ./backend/pkg/plugin/exec/...` (the named one). No other.
2. Shuffle: a test that made the search module fail to load restored the mock with `vi.doUnmock`, which also removes the file's `vi.mock`; every find test after it ran over the real addon and saw no recorded addon (3 failures). The load-count test counted a mock factory that runs once per registry, so it failed whenever any find ran before it. The restore is now `vi.doMock('@xterm/addon-search', recordedSearch)` (the one function of the `vi.mock`), and the count test runs in a registry of its own (`vi.resetModules()`, `doMock`, a fresh `import('./xtermEngine')`).
3. Item 23: the lines it names (`flow_test.go:212`, `:276`, `login_test.go:273`, `:301`, `reattach_test.go:83`, `:319`, `:333`) no longer hold wall bounds on main (already moved to events and the fake clock). The ones left, found by grep over `time.Since`, `WithinDuration` and `Less(... time`:
   - `review_test.go` `TestASessionEndsAfterTheDrainCap...`: `Less(took, drainCap+4s)` removed; the event wait `waitEnd(drainCap+10s)` that was there is the only guard, and `DrainCapped`/`DroppedBytes` are the facts.
   - `plugin/exec/terminal_transport_test.go` `TestAStalledClientCanStillCloseItsTerminalAndGetsTheClose`: `Less(time.Since(begin), 3s)` replaced by the close run in a goroutine and an event wait (60 s only says it hung). `Empty(ListSessions())` proves nothing (`ListSessions` skips sessions that are ending), so the facts are: the close returned no error and not `ErrCloseTimeout` (from `fix/terminal-close-hardening`, which this branch sits on until it merges: rebase onto origin/main after), and `gone(info.PID)` before the client reads again. Mutants, each red: a close that waits the full `closeWait` (no hangup, grace 1 h: `the close gave up waiting`), a close that does not wait (`if false` for the `awaitGone` check: `the close returned with the shell gone`).
   - `plugin/exec/terminal_reattach_test.go` `TestDetachTerminalLeavesTheTerminalWaiting...`: `WithinDuration(now+90s, lease, 5s)` replaced by the lease expiry being between `before+90s` and `after+90s` of the call.
   - `channel_pr704_test.go` `TestAChannelStreamsProgressKeepsTheMonotonicReadingOfTheClock`: `WithinDuration(now, last, 1 min)` replaced by the stamp being between `time.Now()` taken before and after the call.
   - Left on purpose: lower bounds (`ordered_test.go:194` 25 ms of a 30 ms timer, `review_test.go:214` the hangup grace): a timer never fires early, so they cannot flake; the soak (`channel_soak_linux_test.go`) whose length is its purpose.

## Controls (each seen red on the old test, green on the new, with the same delay)

```
git show d91a8d70f:<file> > <file>   # the old test
# inject the delay, run, git checkout <file>; inject the same delay in the new test, run, git checkout <file>
```

- exec close: old with `time.Sleep(4s)` after `begin := time.Now()`: `--- FAIL ... closing a session whose client does not read hung`; new with the 4 s sleep in the closing goroutine before `CloseSession`: `ok`.
  `go test -count=1 -run 'TestAStalledClientCanStillCloseItsTerminalAndGetsTheClose/run_0' ./backend/pkg/plugin/exec/`
- drain cap: old with `time.Sleep(8s)` after `send(... "exit")`: `the CLOSE came 8.004147567s after the exit`; new with the same sleep: `ok`.
  `go test -count=1 -run '^TestASessionEndsAfterTheDrainCapEvenWhileAnOrphanKeepsTheTerminalOpenAndWriting$/a_job_that_ticks' ./backend/pkg/terminal/`
- symlink: `r=$(mktemp -d); mkdir $r/real; ln -s $r/real $r/link; TMPDIR=$r/link go test -count=1 -run TestEveryCallThatNamesAChannelTerminal ./backend/pkg/terminal/`: red on `d91a8d70f` (`its physical path ends with the one it started in`), ok on `c3758dbea` and with the plain TMPDIR.
- shuffle: `pnpm exec vitest run ui-next/shell/panel/terminal/xtermEngine.test.ts --sequence.shuffle --sequence.seed=N`: seeds 1, 2, 3, 4 red on `d91a8d70f` (2 to 4 failures each), seeds 1 to 8 green on `9dd433dd4`.

## Commands and results (on `abbd47748`)

- `TMPDIR=$r/link go test -race -count=1 ./backend/pkg/terminal/... ./backend/pkg/plugin/exec/...`: ok, ok, ok.
- the same with the plain TMPDIR: ok, ok, ok.
- `pnpm exec vitest run ui-next/shell/panel/terminal --sequence.shuffle --sequence.seed=11|22|33`: 46 files, 2198 tests passed, each.
- `~/gl215/golangci-lint run --new-from-rev=origin/main ./backend/pkg/terminal/... ./backend/pkg/plugin/exec/...`: 0 issues, exit 0.
- `go vet` of both: exit 0. `GOOS=darwin go vet` fails on the wails `buildguard` (needs cgo) and passes with `-tags purego`: exit 0.
- `pnpm exec eslint ui-next/shell/panel/terminal`: exit 0.

## Not verified

- No macOS run: the symlink is reproduced on linux only, as the issue gives it.
- No negative control for the new close test that makes the product hang (the product was not changed): what detects a close that returns with the session alive is `Empty(ListSessions())`, whose negative half is the sibling test's.
- A first full-folder shuffle run showed `flow.test.ts` "does NOT stall the shell when the panel is hidden" at 5086 ms against vitest's 5 s timeout while Go suites ran on the same machine; it was green in the three final seeds. It is a load-sensitive test, not touched here.
