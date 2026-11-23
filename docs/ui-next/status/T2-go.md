# Status: T2-go (a local terminal survives a window reload)

- Agent: TerminalSignals. Goal (lead's ask, 2026-11-23): a terminal's shell outlives the window or page that opened it, for a lease; the page that comes back finds ITS terminals, takes one over, and is handed what it missed, with no byte lost and none repeated. The legacy UI and the T2a UI (which passes no key) are unchanged: this is additive.
- Worktree: `~/Repos/omniviewdev/worktrees/t2-go-terminal-reattach`. Branch: `feat/t2-go-terminal-reattach`, on `origin/main` `c0e21161` (T2a, #671). The independent review of #674 (ReviewHost658: S1 to S4 and the notes) is answered in the last push: see 2.7, section 4 and the log.
- Owned and changed: `backend/pkg/terminal/**` (new: `reattach.go`, `reattach_types.go`, `replay.go`, `modes.go`; changed: `manager.go`, `flow.go`, `pty.go`, `types.go`, `errors.go`, `manager_windows.go`), `backend/pkg/plugin/exec/{service_wrapper,controller,terminal}.go` and their tests, the regenerated bindings, `internal/auditgate/policy.json` (`AttachTerminal`, `DetachTerminal`, `ListTerminals`: denied to plugins and agents), this file, and two sentences of `T1-go.md`.
- Names follow the SDK v2 exec lane (`SDK2-exec-lane.md` 4.5 and X3c) so that the local provider can adopt the lane's session later without a second shape: `Replay{start, end, data, start_size, start_modes, size, modes}`, `TerminalModes{known, alt_screen, bracketed_paste, application_cursor, focus_events, cursor_hidden, mouse_tracking, mouse_encoding, kitty_keyboard}`, `Detached{lease_expires_unix_ms}`, `closed_by: "detach-timeout"`, `last_offset`, a ring in 64 KiB chunks with absolute offsets, a size log. `data` stands where the SDK sends the bytes as `Output` frames, because the call is one answer.

## 1. The ask, in one table

| # | Ask | Now | Where |
|---|---|---|---|
| 1 | A byte OFFSET on every output event and on the ring | a terminal opened with `launch.page_key` sends `core/exec/stream/output/<id>` as `{offset, data}`; the ring is addressed by offset; every `End` has `last_offset` | `replay.go`, `reattach.go` `record`, `exec/terminal.go` |
| 2 | DETACH separate from DESTROY, with a LEASE | a window retired or reloaded DETACHES a terminal that has a key and keeps it 5 minutes (at most 30); the lease running out ends it as a close does (`closed_by: "detach-timeout"`); the host quitting ends it | `reattach.go` `ReleaseOwned`, `detachLocked`, `expire` |
| 3 | An atomic `AttachTerminal(id, from_offset?)` | `{session, replay{start, end, data, sizes, modes}, cwd, busy, attachment, ended?}`; the live events continue at `replay.end`; the page that held the terminal is told (`DETACHED`) | `reattach.go` `Attach`, `takeOver` |
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
- `AttachTerminal`: takes the terminal over for the calling window (its lease ends, the reader is let go) and answers `Attached`: `session` (what `CreateTerminal` said; its `cols`/`rows` are the size it STARTED at), `replay`, `cwd` (a `Directory`: where the shell is now), `busy` (a `Foreground`), `attachment` (the number of THIS attachment: the window that opened the terminal held 0, and every attach is the next number; 2.3), `ended` (only for a terminal that had ended). `request.page_key` is the key the terminal was opened with; a window that is the terminal's owner needs none. `from_offset` is the offset of the first byte the page does not have; absent means "nothing". `from_offset` past the end of the output is refused `INVALID_REQUEST` naming it. The page that held the terminal before is told on `DETACHED` (2.3).
- `DetachTerminal`: what a leaving page may say (`pagehide`) to hold the shell at once instead of waiting for the realm to notice (server mode: about 3.4 s after the socket goes). `lease_ms` `0` is the terminal's own lease; above 30 minutes is cut to it and `Detached.lease_ms` says what applies, with `lease_expires_unix_ms`. A terminal that is already detached stays as it is. **The window that OWNS the terminal detaches it; the key detaches only a terminal that no window owns**: a page that was displaced (a duplicated tab shares the key, and the later attach took the terminal) is told `omniview:session/not-found`, so its closing tab cannot detach what the other tab shows.
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
| `core/exec/signal/DETACHED/<id>` | `{ by: 'taken-over' \| 'requested' \| 'window-retired', attachment: number }`: a page that held the terminal lost it. `attachment` is the number of the attachment that ENDED: the page that holds that number lost the terminal (the creating page holds 0; a page that attached holds `Attached.attachment`), and the page that took it over holds the next one, so it is not concerned by the event that displaced the other. `taken-over`: another page attached it; `requested`: the owner called `DetachTerminal`; `window-retired`: the owner's window went away. Every window gets it, as every event: compare the number. Not sent for an attach to a terminal nobody held, a refused call, or a retirement that finds nothing of its own. The END of a terminal is the CLOSE event, not this one. |

### 2.4 The protocol of a reloaded page (the rules that make the join exact)

1. Keep one key per page lineage in `sessionStorage`; make it when absent. A duplicated tab carries the same key: the later attach takes the terminal, and the earlier tab is TOLD (`DETACHED`, `taken-over`, with the number it holds: step 8) and its `DetachTerminal` is refused.
2. LISTEN FIRST: subscribe `core/exec/stream/output/<id>`, `core/exec/signal/CLOSE/<id>` and `core/exec/signal/DETACHED/<id>` for each terminal the page already knows, and hold the output events while a call is in flight.
3. `ListTerminals(key)` and match tabs by `id`. **For every id the page did not know (a fresh page knows none), subscribe its three events NOW, before the attach, and hold the output events** (the replay covers everything below `replay.end`, so a subscription made after the list and before the attach loses nothing). Then `AttachTerminal(id, {page_key, from_offset})` with the number of bytes of that terminal's stream the page rendered (absent for a fresh emulator). Keep the `attachment` of the answer.
4. Apply the answer. Fresh or gapped (`from_offset` absent or `replay.start > from_offset`): reset the emulator (`ESC c`), set it to `start_size`, write a prologue that switches on `start_modes` (alt screen, mouse bits and encoding, bracketed paste, application cursor, focus events, hidden cursor, kitty pushes), then write `data` with `onData` MUTED (the emulator's replies to queries in the replay must not reach the shell), then resize to `size` (and bounce the size so a full-screen program redraws). Continuing (`start == from_offset`): write `data`, nothing else.
5. Then the held events, in order, and EVERY later event: DROP each one whose bytes the page has, that is `offset + length <= next` (`next` is the offset the page has applied up to: `replay.end` just after the attach). ALWAYS, held or live: an event the replay covers was handed to the transport before the attach answered, and an event and a reply travel apart, so one can arrive AFTER the answer (the reviewer saw 7 in 2,051 reattaches on Linux arm64, 0 in 5,176 on macOS; whole events, never straddling `end`, never a gap). An event at `next` is applied; one above it is a gap, which must not happen: say so. The host counted a dropped event's bytes before the attach forgot the debt, so do not acknowledge them (6).
6. ACKNOWLEDGE only bytes taken from events and written to the emulator: never the replay, never a dropped duplicate (`AckTerminal` over-credits and the host's pause point moves up by what was over-acknowledged). The host keeps who gave credit across an attach: a page that acknowledged keeps being paced by acknowledgements, so a page that dies right after it attached still leaves the host at the high mark.
7. `ended` set: show how it ended and its output; no live output follows; `CloseSession(id)` dismisses it.
8. `DETACHED` whose `attachment` is the number the page holds: the page lost the terminal. `taken-over`: another tab has it now; `requested` / `window-retired`: it was detached (its lease runs). Stop writing to it and show it as moved or waiting. Do NOT send `DetachTerminal` (refused) or `CloseSession` (it would end the terminal the other tab shows) for it on `pagehide`; the user takes it back with `ListTerminals` and `AttachTerminal`. A number that is not the page's is not its business.

### 2.5 What ends a terminal, and what a detached one costs

| Event | Terminal with a key | Terminal without |
|---|---|---|
| window retired (native close; server-mode socket gone + sweep) | DETACHED, lease starts | ended, `closed_by: window` |
| `DetachTerminal` | detached (by the owning window; by the key only when no window owns it) | `NOT_REATTACHABLE` |
| attach before the lease ends | the lease ends, the new window owns it, the next attachment; the old window's late retirement finds nothing of its own | n/a |
| attach while another page holds the terminal | the new window owns it, the next attachment number; the page that held it is told (`DETACHED` `taken-over`); its late `DetachTerminal` is refused | n/a |
| lease runs out | ended as a close: SIGHUP to the foreground group and the shell, SIGKILL after 1.5 s; one CLOSE `closed` / `detach-timeout` | n/a |
| `CloseSession`, host quit | ended (`request`, `shutdown`) | same |
| shell ends by itself while detached (or attached) | its end and its output are KEPT for the rest of its lease (a tombstone: at most 16, 1.25 MiB each at most, oldest dropped, each freed by a timer when its lease is over; the one timer stops at shutdown); listed with `ended`; `AttachTerminal` answers the replay and `ended`; `CloseSession` dismisses it | CLOSE only |
| a create or attach whose window was retired meanwhile | the create ends its own terminal and fails; the attach detaches it again | create ends it |

While detached the READER IS HELD: the host reads nothing more than the one read that was in flight (at most 20,480 bytes, kept in the ring) and the shell blocks in its own write; the host buffers nothing. The ring keeps `ReplayBytes` = `FlowHighBytes + FlowLowBytes` = 1,310,720 bytes in whole 64 KiB chunks (at least 1.19 MiB retained): the credit window of a client that acknowledges (1 MiB plus one read), so its reattach has no gap. A client that does not acknowledge can leave the host further ahead (T1-go 2.8.6) and then sees the gap in `start > from_offset`.

### 2.6 How a reloaded page finds ITS terminals

A server-mode reload is a NEW window identity (INV2: a new page is a new window), so the window cannot be the link; a native in-place reload keeps its identity and the window can. The link is the page's key, which the page makes and keeps in `sessionStorage` (it survives a reload and not a closed tab) and gives at creation, to `ListTerminals` and to `AttachTerminal`. A caller sees the terminals of its window and of its key and nothing else; an unknown or wrong key finds exactly what a missing terminal does. The key never appears in a list, an event, a log line or an error.

### 2.7 What the key guards, and what it does not

The key is an anti-hijack token for the REATTACH path: it guards `ListTerminals`, `AttachTerminal` and `DetachTerminal` (and the last also needs that no other window owns the terminal). It is NOT a confidentiality boundary, because the calls and events of the T1 surface take a terminal by its id alone, as before this PR, and a keyed terminal's id is listed by `ListSessions` to every window:

| With a keyed terminal's id and no key | what happens |
|---|---|
| the events `core/exec/stream/output/<id>`, `core/exec/signal/CLOSE/<id>`, `core/exec/signal/DETACHED/<id>` | broadcast to every window |
| `WriteSession`, `WriteTerminal`, `ResizeTerminal`, `AckTerminal`, `CloseSession`, `IsBusy`, `GetCwd` | act: type, resize, credit, end, read the directory and the foreground |
| the legacy `AttachSession(id)` | returns the whole replay ring (up to 1.25 MiB of output) and marks it attached; the terminal stays detached, held, its lease running |
| `ListSessions`, `GetSession` | disclose the id |

(ReviewHost658 ran it on the real host: window B with no key, A's keyed terminal id from `ListSessions`: B received A's output events, typed into A's shell, and read the replay ring with `AttachSession`.)

Who can call them. Every bound method can be called by the page's own code, and plugin UI bundles run in that page: `importPlugin.ts` `import()`s them into it and `@omniviewdev/runtime` exports `ExecClient` (`api.ts`), so a plugin's UI can call every call above, and it can read the page's `sessionStorage`, where the key is. The audit policy (`internal/auditgate/policy.json`) is another thing: the allowlist of what a REMOTE, view-only audit browser may reach. It denies every call above except `ListSessions` and `GetSession` (which disclose ids only) and every event under `core/exec/stream/` and `core/exec/signal/`; the three new calls and `DetachSession` are pinned as denied (`TestDangerousMethodsStayDenied`). A remote audit browser cannot read a terminal's output or type into it; a plugin UI in the page can, as it could before this PR.

Proposed fix (NOT in this PR: it changes the T1 surface, for keyed terminals only, and nothing creates a keyed terminal before T2b): (1) for a keyed terminal, `WriteSession`, `WriteTerminal`, `ResizeTerminal`, `AckTerminal`, `CloseSession`, `IsBusy`, `GetCwd`, `DetachSession` and `AttachSession` require the caller's window to own it (they take the `ctx` the new calls have; a page that does not own the terminal attaches first, which needs the key); (2) `ListSessions` and `GetSession` leave out the keyed terminals of other windows; (3) the output events of a keyed terminal go to the owner's window only, which needs an emit addressed to a window, and server mode has one bus and filters by topic. With (1) and (2) the key keeps a stranger from typing and from reading the history; with (3) also from reading the live output. A plugin UI inside the owner's page stays inside the page's trust whatever is done. Recommended: (1) and (2) with T2b.

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
| **200 detached sessions hold a bounded state** (20 floods, 180 bursts) and their leases leave nothing | `TestTwoHundredDetachedTerminals...` | 200 shells: heap 284 MiB over the baseline (the reviewer measured 285.1 on macOS and 284.7 on Linux) against a bound of 312.5 MiB = 200 × (the ring, 1.25 MiB, two 64 KiB chunks, and 0.1875 MiB for what a terminal holds besides its ring: 0.15 measured), with no other slack. (The first push stated 275 MiB and passed on 32 MiB of slack: the stated bound was wrong, not the measurement.) 4 goroutines each; no growth while they wait (8 MiB); every `End` `detach-timeout`, 0 processes, 0 children, memory given back. Under `-race`, 40 shells: 57 MiB against 62.5 |
| **Negative controls**: 30 faults put into scratch copies of the sources (`T2-go/mutations.sh.txt`, `go test -overlay`; the worktree is not edited) | the test named for each | **30 of 30 red**: the 20 of the first push (the lease generation, the attach that leaves the terminal detached, the hold, the restart, the offsets, `from_offset`, the boundary of the ring's front, the size log, the tombstone, the key check, the empty key, the lease timer, the release of a keyed terminal, the owner, the credit source, a ring smaller than the credit window, the owner checked by type, the old event name, a failed create and an attach to a retired window), the failed create now two controls (it never closes; it closes what another window took over), and, for the review fixes, the owner check of `Detach`, a reader that does not hold up an attach, a takeover, a window retirement and a detach that do not tell the page, the attachment that is not counted, a tombstone timer that is never armed and one that outlives the shutdown, and the policy that allows `AttachTerminal`. The review found one control stale (`a-failed-create-keeps-its-terminal`: its `sed` no longer matched after the second commit, `FAULT NOT APPLIED`), and one of the new ones did not compile at first (`NOT A DETECTION`, which the script reports as such): both are fixed. Two controls of the first push were NOT detected at first (a ring smaller than the credit window, a front that begins inside a string): the reload test now waits for the host to run to the credit window before it detaches, and a new test makes titles longer than a chunk |
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
| **S1: a displaced page cannot detach what the page that took over owns** | `TestAPageThatWasDisplacedCannotDetach...`; exec `TestADisplacedPageIsToldAndCannotDetach...`; the reviewer's `TestReview3_DisplacedTabDetach` | red on `e80049dc` (the old tab's `DetachTerminal(key)` succeeded: the terminal was detached under the new tab and ended at its lease), green with the owner check; the owner still detaches, the key detaches a terminal nobody owns, and it is idempotent |
| **A page is told when it loses a terminal** (taken over / requested / window retired), with the number of the attachment that ended; nothing for an attach that displaces nobody, a refused call or a late retirement | `TestAPageIsToldWhen...`; exec `TestADisplacedPageIsToldAndCannotDetach...` | red (no number, no event), green; the wire is `{"by":"taken-over","attachment":0}` |
| **S2: an attach does not answer while a read its replay holds is on its way to the sink**, so no event below `replay.end` is handed to the transport after the answer | `TestAnAttachDoesNotAnswerWhile...` | deterministic (a sink holds the first event): red (the attach answered at once and the event followed it), green (the attach waits for the event). The old race: 7 events in 2,051 reattaches on Linux arm64 (the reviewer) |
| **Tombstones are freed by a timer** when their lease is over (one timer, for the earliest; none after the shutdown) | `TestTombstonesThatExpired...` | red (never freed), green |
| **S4: the three new calls and `DetachSession` are pinned as denied** | `TestDangerousMethodsStayDenied` | pass; the control `the-policy-allows-attach-terminal` flips `AttachTerminal` to allow and the test fails |

## 5. Not verified, and limits (stated, not hidden)

- No native window was reloaded and no real server-mode page: the exec-lane tests drive the wrapper through the host's own window realm and its page sweep. The UI protocol of 2.4 is exercised by a test page that follows it, not by the T2b UI, which does not exist yet.
- A read that is in flight when a terminal is detached completes (at most 20,480 bytes): it is read, kept in the ring and sent to nobody; the page gets it in the replay.
- macOS: a process cannot finish exiting while the pty it holds has output nobody reads, and nobody reads while detached; such a shell exits when a page attaches or its lease ends, not before. (The tests that end a detached shell on their own switch the echo off.)
- The negative controls name the test that turns red for each fault; they do not repeat each fault with the named assertion removed to show that it then passes undetected (the project's rule for a negative control). That is a follow-up.
- The page key is the capability and lives in the page: any script of the page can read it. It guards `ListTerminals`, `AttachTerminal` and `DetachTerminal` only: every other call and every event takes a terminal by its id, as before (2.7: what that means, who can call them, and the fix proposed).
- A duplicated tab (same key): the later attach takes the terminal and the earlier tab is told (`DETACHED` `taken-over`); its `DetachTerminal` is refused, but it can still type, resize and close by id (2.7), and its acknowledgements still add credit (`Manager.Ack(id, n)` takes no owner: the reviewer's reading, not run).
- An event the replay holds can still reach the page after the attach's answer (an event and a reply travel apart): the host hands every such event to the transport before it answers, and the page drops by offset, always (2.4 rule 5).
- A shell that ignores SIGHUP (`trap '' HUP`) with a background job leaves the job after a lease ran out, as it does after a plain `CloseSession` (macOS and Linux, the reviewer's control); dash leaves its jobs at shutdown (as in the #658 review).
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
7. **Detach is the owner's** (S1): the key detaches only a terminal that no window owns. A page that was displaced cannot detach what the page that took the terminal over shows; the cost is that a key holder that is not the owner can no longer park the other tab's terminal, which nothing needs.
8. **A typed `DETACHED` event and an attachment number** (S1, never silent): `core/exec/signal/DETACHED/<id>` as `{by, attachment}` and `Attached.attachment`. Events are broadcast, so the number is how a page tells its own loss from the one it caused. Say if you would rather have the event only for `taken-over`.
9. **The key is not a confidentiality boundary yet** (S3): the statement and the proposal are in 2.7. The fix changes the T1 surface for keyed terminals only and nothing creates one until T2b, so it can ride with T2b.

## 7. Log

- 2026-11-23: read the specs (`SDK2-exec-lane.md` 4.5, X3c; `T-terminal-prior-art.md` mechanism 2, rank 3, pitfall 4), the manager, the wrapper and the realm. Wrote the mode scanner, the ring and their tests first (compile-red), then the manager tests against a stub (24 failed), then the code.
- Found by the tests, not by reading: the in-flight read at detach; the extra CR that macOS's terminal inserts into `yes` at block boundaries (the check compares against the host's own events, not a pattern); BSD `seq` prints a million as `1e+06` (the flood uses `awk`); a page that acknowledges an event it dropped as a duplicate moves the host's pause point up (rule 6 of 2.4); an attach that forgot who gave credit let a page that died at once leave the host unbounded (the credit source is kept).
- 2026-11-23 (checks before the push): `golangci-lint` in CI form on the changed lines, native and `-tags server`: 0 issues; `go vet` for Windows (terminal, exec, shellenv, settings, root): clean; `task check:bindings-check`: rc 0; the runtime package's `tsc`, `build` and `api:check`: clean (the app-wide `tsc` reports only the unbuilt `@omniviewdev/kit` workspace package, as on the base). Also closed on the way: the owner is checked by value (CodeRabbit of #658, `manager.go:348`/`:806`), and the replay ring copies before the event leaves (`:520`).
- 2026-11-23 (the review of #674, ReviewHost658, head `e80049dc`): S1 reproduced by the reviewer's own test (red), fixed (the owner check in `Detach`) and tested at the manager and at the exec lane; "never silent" is the `DETACHED` event and `Attached.attachment`; S2 tested deterministically with a sink that holds the first event (red: the attach answered at once and the event followed it) and fixed by an `emitMu` that the reader holds from the number of a read to its hand-over to the sink and an attach takes first, and the contract now says the page drops by offset always; S3 is 2.7 (what the key guards, who can call the bare-id calls, the audit policy, the proposed fix); S4 pins the three calls and `DetachSession`; tombstones are freed by a timer (stopped at shutdown); the stale control is two controls and all 30 were run again; the bound of the 200-terminal test is per terminal. Run again on the fixed head: the reviewer's own tests (replay byte-exact over 12 runs of 24 MiB with a strict page: 0 stale events after the answer; the lifecycle pairs, 470 rounds: 0 violations; lease expiry, shutdown with detached terminals, `from_offset` edges, modes: pass; his tombstone test now sees the 16 freed with nobody asking), the terminal package and shellenv under `-race`, the exec package under `-race` and with `-tags server`, the audit policy tests, `go vet` for Windows, `task check:bindings-check`.
