# The terminal channel: the protocol the new UI implements

Status: implemented by the host (`feat/terminal-channel-backend`, row T3-channel, `docs/ui-next/status/T3-channel.md`), not yet used by any UI. **Version 2** of the stream (`attach.v` 2, row T3-channel-wire, `docs/ui-next/status/T3-channel-wire.md`) adds what the host knows and the page used to guess: how much input was applied (`input_applied`, `applied`) and when a terminal that was taken away is free again (`released`). A page of version 1 gets `unsupported` (section 4); nothing else of version 1 is kept. The design and its measurements are in `proposals/T-terminal-channel.md`. This page is the contract for `terminalChannel.ts`, `localShell.ts` and `execFeed.ts`; the host's tests are the proof that it holds.

## 1. What it is

A terminal opened with `launch.channel` is reached by a **capability** and by **one stream per terminal**, and by nothing else:

- The capability is 32 random bytes of the host's, base64url without padding (43 characters). It is answered once, in the answer of `CreateTerminal`, and the host never lists, logs, puts in an event, a URL, a span, an error or a panic message.
- Output, replay, the end, input, resize and acknowledgements travel on the stream, which is a Wails GoStream: the same handler serves the native build (a held poll) and the server build (a WebSocket at `/wails/stream/ws`). The page opens `Stream('terminal')`; the name carries nothing secret, because GoStream puts it in a URL.
- A channel terminal is **invisible to the events lane**. It sends no `core/exec/stream/...` event of any kind, it is absent from `ListSessions`, `ListTerminals` and every other answer, and every binding that takes a session id (`GetSession`, `AttachSession`, `DetachSession`, `WriteSession`, `CloseSession`, `ResizeSession`, `WriteTerminal`, `ResizeTerminal`, `IsBusy`, `GetCwd`, `AckTerminal`, `AttachTerminal`, `DetachTerminal`) answers it what an id that never existed gets, in the same words, whoever calls. The id is a label; it opens nothing.
- It has **no window**. Closing or reloading a window ends no channel terminal; a call from no window may start one.

## 2. Getting a capability

```ts
const session = await ExecClient.CreateTerminal(opts, { channel: true, cols, rows, cwd, lease_ms })
session.cap   // the capability: keep it in memory and in the tab's sessionStorage (id -> cap), which survives a reload and which no other window reads; NOT in the host window-state slot (WindowClient.GetState / ListStates answer any window and any caller, and windows.json keeps the slots on disk); never log it
```

- `launch.channel` excludes `launch.page_key` (refused `INVALID_REQUEST`, naming `page_key`).
- `lease_ms` means what it means for a keyed terminal: how long the terminal is kept once nothing holds it. Zero is five minutes, the most is thirty minutes. **A new channel terminal is on its lease from the moment it is made**, and the first stream that shows the capability ends it: a page that dies before it opens the stream leaves no shell behind.
- The answer's `limits` state every number below that applies to this terminal (`channel_ring_bytes`, `channel_high_bytes`, `channel_low_bytes`, `channel_stall_ms`, `channel_inflight_bytes`, `channel_frame_bytes`, `channel_max_input_bytes`).

### Where the capability lives

The page keeps the capability **in memory and in its own tab's `sessionStorage`, as `id -> cap`**. A reload of the tab keeps that storage and no other window and no other caller can read it, so a reload re-attaches by the capability with `from_offset`: on the native build, in a real WKWebView, the old stream ended 18 ms after the reload and the new one got `ready` with `lost` 0 and the output the shell had written meanwhile. It does **not** keep it in the host window-state slot (`WindowClient.SaveState`, `GetState`, `ListStates`): those calls take a window *name* and answer any window and any caller (in the server build every page is named `main`), and `windows.json` keeps the slots on disk in plaintext; the review of PR 704 had a second window read the first one's capability from its slot and drive its terminal. The page key (`terminal-page-key`) is a label of the keyed terminals of the events lane and opens nothing of a channel terminal (`launch.channel` refuses `page_key`).

- A reload recovers a channel terminal **only** by the capability from the tab's own storage. `ListChannelTerminals` answers only for capabilities it is given, so recovery by reload widens nothing. A tab whose storage is gone has lost its capabilities, and its terminals end at their lease.
- `sessionStorage` is not a boundary against code that runs in the same page (B-112); it is one against other windows and other callers, which is what the capability needs.
- The UI change that opens a channel terminal must carry a test that its code never passes a capability to `WindowClient.SaveState`.

## 3. The calls (all additive, all denied to remote audit browsers)

| Call | Answers |
|---|---|
| `CloseChannelTerminal(capability)` | ends the terminal as `CloseSession` does and returns when it is gone |
| `ChannelTerminalBusy(capability)` | `terminal.Foreground` (`idle`, `busy` with the program's name, `unknown`) |
| `ChannelTerminalCwd(capability)` | `terminal.Directory` |
| `ListChannelTerminals(capabilities)` | `ChannelListed[]`: one entry for each capability that opens a terminal or the kept end of one, **in the order given, naming the terminal by its id**; none for a capability that opens nothing. It never enumerates: at most 1,024 capabilities, and nothing is answered for one that was not given. Match entries to your slots by `id`. |
| `DismissChannelTerminal(capability)` | forgets the end a terminal left (section 9). A terminal that is alive is closed, not dismissed. |

Every one of them answers **one error**, `omniview:session/not-found` (404), whatever the reason a capability opens nothing: it is missing, malformed, wrong by a byte, the id of a terminal, a terminal that ended and was dismissed, one that is closing. The words of the answer hold nothing the caller sent.

## 4. Frames

One frame is one binary message of the stream: a **1-byte type**, then the payload. Integers are big-endian (a `DataView` default). Types below `0x80` go page to host, types from `0x80` go host to page.

| Type | Name | Direction | Payload |
|---|---|---|---|
| `0x01` | `attach` | page to host | UTF-8 JSON `{"v":2,"cap":"<capability>","from_offset":<u64, optional>}`, at most 1,024 bytes. **The first frame of the stream, and the only attach.** |
| `0x02` | `input` | page to host | the raw bytes, at most 1 MiB (`channel_max_input_bytes`). An empty input is a no-op. |
| `0x03` | `resize` | page to host | `cols` (u16), `rows` (u16); each from 1 to 1,000. |
| `0x04` | `ack` | page to host | `n` (u32): bytes of **output** the page parsed since its last acknowledgement. |
| `0x05` | `detach` | page to host | empty. The page is leaving: the terminal is let go at once and the host closes the stream. |
| `0x06` | `close` | page to host | empty. The page asks that the terminal end, **on its own stream**: it ends only when this stream is the current holder (section 8). |
| `0x81` | `ready` | host to page | UTF-8 JSON, section 5. The first frame the host sends, always. |
| `0x82` | `output` | host to page | `offset` (u64) of the first byte, then the bytes: at most 64 KiB (`channel_frame_bytes`), and, for a page that acknowledges, at most the credit that is left of its window (section 7). |
| `0x83` | `gap` | host to page | `from` (u64), `to` (u64): the bytes `[from, to)` were overwritten before they were sent. The next output starts at `to`. |
| `0x84` | `ended` | host to page | UTF-8 JSON `terminal.End` (`reason` `exited`, `signaled`, `closed` or `failed`, its typed fields, and `last_offset`). |
| `0x85` | `taken-over` | host to page | empty. Another stream took the terminal. This stream is now a **watcher** (section 8): it stays open, it is sent no output, and it is sent `released` or `ended` and then closed. |
| `0x86` | `not-found` | host to page | empty. The capability opens nothing; this stream closes. |
| `0x87` | `applied` | host to page | `n` (u64): the bytes of input the host has applied from this capability, across streams, so far (section 5, "Input applied"). Sent to the stream that holds the terminal only. |
| `0x88` | `released` | host to page | empty. Said once to a watcher (a stream that was sent `taken-over`) when the stream that held the terminal ended and the terminal is running and free (detached, on its lease). The host closes the watcher after it. |
| `0x8a` | `close-refused` | host to page | empty. A `close` of a stream that does not hold the terminal (a watcher): nothing ended, the stream goes on as a watcher. At least one is sent for the closes the stream sent while the sender was busy (they may be coalesced). |
| `0x89` | `unsupported` | host to page | UTF-8 JSON `{"v":2}`: the version the host speaks. The answer to a well-formed `attach` of another version; the host closes the stream. It is decided from the request alone, before any capability is looked at, so it says nothing about whether the capability opens a terminal. |

There is no `lease` frame: while a stream holds the terminal no lease runs, and when it ends there is nobody to tell. `ready.lease_ms` states how long the terminal is kept after this stream ends.

## 5. The handshake

1. The page opens the stream and sends `attach`. **Nothing is read before it.** A wrong, missing or malformed capability, a request that states no version, a frame of another type, a frame over 1,024 bytes: the host sends exactly one frame, `0x86`, byte for byte the same whatever the reason, and closes. There is no other answer: a stream cannot ask whether a capability exists. **A page sends its `attach` as soon as the stream opens**: a stream that has sent nothing 10 s after it opened is closed by the host, with no answer (the 10 s is not one of the `limits` fields). The transport has no ping and no read deadline of its own, so a connection that says nothing would otherwise keep its slot for ever. The boundary is not exact: an `attach` that arrives at the very moment the wait ends may find the stream closed, and the page attaches again, as it does for any stream that ends.
   An `attach` that is well formed and names a capability but states **another version** than 2 is answered with one frame, `0x89 unsupported {"v":2}`, and the host closes the stream. The answer is the same for a capability that opens a terminal and one that does not (the version is decided before any capability is looked at), so a page of version 1 learns the version and nothing about the capability. A request that states no version is malformed and gets `not-found`.
2. The host answers `ready`:

```json
{"v":2,"start":0,"end":8,"lost":0,"input_applied":0,
 "size":{"cols":100,"rows":30},"start_size":{"cols":100,"rows":30},
 "modes":{...},"start_modes":{...},
 "cwd":{"path":"/home/u"},"busy":{"state":"idle"},
 "session":{...the answer of CreateTerminal, without cap...},
 "lease_ms":300000,"ended":null}
```

   `start` is the first byte the stream will carry (the `from_offset` the page gave when the host still has it; otherwise the oldest byte the host kept, at a boundary that is not inside an escape or a UTF-8 sequence). `end` is where the shell had written to when the page took the terminal: the bytes `[start, end)` are the **replay**, everything after is live. `size` and `modes` are what is in force at `end`; `start_size` and `start_modes` are what the first byte of the replay was written under. A page that starts an emulator at `start` sets `start_size` and `start_modes` first, writes the replay with its replies to queries muted (output whose `offset` is below `end`), then resizes to `size`. `lost` is how much of what the page asked for is gone: `start - from_offset` when `from_offset` is below `start`, and zero when the page gave none. `ended` is set when the terminal had already ended (section 9). `input_applied` is the input the host has applied from this capability (next paragraph).

   **Input applied.** The host counts, for each terminal and across all its streams, the bytes of input it has written to the terminal's pty master: `input_applied`, a `u64` that starts at zero and **never decreases**. A write counts **when it returns**, and counts the bytes the pty took: a write that blocks in the kernel (a program that does not read its terminal) counts when it returns, and one that fails after part of its bytes counts the part. A resize, an empty input and any input the host refused (from a stream that does not hold the terminal, section 8) are never counted. Whatever a displaced stream had already had admitted to the queue before the handover is applied, and counted, before anything the new holder sends. `ready.input_applied` is therefore the count **plus the bytes still queued ahead of this stream's input**: the page that reads it has been told what it must not send again, and the host does not tell it a number that it will have to take back. The stream that holds the terminal is then sent `0x87 applied{n}` with the new count after input frames have been applied: at most one frame for each batch of writes that returned (a stream whose frames are parked in the transport is told once, with the total, when it takes frames again), never more frames than input frames the stream sent, never a number that is not above the last one the stream was told (`ready`'s included), and nothing to a watcher. The page keeps every byte of input it sent after the last number it saw and, after a lost stream, sends the bytes after `input_applied` of the next `ready` again: that is what the host did not apply. The number counts the terminal's input, not a page's: it is exact for a page that is the only one that types into the capability (a duplicated tab types into the same count, and the page that resends from it is told by its own bookkeeping, not by this field, which of the two sent what).
3. Then `output` frames: first the replay, then what the shell writes, **on one ordered connection, with no gap and no byte twice at the join**: replay and live output are one read of the host's ring, so there is nothing to join. Each frame's `offset` is where the one before ended, or the `to` of a `gap` that came between. **No output frame straddles `end`**: the shell may have written more by the time the first frame is composed, and the frame that carries the end of the replay stops at `end`, so that a page that mutes its replies for the frames whose `offset` is below `end` mutes exactly the replay, and not the live bytes that follow. (A `gap` that crosses `end` ends the replay: the page resets, and what follows the gap is live.)
4. An `attach` whose `from_offset` is past the end of the output is not this terminal's offset: the stream closes with no answer.

## 6. Bytes, offsets, gaps

Every byte the shell writes has an offset, its position in the one sequence of the terminal's output, counted from zero. The page keeps the offset it has applied up to and, after a reload or a lost stream, attaches again with `from_offset` set to it. The host replays from exactly there when it still has the bytes, so a page that reloads under a flood has every byte once and in order (the host's tests reload a page at random places of a 2 MB flood, twenty times, and compare byte for byte).

A `gap` is the host saying, honestly, that it could not keep what the page had not taken: the page writes nothing for `[from, to)`, resets its emulator (`ESC c`) and continues at `to` with the modes of the next `ready` or its own tracking. A `ready.lost` above zero is the same fact for an attach. Nothing is ever lost silently, and `sent + gap = end` holds at every moment the host is caught up (the tests assert it).

## 7. A page that sleeps (the hidden-page policy)

A locked screen or a hidden window suspends the page: it cannot read or acknowledge. The shell must not stall for ever at a credit limit, as the pty hosts of VS Code and JetBrains do not. The host reads the shell into a **bounded ring** whatever the page does:

- **The pump never depends on the page.** It reads, appends to the ring (`channel_ring_bytes`, default 8 MiB) and advances `end`. When the ring is full it overwrites its oldest bytes and counts them (`overwritten`, always the output less what the ring holds).
- **Backpressure only while the page is alive, and lossless.** While more than `channel_high_bytes` (1 MiB) of output wait unsent, and the page made progress within `channel_stall_ms` (2 s) (a frame the transport took, or an `ack`), the pump waits until the sender has brought the backlog down to `channel_low_bytes` (256 KiB): a slow page that is alive gets every byte, and the shell goes at its speed. When no progress came for the stall, or nobody holds the terminal, the pump does not wait: the shell is never blocked by a page that sleeps. When progress comes back the pump waits again from the new backlog.
- **When the page wakes** the parked `Send` returns, the stream emits one `gap{from, to}` for what the ring overwrote meanwhile, then continues from the first byte the ring still has.
- **`ack` is optional.** A page that acknowledges (the first `ack` turns it on) holds at most `channel_inflight_bytes` (1 MiB) sent and not acknowledged, for its own memory; acknowledge the bytes of `output` frames only, never a `gap`. The host counts a frame as sent from the moment it hands it to the transport, so an `ack` for a frame can come before the host's own `Send` of it has returned and is kept; the output is **cut to the credit that is left**, so a page that acknowledges when it holds a whole window of unacknowledged bytes is always given that window, whatever the size of the frames, and a frame is never held back for lack of the credit it needs but cannot get. A page that never acknowledges is limited only by the transport: its output is paced by what Wails' queue takes.
- The credit of the events lane (`AckTerminal`, the watchdog, `DeliveryReporter`) is not used for a channel terminal.

## 8. Holder, detach, takeover, lease

- **The connection is the holder.** When the stream ends however it ends (the page is gone, Wails closed it, the host is shutting down) the terminal is *detached*: nobody holds it, its shell goes on (its output goes into the ring), and its lease runs. A new stream that shows the capability, with `from_offset`, takes it again, byte-exact. At the end of the lease the terminal ends as a close does, `closed_by: "detach-timeout"`.
- **A second stream with the same capability takes the terminal** (a duplicated tab carries a copy of the tab's `sessionStorage`). The first stream is sent `taken-over` after the frame it may be parked in, and **stays open as a watcher**; from the moment of the handover its input, resizes and acknowledgements are refused and dropped (never counted, section 5), and it is sent no output and no `applied`. A protocol violation or a `detach` closes a watcher as it closes any stream; a watcher holds nothing, so its leaving changes nothing for the holder or the lease.
- **Close on the stream.** The page ends a terminal with `close` (0x06) on its stream. The decision that the stream holds the terminal and the decision that the terminal ends are one step under the terminal's lock: from the **holder** the terminal ends as `CloseChannelTerminal` ends it (the hangup, then the kill at the end of the grace) and the stream is sent the rest of the output and `ended{closed, closed_by: "request"}` as for any end; from a **watcher** (a displaced stream) it ends nothing and the stream is sent `0x8a close-refused` and stays a watcher, so a displaced tab that closes cannot end the terminal another stream holds. A close that loses a race with a takeover is the displaced stream's and is refused; a close that wins it decides the end first, and a stream that attaches after it is told `not-found` (the terminal is not claimable). A `close` that is the first frame of a stream is not an attach: the one `not-found`, and nothing ends (a stream that is not attached ends nothing). A `close` with a payload breaks the protocol. **`CloseChannelTerminal(capability)` is kept as it is**, for the page that never attached (a fresh capability nobody else holds) and for a page that cannot hold a stream: it ends the terminal for whoever shows the capability, so a page that may have been displaced without knowing uses `close` on a live stream instead.
- **Watchers and `released`.** A watcher waits for one of three things, and the host closes it after the frame:
  - the stream that holds the terminal **ends while the terminal runs** (detach, page gone, host side close of the stream): the terminal is now detached and on its lease, and every watcher is sent `0x88 released`, once. The fact is stated at the instant the holder lets go, under the terminal's lock: a stream that attaches a moment later takes the terminal from nobody, the watchers have been told already and are not told again, and a watcher that attaches takes it back as any stream does. The page that is told `released` attaches again, with `from_offset`, when it wants the terminal (it does not guess: there is no poll);
  - the terminal **ends** (the shell exited, a close, a shutdown): every watcher is sent `ended{End}` (the same frame, the same `last_offset`; no output) and never `released`. When the end of the terminal is decided before the holder's stream lets go, the terminal is never free: the watcher is told `ended`. When the holder's stream lets go first, the watcher is told `released` and is closed before the end can reach it;
  - a stream that was displaced and **attaches a new stream** to take the terminal back opens a **new stream** with a new `attach` (an attach is the first and only attach of a stream, as before). The page closes its old watcher with `detach` when it takes the terminal back, or leaves it: the old watcher is told `released` when the new holder ends, and is closed then.
- **The watchers of a terminal are bounded: at most four.** When a fifth stream is displaced, the one that has watched longest is closed, with no frame after its `taken-over` (the page that sees its watcher close with no `released` and no `ended` knows that it lost the terminal and that the host no longer tells it when it is free). A watcher lives no longer than the holder's stream that it watches: it is released, ended or closed when that stream ends, so a watcher outlives neither the terminal nor the lease. A watcher is not a holder: it does not stop or start a lease, and it is not counted as an attachment.
- Who holds the terminal and what a frame does to it are decided in one step under the terminal's lock. Input admitted before a handover is applied before the new holder's (and counted by the `input_applied` of the new holder's `ready`), input after it is refused, a close that wins a race with an attach wins entirely, two attaches at once have one winner, and a terminal whose end is decided cannot be claimed (the attach is told `not-found`).
- A frame that is too short or too long for its type, a size that is not one, an unknown type, a type that is the host's, a second `attach`, or a first frame that is not an `attach`: the host closes the stream, with no answer once it has attached (and `not-found` before). The terminal is detached as for any end of a stream, and nothing panics.
- Frames of one stream are applied in order, one at a time: a write that blocks in the kernel (a program that does not read its terminal) holds up that stream's later frames, `ack` included. The input queue holds at most 1 MiB of unapplied input (`channel_max_input_bytes`): **input that does not fit the room that is left waits for room**, and is never dropped, so that a write of 512 KiB that is blocked and a frame of 1 MiB do not make 1.5 MiB. While it waits the stream's right to type is looked at again at every change: if another stream took the terminal meanwhile, the input is refused (it was the displaced stream's) and the new holder's goes on to wait in its turn. A page that has typed more than the shell reads therefore sees its later frames (acknowledgements too) held up until the shell has read.

## 9. Ending

- When the shell ends the stream that holds it is sent every byte, then `ended{End}`, then the host closes it. `last_offset` is the length of everything the shell wrote.
- The end is kept (the output too) **when the shell ended by itself**, until `DismissChannelTerminal(capability)`, or the lease would have run out, or **more than 16 ends of channel terminals are kept, when the oldest goes first**: the time that a kept end is listed with (`lease_expires_unix_ms`) is the latest it is kept until, and not a promise that it is still there. The ends of channel terminals have a budget of their own (16) and the events lane's another (16): neither takes what the other is owed. A stream that shows the capability then gets `ready` with `ended` set (and `input_applied` 0: nothing more is ever written to a terminal that ended, so the page resends nothing), the output from `from_offset`, `ended` again, and the host closes it. A terminal the host closed (`CloseChannelTerminal`, the lease, a shutdown) leaves nothing: its capability opens nothing afterwards.
- A capability that is dismissed, expired or closed opens nothing: the one not-found.

## 10. A worked example

Page and host, a shell that prints `hi`, waits for a line and prints `bye`:

```
page -> host  01 7b 22 76 22 3a 32 2c 22 63 61 70 22 3a 22 ... 22 7d        attach {"v":2,"cap":"..."}
host -> page  81 7b 22 76 22 3a 32 2c 22 73 74 61 72 74 22 3a 30 ...         ready  {"v":2,"start":0,"end":4,"input_applied":0,...}
host -> page  82 00 00 00 00 00 00 00 00 68 69 0d 0a                          output offset 0, "hi\r\n"
page -> host  02 67 6f 0a                                                     input  "go\n"
host -> page  87 00 00 00 00 00 00 00 03                                      applied 3 (the shell took "go\n")
host -> page  82 00 00 00 00 00 00 00 04 62 79 65 0d 0a                       output offset 4, "bye\r\n"
page -> host  04 00 00 00 09                                                  ack    9
host -> page  84 7b 22 72 65 61 73 6f 6e 22 3a 22 65 78 69 74 65 64 ...       ended  {"reason":"exited","exit_code":0,"last_offset":9}
(the host closes the stream)
```

A terminal that another tab took and then released: the first tab sees `85` (`taken-over`), nothing else while the second tab holds the terminal, and `88` (`released`) the moment the second tab's stream ends, after which the host closes it; the first tab then sends `attach` on a new stream with its offset if it wants the terminal back. If the terminal ends first, the first tab sees `84 <ended>` instead.

A page that was hidden for a minute under `yes` and wakes sees, instead: `82 <offset 0> <64 KiB>` (the frame that was parked), `83 <from 65536> <to 5242880>` (the gap), then `82 <offset 5242880> ...` and on.

## 11. What the page does

1. Opens `Stream('terminal')`, sets `binaryType = 'arraybuffer'`, waits for `open`, sends `attach` with its capability and `from_offset` (the offset it applied up to, absent for a fresh emulator).
2. Takes `ready` first, sets up the emulator from `start_size`, `start_modes`, writes the replay muted, then `size`.
3. Applies `output` by offset (it never needs to drop a duplicate: there is none), `gap` as in section 6, `ended`, `taken-over` (stops typing, shows the terminal as taken and keeps the stream: it is a watcher), `close-refused` (its close ended nothing: it is not the holder), `released` (the terminal is free: shows "take it back"; it needs no poll), `applied` (drops from its buffer the bytes of input up to `n`), `unsupported` (the host speaks another version: stops, does not retry), `not-found` (forgets the capability).
4. Sends `input`, `resize`, `ack`, `close` (to end the terminal, on a live stream) and `detach` on `pagehide`. It never retries a frame on a stream: order is the stream's. It keeps the input it sent that the host has not said it applied (`ready.input_applied`, then `applied`), and after a new `ready` it sends the bytes after `input_applied` again, once and in order.
5. When the stream closes with no `ended`, `taken-over`, `released`, `unsupported` or `not-found`, it attaches again with its offset, with a backoff, and gives up after a few tries.

## 12. Not in this change

The UI that uses all of this, and the removal of the events lane for terminals, are the next two changes: the UI change switches the new UI to the channel (the lane stays until then); the Go change "step 6, delete at the flip" removes, for terminals, the events lane (`core/exec/stream/output|CLOSE|DETACHED`), the host credit of `AckTerminal` with `flow.go`'s watchdog and the stack-recognition of the credit point, `DeliveryReporter`, the bare-id local terminal bindings, the legacy offers and ownership by window. Its trigger is the UI change merged with the new UI as the default. No double pathway may remain after it.
