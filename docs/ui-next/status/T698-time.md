# T698-time: tests decided by time (#698 items 10 and 23)

Branch `test/terminal-time-decided`, from `origin/main` `30df52ea`. Tests only; no product file was touched.

## Item 23 (kinds e and f of `T2-go.md` 7.1)

| Test | Was | Now |
|---|---|---|
| `TestAWindowGoingAway...` (`reattach_test.go`) | `WithinDuration(time.Now()+LeaseDefault, 5 s)` | fake clock; `LeaseExpiresUnixMs` equals `clock.Now()+LeaseDefault` exactly |
| `TestDetachKeeps...` (two asserts) | `WithinDuration` 5 s and 2 s | fake clock; exact |
| `TestALeaseThatRunsOut...` | `GreaterOrEqual(time.Since(started), 300 ms)` | fake clock: `Advance(300 ms - 1 ms)` leaves both terminals alive (`ending` false), `Advance(1 ms)` ends them |
| `TestClosingASessionThatIsPausedForCredit...` (`flow_test.go`) | `Less(elapsed, 3 s)` | `m.running()` is empty when `CloseSession` returns (it gives up only after `closeWait`), and the flow control is released (state, `flow.check()`) |
| `TestShutdownEndsEverySession...` | `Less(elapsed, closeWait)` | `m.running()` is empty when `Shutdown` returns |
| `TestClosingHangsUpAtOnce...` (`login_test.go`) | `Less(elapsed, HangupGrace)` and `Less(elapsed, closeWait)` | the hangup alone: `s.hangup(time.Hour)` (the grace is a parameter) and a wait for `s.exited`; a close: `running()` empty, one CLOSE; the shell that ignores the hangup: still alive after `hangup(time.Hour)` (a negative wait, which can only get weaker), then `CloseSession` ends it, which only the grace's kill can do |

The grace stays on the wall clock by design (`clock.go`); the tests give `hangup` a grace of an hour where they mean "no kill is due", so no assertion reads wall time. The remaining `time.After` and `Eventually` are kinds b and c (negative waits, bounded waits for an event).

Controls: `T698-time/mutations.sh.txt` (fault in a scratch copy, `go test -overlay`, worktree untouched). Result of the run on this base: 11 of 11 red (lease expiry read from the wall clock; one second late; timer early; timer late; close does not await the session; shutdown does not await; close does not release the pacing; hangup does not reach the shell; grace never kills; grace is no grace). The first run showed two controls undetected because their test regexp matched no test (`go test -run` of a name that the top-level test does not have), and a third (pacing) undetected because on Linux the shell ends by SIGHUP whether or not the pacing was released (the macOS defect of B1): the test now reads the released state directly, and the control is red.

## Item 10 (the launch environment before anything reads it): NOT PINNED, stopped

`main()` calls `shellenv.RememberLaunchEnvironment()` as its first statement and nothing in `main`'s observable behaviour depends on the order: `LaunchEnvironment` is read by `terminal.NewManager` (`base`), which is built much later, and `main` cannot be run in a test (it starts Wails and calls `os.Exit`). A test that reads `main.go` as text or AST is a source-text test, which is not allowed here, and a behavioural test needs a seam in `main.go` (for instance `main` calling a function that takes the steps in order, which a test can run with spies). That is a change of `main.go`, owned by PR #704. Left open for it.
