# T698-retire: #698 item 1 (B-108, serial window retirement)

- Agent: WindowRetirement. Worktree `~/omniview/wt/t698-retire`, branch `fix/window-retirement-parallel` from `origin/main` `841397b1e` (after #808). Not pushed, no pull request.
- Files: `backend/pkg/invocation/window_realm.go`, test `window_realm_retire_test.go`, controls `docs/ui-next/status/T698-retire/controls.sh`.

## Commits

| What | sha |
|---|---|
| Red: 4 of 5 tests fail by assertion ("1 of 6 began to retire while the first still held its grace; the rest wait for it") | `25ab32b1d33195cd97831192bebc11f15ac3c6f6` |
| Green: `announce` and `sweep` retire concurrently | `b519147501d35f2be149da17bf307cc056aaaef5` |
| Test: the sweep waits for its retirements; `controls.sh` | `07e9826e6c4be4e23545c8f9da678404ec875238` |

The fifth test (no goroutine left behind) is an end-state guard and passes on the old code too.

## Design

- `sweep` runs `announce` of every retired window in its own goroutine; `announce` runs the source owner first (`onRetire`), then every subscriber, each in its own goroutine. Both go through `concurrently(n, fn)`: it returns when all calls have returned (no goroutine outlives it), runs a single call in the caller's goroutine, and every panic is logged (`a window retirement panicked`) with `debug.Stack()` of its own goroutine; the others run to their end, then the first is raised again in the caller.
- Orders kept, each with a test: the source owner of a window is retired before any subscriber of that window hears (`TestTheSourceOwnerOfEveryWindowIsRetiredBeforeItsSubscribersHear`); the window is already refused when the subscribers hear; the signal runs outside the realm's lock (existing tests); `sweep` and the close event return only after the retirements are over (`...TimeOfOneLadder`, `...LeavesNoGoroutineBehind`). The order among subscribers, and among windows, was never documented and is gone (`OnRetire` says so).
- Bound: none added. At most `maxRealmWindows` (64) windows are live to retire and three services subscribe, so at most about 200 goroutines for the time of one ladder; each window's sessions already close concurrently inside `ReleaseOwned`.
- Errors: a subscriber returns nothing (`CloseOwned` logs a `CLOSE_TIMEOUT` itself, `awaitGone` of #808), so the only failure channel is a panic. It is not swallowed and does not stop another window.
- Counted without a clock: a gate stands for the shell's grace; the test opens it only after all 6 windows (and, in a second test, all 6 subscribers of one window) have begun to retire. The only waits are bounded (5 s) and fail only when an event that must come does not.

## Controls

`docs/ui-next/status/T698-retire/controls.sh` ran whole on the final tree: `ALL CONTROLS BEHAVED` (baseline, then six faults, each tripped by its assertion and passing undetected with that assertion removed): serial sweep loop put back; serial announce loop put back; subscribers before the source owner; a swallowed panic; a sweep that does not wait; a leaked goroutine.

## Commands and results (Linux amd64, go1.27.4, `GOWORK=off GOTOOLCHAIN=local`)

- Red run on `25ab32b1d`: `go test ./backend/pkg/invocation/ -run 'TestSixPages|TestEverySubscriberHears|TestTheSourceOwnerOfEvery|TestAFailingRetirement|TestRetiringWindows'`: 4 FAIL by the assertion above.
- `go test -race -count=1 ./backend/pkg/invocation/... ./backend/pkg/terminal/... ./backend/pkg/plugin/exec/...`: ok (invocation 5.4 s, terminal 244 s, marks 12 s, exec 47 s).
- `~/gl215/golangci-lint run --new-from-rev=origin/main ./backend/pkg/invocation/...`: 0 issues.
- `go vet ./backend/pkg/invocation/...` clean; `GOOS=darwin go vet -tags purego ./backend/pkg/invocation/` clean (without `purego`, wails' build guard refuses a darwin build without cgo, which this machine lacks).

## Not verified

- Not run with real shells: a seam run with 6 pages and SIGHUP-ignoring shells (the issue's 4.8 to 12.3 s figure) was not repeated; the claim is the realm's ordering, shown with gates. The exec wrapper's subscriber and `ReleaseOwned` were not changed.
- `GOOS=darwin go vet` without the `purego` tag; macOS behaviour.
- The re-raised panic carries the caller's stack; the log has each real one.

## Review follow-up (ReviewRetirement: MERGE, real shells 6 pages gone at 1.51 s vs up to 9.0 s on main)

- Docs: B-108 closed in `T1-go.md` and `backend-catalog-terminal.md`.
- Every panic logged with its own stack, test with two panicking subscribers; deterministic wait-for-all test (a gated call, each position in turn) with its control. `controls.sh` whole: ALL CONTROLS BEHAVED. `go test -race -count=5 ./backend/pkg/invocation/...` ok; `-count=1` terminal and exec ok; lint 0 issues; vet linux and darwin (`-tags purego`) clean.
