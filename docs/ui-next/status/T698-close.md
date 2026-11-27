# T698-close: #698 items 2, 7 and 8 (the close hardening leftovers)

- Agent: CloseHardening. Worktree `~/omniview/wt/t698-close`, branch `fix/terminal-close-hardening` from `origin/main` `d91a8d70f`. Not pushed, no pull request.
- Files: `backend/pkg/terminal/{manager,errors,channel,types,manager_windows}.go`, `backend/pkg/plugin/exec/{controller,terminal}.go`, tests `close_timeout_test.go`, `start_directory_test.go`, `delivery_credit_test.go`, `flow_test.go`, contract text in `T1-go.md` (2.5, 2.8.3, the guarantees line, the findings list).

## Commits (red first, then green)

| Item | Red (test only, fails by assertion) | Green |
|---|---|---|
| prep | `6f78c8309` `closeWait` is a field of the manager (a test states a short one) | |
| 2 `CloseSession` hides a timeout | `6252fcf9e` ("the session is not gone: the sink holds its last output": error expected, got nil) | `fee9f51d8` |
| 7 `startDirectory` | `711bb897f` (Cwd is `.../work`, not `.../work/link/..`; the shell started in `work`, not `data`) | `ee5aec115` |
| 8 `Delivered` by id | `4dbcd0aba` (reuse 0: owed 0, expected 4096) | `de05285cd` |
| controls | `14d116f7a`, lint fix `48016b6f9` | |

## API change

- `CloseSession` and `CloseChannel` answer `omniview:terminal/close-timeout`, code `CLOSE_TIMEOUT`, 504 (`ErrCloseTimeout`) when the session was not gone after the wait. `awaitGone` returns the first session not gone (nil when all are); `Shutdown` and window release still only log it. The exec controller logs it in `closeTerminal` and `CloseChannelTerminal` and returns it as it is.
- `startDirectory` returns the validated path unchanged (`Session.Cwd` states it).
- `Manager.Delivered(id, n)` is gone. A sink asks `Manager.DeliveryCredit(id)` inside `Output` and later calls `Credit.Delivered(n)`: the `Credit` holds the session's flow control, so a late report of a closed session credits nothing of a session that reused the id. No allocation beyond the closure `terminalOutput` already had. The Windows stub has the same two names.

## Controls

`docs/ui-next/status/T698-close/controls.sh` runs all of them (exit 0 on the final tree): a baseline, then for each item a faulty copy with `go test -overlay` that must fail on the named assertion, and the same fault with that assertion removed (second overlay of the test file) that must pass. Item 7's control removes its three assertions on the path together (they check one fault). Faults: item 2 `CloseSession` ignores `awaitGone`; item 7 `filepath.Clean`; item 8 a `Credit` that looks the session up by id when it reports.

## Commands and results (Linux amd64, go1.27.4)

- `go test -race -count=1 ./backend/pkg/terminal/... ./backend/pkg/plugin/exec/...`: ok (terminal 262 s, marks 13 s, exec 46 s).
- `~/gl215/golangci-lint run --new-from-rev=origin/main ./backend/pkg/terminal/... ./backend/pkg/plugin/exec/...`: 0 issues.
- `go vet` linux on both packages; `GOOS=darwin go vet ./backend/pkg/terminal/...` and `GOOS=windows go vet ./backend/pkg/terminal/`: clean.
- The reuse test takes 11.5 s for 1,000 reuses; under `-short` it runs 50 (AGENTS 40).

## Not verified

- `GOOS=darwin go vet ./backend/pkg/plugin/exec/`: cgo needs clang, which this machine lacks (the files changed there carry no build tag and vet on linux). macOS behaviour of the close timeout was not run.
- No test in `exec` for the controller's log line or the pass-through of the typed error: `closeWait` is not injectable from that package.
- The page: `ui-next/shell/panel/terminal/terminalChannel.ts` `close` lets `CLOSE_TIMEOUT` reach its caller as any other error; its handling (showing the terminal as ending) was not changed or tried.
- The directory check and the start are two steps: a path swapped between them is not guarded (stated in 2.8.3).
