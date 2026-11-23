# Status: T2-go (a local terminal survives a window reload)

- Agent: TerminalSignals. Goal (lead's ask, 2026-11-23): a terminal's shell outlives the window or page that opened it, for a lease; the page that comes back finds ITS terminals, takes one over, and is handed what it missed, with no byte lost and none repeated. The legacy UI and the T2a UI (which passes no key) are unchanged: this is additive.
- Worktree: `~/Repos/omniviewdev/worktrees/t2-go-terminal-reattach`. Branch: `feat/t2-go-terminal-reattach`, one commit on `origin/main` `c0e21161` (T2a, #671).
- Owned and changed: `backend/pkg/terminal/**` (new: `reattach.go`, `reattach_types.go`, `replay.go`, `modes.go`; changed: `manager.go`, `flow.go`, `pty.go`, `types.go`, `errors.go`, `manager_windows.go`), `backend/pkg/plugin/exec/{service_wrapper,controller,terminal}.go` and their tests, the regenerated bindings, `internal/auditgate/policy.json` (`AttachTerminal`, `DetachTerminal`, `ListTerminals`: denied to plugins and agents), this file, and two sentences of `T1-go.md`.
- Names follow the SDK v2 exec lane (`SDK2-exec-lane.md` 4.5 and X3c) so that the local provider can adopt the lane's session later without a second shape: `Replay{start, end, data, start_size, start_modes, size, modes}`, `TerminalModes{known, alt_screen, bracketed_paste, application_cursor, focus_events, cursor_hidden, mouse_tracking, mouse_encoding, kitty_keyboard}`, `Detached{lease_expires_unix_ms}`, `closed_by: "detach-timeout"`, `last_offset`, a ring in 64 KiB chunks with absolute offsets, a size log. `data` stands where the SDK sends the bytes as `Output` frames, because the call is one answer.

## 1. The ask, in one table

| # | Ask | Now | Where |
|---|---|---|---|
| 1 | A byte OFFSET on every output event and on the ring | a terminal opened with `launch.page_key` sends `core/exec/stream/output/<id>` as `{offset, data}`; the ring is addressed by offset; every `End` has `last_offset` | `replay.go`, `reattach.go` `record`, `exec/terminal.go` |
| 2 | DETACH separate from DESTROY, with a LEASE | a window retired or reloaded DETACHES a terminal that has a key and keeps it 5 minutes (at most 30); the lease running out ends it as a close does (`closed_by: "detach-timeout"`); the host quitting ends it | `reattach.go` `ReleaseOwned`, `detachLocked`, `expire` |
| 3 | An atomic `AttachTerminal(id, from_offset?)` | `{session, replay{start, end, data, sizes, modes}, cwd, busy, ended?}`; the live events continue at `replay.end` | `reattach.go` `Attach`, `takeOver` |
| 4 | `ListTerminals` for the window that owns the sessions; how a reloaded page finds ITS sessions | by the window's own identity, and by the page's KEY (2.6); never another window's terminals and never a key | `reattach.go` `List` |
| 5 | The legacy UI unaffected | a terminal without a key is delivered, ended and listed as before; the old `AttachSession` reads the same ring | tests in 4 |

## 2. The UI-facing contract (read this; no Go needed)

The types are in `packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/terminal/models.ts`; the calls are on `ExecClient`.

### 2.1 Opting in: `launch.page_key` and `launch.lease_ms`

```ts
CreateTerminal(opts, launch: { cols?: number; rows?: number; cwd?: string; page_key?: string; lease_ms?: number }): Promise<terminal.Session>
```

- `page_key`: a secret the PAGE makes (a UUID kept in `sessionStorage` serves) and gives for every terminal it opens. 16 to 128 visible ASCII characters (no spaces); anything else is refused `INVALID_REQUEST` naming `page_key`, and nothing starts. The key is a capability: whoever has it may attach; nothing lists it, logs it or echoes it. Without a key the terminal ends with its window as before and cannot be attached.
- `lease_ms`: how long the terminal is kept once detached. `0` or absent is 300,000 (5 min); the most is 1,800,000 (30 min); above it, below zero, or given without a key, is refused `INVALID_REQUEST` naming `lease_ms`. The answer states it: `session.lease_ms` (`0` means the terminal has no key and ends with its window), and `session.limits.{replay_bytes: 1310720, lease_default_ms, lease_max_ms}`.

### 2.2 Calls

```ts
ListTerminals(pageKey: string): Promise<terminal.Listed[]>
AttachTerminal(sessionId: string, request: { page_key?: string; from_offset?: number }): Promise<terminal.Attached>
DetachTerminal(sessionId: string, request: { page_key?: string; lease_ms?: number }): Promise<terminal.Detached>
```

- `ListTerminals`: the terminals of the page's window that have a key, plus those that carry `pageKey`, sorted by creation. Each `Listed`: `id, created_at, pid, shell, labels, params, size, attached, next_offset, replay_start, lease_expires_unix_ms` (0 while attached) and `ended` (an `End`, only for a terminal that ended while no page was attached: 2.5). A terminal without a key is never listed.
- `AttachTerminal`: takes the terminal over for the calling window (its lease ends, the reader is let go) and answers `Attached`: `session` (what `CreateTerminal` said; its `cols`/`rows` are the size it STARTED at), `replay`, `cwd` (a `Directory`: where the shell is now), `busy` (a `Foreground`), `ended` (only for a terminal that had ended). `request.page_key` is the key the terminal was opened with; a window that is the terminal's owner needs none. `from_offset` is the offset of the first byte the page does not have; absent means "nothing". `from_offset` past the end of the output is refused `INVALID_REQUEST` naming it.
- `DetachTerminal`: what a leaving page may say (`pagehide`) to hold the shell at once instead of waiting for the realm to notice (server mode: about 3.4 s after the socket goes). `lease_ms` `0` is the terminal's own lease; above 30 minutes is cut to it and `Detached.lease_ms` says what applies, with `lease_expires_unix_ms`. A terminal that is already detached stays as it is.
- All three need a window (no window: 403 `FORBIDDEN`) and admit it (a retired window: the realm's `ErrWindowUnavailable`). A caller that may not attach is told `omniview:session/not-found`, which is what a terminal that is not there says, so a guess learns nothing; a terminal without a key says `NOT_REATTACHABLE` (409) to its own window and not-found to any other.

```ts
type Replay = { start: number; end: number;            // [start, end) of the terminal's one output sequence
  data: string;                                        // base64, the bytes of [start, end), untouched
  start_size: Size; start_modes: TerminalModes;        // what the bytes at `start` were written under
  size: Size; modes: TerminalModes }                   // and what is in force at `end`
type Size = { cols: number; rows: number }
type TerminalModes = { known: true; alt_screen: boolean; bracketed_paste: boolean; application_cursor: boolean; focus_events: boolean; cursor_hidden: boolean;
  mouse_tracking: number;   // bits: 1 click (?9, ?1000), 2 drag (?1002), 4 any motion (?1003)
  mouse_encoding: number;   // 0 X10, 1 UTF-8 (?1005), 2 SGR (?1006), 3 urxvt (?1015)
  kitty_keyboard: number[] }  // the flag stack of the screen showing, bottom first, at most 16
```

`start` is the offset the page asked for when the host still has it. Otherwise (no `from_offset`, or the ring has moved past it) it is the oldest offset the host kept, which is a boundary: not inside an escape sequence or a UTF-8 sequence. **`start > from_offset` means bytes were dropped between them**: the gap is stated, never hidden, and the page starts its emulator afresh. The modes are read by a Go scanner of the output (alt screen 47/1047/1049, mouse 9/1000/1002/1003 and 1005/1006/1015, 2004, 1, 1004, 25, the kitty keyboard stack per screen, DECSTR, RIS), cut-invariant (tested over every cut of random streams) and exact AT `start`, also after the bytes that set a mode fell out of the ring.

### 2.3 Events

| Name | Payload |
|---|---|
| `core/exec/stream/output/<id>` (terminal with a key) | `{ offset: number, data: base64 }`: `offset` is the number of bytes the terminal wrote before this event. Each event starts where the one before ended (tested). At most 20,480 bytes of data. |
| `core/exec/stream/stdout/<id>` (terminal without a key) | the bytes, base64 text, unchanged |
| `core/exec/signal/CLOSE/<id>` | `terminal.End` as before, plus `last_offset` (the length of the output, always present) and the new `closed_by: 'detach-timeout'` |

### 2.4 The protocol of a reloaded page (the rules that make the join exact)

1. Keep one key per page lineage in `sessionStorage`; make it when absent. A duplicated tab carries the same key: the later attach takes the terminal and the earlier tab is NOT told.
2. LISTEN FIRST: subscribe `core/exec/stream/output/<id>` and `core/exec/signal/CLOSE/<id>` for each terminal the page knows, and hold their events while a call is in flight.
3. `ListTerminals(key)`, match tabs by `id`, then `AttachTerminal(id, {page_key, from_offset})` with the number of bytes of that terminal's stream the page rendered (absent for a fresh emulator).
4. Apply the answer. Fresh or gapped (`from_offset` absent or `replay.start > from_offset`): reset the emulator (`ESC c`), set it to `start_size`, write a prologue that switches on `start_modes` (alt screen, mouse bits and encoding, bracketed paste, application cursor, focus events, hidden cursor, kitty pushes), then write `data` with `onData` MUTED (the emulator's replies to queries in the replay must not reach the shell), then resize to `size` (and bounce the size so a full-screen program redraws). Continuing (`start == from_offset`): write `data`, nothing else.
5. Then the held events, in order: DROP every event whose `offset` is below `replay.end` (the replay has it; an event never straddles `end`). The host counted those bytes before it forgot the debt, so
6. ACKNOWLEDGE only bytes taken from events and written to the emulator: never the replay, never a dropped duplicate (`AckTerminal` over-credits and the host's pause point moves up by what was over-acknowledged). The host keeps who gave credit across an attach: a page that acknowledged keeps being paced by acknowledgements, so a page that dies right after it attached still leaves the host at the high mark.
7. `ended` set: show how it ended and its output; no live output follows; `CloseSession(id)` dismisses it.

### 2.5 What ends a terminal, and what a detached one costs

| Event | Terminal with a key | Terminal without |
|---|---|---|
| window retired (native close; server-mode socket gone + sweep) | DETACHED, lease starts | ended, `closed_by: window` |
| `DetachTerminal` | detached | `NOT_REATTACHABLE` |
| attach before the lease ends | the lease ends, the new window owns it; the old window's late retirement finds nothing of its own | n/a |
| lease runs out | ended as a close: SIGHUP to the foreground group and the shell, SIGKILL after 1.5 s; one CLOSE `closed` / `detach-timeout` | n/a |
| `CloseSession`, host quit | ended (`request`, `shutdown`) | same |
| shell ends by itself while detached (or attached) | its end and its output are KEPT for the rest of its lease (a tombstone: at most 16, 1.25 MiB each at most, oldest dropped); listed with `ended`; `AttachTerminal` answers the replay and `ended`; `CloseSession` dismisses it | CLOSE only |
| a create or attach whose window was retired meanwhile | the create ends its own terminal and fails; the attach detaches it again | create ends it |

While detached the READER IS HELD: the host reads nothing more than the one read that was in flight (at most 20,480 bytes, kept in the ring) and the shell blocks in its own write; the host buffers nothing. The ring keeps `ReplayBytes` = `FlowHighBytes + FlowLowBytes` = 1,310,720 bytes in whole 64 KiB chunks (at least 1.19 MiB retained): the credit window of a client that acknowledges (1 MiB plus one read), so its reattach has no gap. A client that does not acknowledge can leave the host further ahead (T1-go 2.8.6) and then sees the gap in `start > from_offset`.

### 2.6 How a reloaded page finds ITS terminals

A server-mode reload is a NEW window identity (INV2: a new page is a new window), so the window cannot be the link; a native in-place reload keeps its identity and the window can. The link is the page's key, which the page makes and keeps in `sessionStorage` (it survives a reload and not a closed tab) and gives at creation, to `ListTerminals` and to `AttachTerminal`. A caller sees the terminals of its window and of its key and nothing else; an unknown or wrong key finds exactly what a missing terminal does. The key never appears in a list, an event, a log line or an error.

## 3. What works where

| | macOS arm64 | Linux | Windows |
|---|---|---|---|
| terminal package | `-race` run, green (the many-terminals test runs 40 shells under the race detector: 200 do not fill their rings in a useful time there) and without `-race` with 200 | `golang:1.27.4-bookworm` container, 200 shells, green (91.7 s) | `go vet` of the terminal and exec packages passes; every new call answers `UNSUPPORTED` or nothing |
| exec package | `-race` and `-tags server`, green | not built in the container (GTK) | `go vet` |

## 4. Verification (macOS, Darwin 27.0.0 arm64; tests first: compile-red for the new units, then 24 of the 28 behaviour tests failed against a stub that answered "not implemented" (23 because the feature was missing; the flow-hold test on a watchdog assumption of its own that was wrong and was corrected), the other 4 hold against the old behaviour and are proved by the negative controls below; the final suite is green)

| Claim | Test | Result |
|---|---|---|
| Offsets contiguous, every end has `last_offset`, a terminal without a key is delivered as before | `TestTheOutputOfATerminalWithAPageKey...`, `TestTheEndOfATerminalSaysHowManyBytesItWrote` | pass |
| **A reload under a flood reattaches byte-exact by offset**: the page dies at every MiB of 2,000,000 numbered lines (16.9 MB) and comes back 14 times, in random order (new page first, or release first), acknowledging only what it applied | `TestAReloadUnderAFloodReattachesByteExactByOffset` | page bytes equal the generator, equal the host's events, `last_offset` equals the length, 0 gaps, 0 straddling events |
| **20 reloads leave one shell with the same pid** (under `yes`; and 20 server-mode pages, each a new window) | `TestTwentyReloadsUnderYes...`, exec `TestTwentyReloadsOfAServerModePage...` | same pid every time, `ps` lists exactly that child, page bytes equal the host's events |
| **Flow is paused while detached**: the child blocks, the host buffers nothing | `TestADetachedTerminalHoldsItsFlood...` | 2 s detached under `yes`: 0 more bytes read, 0 s of CPU, heap +112 bytes, ring 1,247,050 of 1,310,720 |
| **200 detached sessions hold a bounded state** (20 floods, 180 bursts) and their leases leave nothing | `TestTwoHundredDetachedTerminals...` | 200 shells: heap 284 MiB over the baseline against a bound of 275 MiB (200 rings of 1.25 MiB and a chunk) plus 32 MiB; 4 goroutines each; no growth while they wait (8 MiB); every `End` `detach-timeout`, 0 processes, 0 children, memory given back. Under `-race`, 40 shells: 57 MiB against 55 MiB |
| **Negative controls**: 20 faults put into scratch copies of the sources (`T2-go/mutations.sh.txt`, `go test -overlay`; the worktree is not edited) | the test named for each | **20 of 20 red** (the lease generation, the attach that leaves the terminal detached, the hold, the restart, the offsets, `from_offset`, the boundary of the ring's front, the size log, the tombstone, the key check, the empty key, the lease timer, the release of a keyed terminal, the owner, the credit source, a ring smaller than the credit window, the owner checked by type, the old event name, a failed create and an attach to a retired window). Two were NOT detected at first (a ring smaller than the credit window, a front that begins inside a string): the reload test now waits for the host to run to the credit window before it detaches, and a new test makes titles longer than a chunk |
| Lease expiry leaves 0 processes (a shell that ignores SIGHUP is killed) | `TestALeaseThatRunsOut...` (terminal and exec) | pass |
| Op against itself: attach x attach, 40 rounds on a writing terminal: each reply is exactly the stream prefix | `TestAttachAgainstAttach...` | pass |
| attach x lease expiry, 150 rounds with leases of 1 to 3 ms and 60 ms: exactly one winner | `TestAttachAgainstLeaseExpiryHasExactlyOneWinner` | the attach won 77, the lease 73; no attach on a terminal the old lease ended |
| attach x close, 80 rounds | `TestAttachAgainstClose...` | attach first 23, close first 57; nothing hangs, nothing left |
| A stale lease timer firing after a re-detach does nothing (deterministic) | `TestTheExpiryOfALeaseThatWasEnded...` | pass |
| A storm of 8 goroutines (attach, detach, release, list, ack, resize) on a flooding terminal: the end state is one of two | `TestAStormOfAttachesAndDetaches...` | 48,670 calls; detached = no owner, held, lease running; attached = owner, not held, no timer |
| **End-state invariant** after a storm over 24 terminals with leases running out mid-storm, closes and the host quitting | `TestAfterEverythingSettles...` | 0 processes, 0 sessions, 0 timers, goroutines and descriptors back to the baseline |
| Window retired between the start and the answer of a create, or an attach: no leak, deterministic | exec `TestAWindowRetiredBetween...`; random: `TestAWindowRetiredWhileItsKeyedTerminalStarts...` | pass |
| Who may attach, who is listed, the key never listed, unkeyed refusals, key and lease validation | `TestOnlyTheKeyOrTheOwningWindow...`, `TestATerminalWithoutAPageKey...`, `TestAPageKeyAndALeaseAreChecked...` | pass |
| A terminal that ended while detached leaves its end and output; bounded; host-ended leaves none | `TestATerminalThatEndsWhileNoPageIsAttached...`, `TestTheHostRemembers...` | pass |
| Replay, sizes, modes: boundary start, cut-invariant tracker, size log, bounded ring, immutable view under a writer | `modes_test.go`, `replay_test.go`, `TestAnAttachSays...` | pass (`-race`) |
| The old UI: `AttachSession` reads the same ring; window close ends an unkeyed terminal | `TestTheLegacyAttach...`, `TestClosedByTheWindow...` | pass |

## 5. Not verified, and limits (stated, not hidden)

- No native window was reloaded and no real server-mode page: the exec-lane tests drive the wrapper through the host's own window realm and its page sweep. The UI protocol of 2.4 is exercised by a test page that follows it, not by the T2b UI, which does not exist yet.
- A read that is in flight when a terminal is detached completes (at most 20,480 bytes): it is read, kept in the ring and sent to nobody; the page gets it in the replay.
- macOS: a process cannot finish exiting while the pty it holds has output nobody reads, and nobody reads while detached; such a shell exits when a page attaches or its lease ends, not before. (The tests that end a detached shell on their own switch the echo off.)
- The page key is the capability and lives in the page: any script of the page can read it. Output events are broadcast to every window by id as before; the key guards attach and list, not the broadcast.
- A duplicated tab (same key): the later attach takes the terminal and the earlier tab is not told.
- The SDK's `Dropped` accounting, `mode_reset` on `End` and the unary `ReadOutput` are not built: the ring never drops silently (the gap is `start > from_offset`), and `mode_reset` is the lane's X4 step.
- The server-mode retention of T1-go 2.8.6 (S-c) is unchanged and is not fixed by acknowledgements.
- Linux: only the terminal package was run there (the exec package cannot be built in the container). Windows: `go vet` only.

## 6. Decisions for the lead

1. **Opt-in by key.** A terminal with `launch.page_key` is detached; one without ends with its window. That keeps the legacy UI and the T2a UI (no key) exactly as they are, and gives the T2b UI one field to add.
2. **A new event for keyed terminals**, `core/exec/stream/output/<id>` as `{offset, data}`, because the old payload is a bare base64 string that both UIs parse.
3. **Leases: 5 minutes by default, 30 at most** (the owner's numbers), per terminal at creation and cut at `DetachTerminal`. `closed_by: "detach-timeout"` is the SDK's word for the end.
4. **Tombstones** (16, kept for the lease) so that a shell that ended while no page was there is not lost with its last output and its exit code. Say if you would rather have `not-found`.
5. `CloseOwned` is replaced by `ReleaseOwned` (detach or end); a create whose window was retired meanwhile ends ITS terminal by id, not everything its window owned.
6. The Go type is `terminal.TerminalModes` (the SDK's name, with a `nolint:revive` for the stutter) so that the two read the same.

## 7. Log

- 2026-11-23: read the specs (`SDK2-exec-lane.md` 4.5, X3c; `T-terminal-prior-art.md` mechanism 2, rank 3, pitfall 4), the manager, the wrapper and the realm. Wrote the mode scanner, the ring and their tests first (compile-red), then the manager tests against a stub (24 failed), then the code.
- Found by the tests, not by reading: the in-flight read at detach; the extra CR that macOS's terminal inserts into `yes` at block boundaries (the check compares against the host's own events, not a pattern); BSD `seq` prints a million as `1e+06` (the flood uses `awk`); a page that acknowledges an event it dropped as a duplicate moves the host's pause point up (rule 6 of 2.4); an attach that forgot who gave credit let a page that died at once leave the host unbounded (the credit source is kept).
- 2026-11-23 (checks before the push): `golangci-lint` in CI form on the changed lines, native and `-tags server`: 0 issues; `go vet` for Windows (terminal, exec, shellenv, settings, root): clean; `task check:bindings-check`: rc 0; the runtime package's `tsc`, `build` and `api:check`: clean (the app-wide `tsc` reports only the unbuilt `@omniviewdev/kit` workspace package, as on the base). Also closed on the way: the owner is checked by value (CodeRabbit of #658, `manager.go:348`/`:806`), and the replay ring copies before the event leaves (`:520`).
