# Status: T3-channel-wire (the channel stream, version 2: `input_applied` / `applied` and `released`)

- Agent: ChannelWire (for Main). Ask: the two backend-catalog WIRE items of the page work, asked on #693: (1) a displaced holder is not told when the terminal is free again (the page polls `ListChannelTerminals` every 5 s); (2) input the page sent on a stream that dropped may be lost and the page cannot tell what the host applied. Rule of the owner: the producer states the fact, the consumer never guesses; a breaking change once, with a version bump and a plain refusal (HOW-WE-WORK 11).
- Worktree: `~/omniview/wt/t693-wire`. Branch: `feat/terminal-channel-released-and-applied`, from `origin/main` `13af4d32`. **Host side only; not pushed.** The page consumes it in the next change.
- Owned and changed: `backend/pkg/terminal/{channel.go,channel_serve.go,ordered.go}` (`ordered.go` only for the input accounting: one optional callback of an operation), the tests `channel_wire_test.go`, `channel_wire_version_test.go`, `channel_holder_test.go` (two tests of the old "a displaced stream is closed"), the helpers of the channel tests, the protocol document, this file and `T3-channel-wire/mutations.sh.txt`. Not touched: `manager.go`, `env.go`, `integration*`, `internal/shellenv`, `terminal_stream.go` (the adapter needed nothing: every frame is one `Send` of the sender's goroutine, as before).
- Commits: red `88bd7b76` (version tests), green `e7272e64` (version 2 and `unsupported`), red `d2206b7c` (applied, released, watchers, the pairs, the end state), green `686f2390` (the host), then the test and document commits that follow it on the branch.

## 1. The wire (protocol document sections 4, 5, 8 and the worked example say it in full)

| What | Decision |
|---|---|
| Version | `attach.v` is **2**; `ready.v` is 2. A well-formed attach naming a capability of **another version** gets `0x89 unsupported {"v":2}` and the stream closes. Decided from the request alone before any capability is looked at: the same bytes for a capability that opens a terminal and one that does not. A request that states no version (or `0`) is malformed: the one `not-found`. Nothing else of version 1 is kept. (The alternative, the plain `not-found`, would have told a page of version 1 that its capability was wrong.) |
| Input applied | `input_applied` (u64): bytes written to the pty master **from the capability, across streams**, counted **when each write returns**, by the bytes the device took (a write that blocks counts when it returns; a write that fails after part of its bytes counts the part). A resize, an empty input and refused input never count. **Never decreases.** |
| `ready.input_applied` | The count **plus the bytes the queue holds ahead of this stream's input** (admitted and not yet written), read in the same step under the terminal's lock that decides the holder. Reason: what the old holder had admitted is applied before anything the new holder sends (the rule of the stream since #704); a `ready` that said only what was written would make the page send those bytes again and the shell would read them twice. |
| `0x87 applied{u64}` | To the stream that holds the terminal only, after writes returned: at most one frame for each batch (a sender whose page takes frames slowly sends once, with the total), never more frames than input frames, and only when the count is above the last number the stream was told (its `ready`'s included): the page never sees a number go down or repeat. A watcher is sent none. |
| What a displaced stream had queued | Applied, as before: admitted before the handover, applied before the new holder's. What it sends after the handover is refused and counted in neither number. |
| Displaced stream | **Stays open as a watcher**: `taken-over` after the frame it may be parked in, then input, resize and ack are refused and dropped, no output, no `applied`. A `detach` or a protocol violation closes it as it closes any stream. Not a holder: no lease change, no attachment. |
| `0x88 released` | Said **once** to each watcher when the stream that held the terminal ends **while the terminal runs** (the terminal is then detached, on its lease). Decided in the step under the terminal's lock that lets the holder go: a stream that attaches a moment later changes nothing for a watcher that was told, and a watcher is never told while another stream holds the terminal. The host closes the watcher after the frame. |
| Terminal ends | A watcher is sent `ended{End}` (no output) and never `released`. If the end of the terminal is decided **before** the holder's stream lets go, the terminal is never free (the watcher is told `ended`); if the holder lets go first, the watcher is told `released` and is closed before the end reaches it. |
| Taking it back | **A new stream** with a new `attach` (an attach stays the first and only attach of a stream). The page closes its old watcher with `detach`, or leaves it: it is told `released` when the new holder ends. No frame of "re-attach on this stream". |
| Bound | At most **4** watchers for a terminal; when a fifth is displaced the one that has watched longest is closed with **no frame** after its `taken-over` (a page that sees its watcher close without `released` or `ended` knows it lost the terminal and that the host no longer tells it when it is free). A watcher lives no longer than the holder's stream it watches: it is released, ended or closed when that stream ends, so it outlives neither the terminal nor the lease. |
| Kept end | `ready` of the kept end of a terminal has `input_applied` 0: nothing more is written to a terminal that ended. |

Not decided here (page side): the page keeps what it sent after the last number it saw and sends the bytes after `ready.input_applied` again, once and in order. The number is the terminal's, not a page's: it is exact for a page that is the only one that types into the capability (document, section 5).

## 2. Verification (Linux x64, Go 1.27.4)

Tests first: `88bd7b76` has the two version tests and **both failed by assertion** (the host answered `0x86` and a `ready` of version 1); `d2206b7c` has the 14 tests of `channel_wire_test.go` and **all 14 failed by assertion or by the wait for the frame the test names** ("the page never saw applied 3", "the stream closed", "the device took 16 bytes and ready of the last stream says 0"); no panic, no build failure. `686f2390` turns them green and updates the two older tests that asserted that a displaced stream is closed (`TestASecondStream...`, `TestOneWinner...`: eight attaches at once now leave one holder, four watchers and three streams closed by the bound).

| Claim | Test |
|---|---|
| Applied counts exactly the bytes written, when the write returns and not before (the host's own counter is zero while the write is inside the device); resize counts nothing; a write that fails after 2 of 4 bytes counts 2 | `TestAppliedCountsTheBytesWrittenWhenTheWriteReturnsAndNotBefore`, `TestAppliedCountsOnlyTheBytesTheDeviceTookAndNothingForAResize` |
| At most one frame for a batch: three writes while the first frame is parked in the transport are told as `[1, 6]` | `TestAppliedIsCoalescedWhileThePageTakesNothing` |
| Across a reconnect: `ready` says what the first stream's input came to and the next stream goes on from it | `TestAppliedSurvivesAReconnectAndTheNextStreamGoesOnFromIt` |
| A write that blocks across a reconnect is counted by the next `ready` and the next stream is never told a number twice | `TestAWriteThatBlocksAcrossAReconnectIsCountedByTheNextReadyAndNotToldTwice` |
| Refused input of a displaced stream is never counted | `TestInputOfADisplacedStreamIsNeverCounted` |
| **Applied against a takeover** (the write in the device when the terminal is taken) | `TestAppliedAndATakeoverAtOnceCountEveryByteOnceAndTellOnlyTheHolder` |
| A displaced stream stays open, is refused, is sent no output, and is told `released` once when the terminal is free; the terminal is detached, on its lease | `TestADisplacedStreamStaysAsAWatcherAndIsToldOnceWhenTheTerminalIsFree` |
| A watcher is told `ended`, never `released`, when the terminal ends | `TestAWatcherIsToldHowTheTerminalEndedAndNeverThatItIsFree` |
| **The holder ending against the terminal ending**, both orders (the end is decided by hand under the lock first, or the holder's stream ends first) | `TestTheHolderEndingAndTheTerminalEndingAtOnceAreToldInTheOrderTheyHappened` |
| **The release against a new attach**, both orders | `TestAReleaseAndANewAttachAtOnceTellEveryWatcherOnceAndNeverEarly` |
| The watcher bound (6 streams: the oldest is closed with no frame, four are released once each) | `TestAtMostFourStreamsWatchATerminalAndTheOldestIsClosedWithoutAFrame` |
| A watcher that leaves changes nothing for the holder or the lease | `TestAWatcherThatLeavesChangesNothingForTheHolderAndTheLease` |
| **End state after a storm** (5 goroutines, 30 rounds each, attach / type / die / detach / violate / resize at random against one terminal): every page kept the protocol (no fault, no output or `applied` after `taken-over`, `released` once and last, never with `ended`, no more `applied` frames than inputs), `ready` of the last stream equals the bytes the device took, and after the close 0 sessions, goroutines and descriptors back | `TestAStormOfStreamsKeepsTheProtocolCountsEveryByteOnceAndLeavesNothing` |
| Version 1 gets `unsupported` for a capability that opens and one that does not, and opens nothing; version 2 gets `ready` of version 2 | `channel_wire_version_test.go` |

No test is decided by a sleep: the order is forced by a gated device (a write waits in the device until the test lets it through), a gated child (`headGateTail`), a parked `Send`, and decisions made by hand (`s.decide`, `s.startClose`).

### Negative controls (`docs/ui-next/status/T3-channel-wire/mutations.sh.txt`)

Each is a fault in a scratch copy of one source file, built with `go test -overlay` (the worktree is not edited), run twice: with the fault the named tests must fail by an assertion; with the fault and the assertions it is named for switched off (`TERMINAL_CHANNEL_CONTROL_OFF`) they must pass. **17 controls, 17 red with the fault, 17 green with the guards off.** (The first run of the script found three defects of the tests, not of the host: a control whose fault no test could see because a watcher is woken only when it is released, and a race of a test that read the device's log before its write was recorded; both tests were fixed and the three controls rerun.)

| Control (the fault) | Guards | Red |
|---|---|---|
| applied counted before the write, not when it returns | `applied-after-the-write`, `applied-counts-written` | 2 tests |
| refused input is counted (the holder test removed from the admission) | `refused-not-counted` | 1 |
| `ready` leaves out the queued input | `ready-counts-queued-input`, `applied-from-the-ready-value` | 2 |
| the sender ignores the number its `ready` stated | `applied-from-the-ready-value` | 2 |
| one `applied` frame for each byte | `applied-coalesced` | 1 |
| `ready` says `input_applied` 0 | `ready-input-applied`, `applied-after-the-write` | 1 |
| a watcher is sent `applied` | `only-the-holder-is-told` | 1 |
| the displaced stream is closed at once | `watcher-stays-open`, `displaced-cannot-type`, `released-once` | 1 |
| watchers not bounded | `watcher-bound` | 1 |
| `released` when the terminal is ending | `released-not-on-terminal-end` | 1 |
| the end is not sent to a watcher | `ended-not-released` | 1 |
| `released` sent twice | `released-once` | 2 |
| a watcher that ends frees the others | `released-only-when-free`, `watcher-is-not-holder` | 1 |
| a watcher that ends lets go of the holder | `released-only-when-free`, `watcher-is-not-holder` | 2 |
| an evicted watcher is not closed | `watcher-bound`, `storm-end-state` | 2 |
| the queue's count is not kept | `storm-applied` | 1 |
| another version opens the terminal | `unsupported-closes`, `version-refusal-opens-nothing` | 1 |

## 3. Checks run

See the end of this file (section 4), filled in with what was run and what was not.

## 4. Not verified

- The page side: nothing in `ui-next/` consumes version 2 yet (the next change); the document is the contract.
- macOS and Windows: not run. `GOOS=windows go vet` of the package and of the exec package is part of section 3; the channel files are `!windows`.
- The real host over a real WebSocket with a real browser: the streamroute test (server build) passes version 2 frames over a real route; no browser was run.
- `TestAShellThatIsNotInstalledFallsBackAndTheAnswerSaysWhichStarted` (shell fallback, not the channel) fails in this container on the branch with only the version bump and again with the whole change; it was not run on `origin/main` and its cause was not investigated. `TestTheKillAtTheGraceTargetsTheForegroundThatIsThereThenAndNotTheOneTheHangupFound` failed once in a loaded run and passed in the next; it does not touch the channel.
