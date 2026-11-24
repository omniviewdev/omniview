# The terminal channel: the protocol the new UI implements

Status: implemented by the host (`feat/terminal-channel-backend`, row T3-channel, `docs/ui-next/status/T3-channel.md`), not yet used by any UI. The design and its measurements are in `proposals/T-terminal-channel.md`. This page is the contract for `terminalChannel.ts`, `localShell.ts` and `execFeed.ts`; the host's tests are the proof that it holds.

## 1. What it is

A terminal opened with `launch.channel` is reached by a **capability** and by **one stream per terminal**, and by nothing else:

- The capability is 32 random bytes of the host's, base64url without padding (43 characters). It is answered once, in the answer of `CreateTerminal`, and the host never lists, logs, puts in an event, a URL, a span, an error or a panic message.
- Output, replay, the end, input, resize and acknowledgements travel on the stream, which is a Wails GoStream: the same handler serves the native build (a held poll) and the server build (a WebSocket at `/wails/stream/ws`). The page opens `Stream('terminal')`; the name carries nothing secret, because GoStream puts it in a URL.
- A channel terminal is **invisible to the events lane**. It sends no `core/exec/stream/...` event of any kind, it is absent from `ListSessions`, `ListTerminals` and every other answer, and every binding that takes a session id (`GetSession`, `AttachSession`, `DetachSession`, `WriteSession`, `CloseSession`, `ResizeSession`, `WriteTerminal`, `ResizeTerminal`, `IsBusy`, `GetCwd`, `AckTerminal`, `AttachTerminal`, `DetachTerminal`) answers it what an id that never existed gets, in the same words, whoever calls. The id is a label; it opens nothing.
- It has **no window**. Closing or reloading a window ends no channel terminal; a call from no window may start one.

## 2. Getting a capability

```ts
const session = await ExecClient.CreateTerminal(opts, { channel: true, cols, rows, cwd, lease_ms })
session.cap   // the capability: keep it in memory and in the host window-state slot id -> cap; never log it
```

- `launch.channel` excludes `launch.page_key` (refused `INVALID_REQUEST`, naming `page_key`).
- `lease_ms` means what it means for a keyed terminal: how long the terminal is kept once nothing holds it. Zero is five minutes, the most is thirty minutes. **A new channel terminal is on its lease from the moment it is made**, and the first stream that shows the capability ends it: a page that dies before it opens the stream leaves no shell behind.
- The answer's `limits` state every number below that applies to this terminal (`channel_ring_bytes`, `channel_high_bytes`, `channel_low_bytes`, `channel_stall_ms`, `channel_inflight_bytes`, `channel_frame_bytes`, `channel_max_input_bytes`).

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
| `0x01` | `attach` | page to host | UTF-8 JSON `{"v":1,"cap":"<capability>","from_offset":<u64, optional>}`, at most 1,024 bytes. **The first frame of the stream, and the only attach.** |
| `0x02` | `input` | page to host | the raw bytes, at most 1 MiB (`channel_max_input_bytes`). An empty input is a no-op. |
| `0x03` | `resize` | page to host | `cols` (u16), `rows` (u16); each from 1 to 1,000. |
| `0x04` | `ack` | page to host | `n` (u32): bytes of **output** the page parsed since its last acknowledgement. |
| `0x05` | `detach` | page to host | empty. The page is leaving: the terminal is let go at once and the host closes the stream. |
| `0x81` | `ready` | host to page | UTF-8 JSON, section 5. The first frame the host sends, always. |
| `0x82` | `output` | host to page | `offset` (u64) of the first byte, then the bytes: at most 64 KiB (`channel_frame_bytes`). |
| `0x83` | `gap` | host to page | `from` (u64), `to` (u64): the bytes `[from, to)` were overwritten before they were sent. The next output starts at `to`. |
| `0x84` | `ended` | host to page | UTF-8 JSON `terminal.End` (`reason` `exited`, `signaled`, `closed` or `failed`, its typed fields, and `last_offset`). |
| `0x85` | `taken-over` | host to page | empty. Another stream took the terminal; this stream closes. |
| `0x86` | `not-found` | host to page | empty. The capability opens nothing; this stream closes. |

There is no `lease` frame: while a stream holds the terminal no lease runs, and when it ends there is nobody to tell. `ready.lease_ms` states how long the terminal is kept after this stream ends.

## 5. The handshake

1. The page opens the stream and sends `attach`. **Nothing is read before it.** A wrong, missing or malformed capability, a request of another version, a frame of another type, a frame over 1,024 bytes: the host sends exactly one frame, `0x86`, byte for byte the same whatever the reason, and closes. There is no other answer: a stream cannot ask whether a capability exists.
2. The host answers `ready`:

```json
{"v":1,"start":0,"end":8,"lost":0,
 "size":{"cols":100,"rows":30},"start_size":{"cols":100,"rows":30},
 "modes":{...},"start_modes":{...},
 "cwd":{"path":"/home/u"},"busy":{"state":"idle"},
 "session":{...the answer of CreateTerminal, without cap...},
 "lease_ms":300000,"ended":null}
```

   `start` is the first byte the stream will carry (the `from_offset` the page gave when the host still has it; otherwise the oldest byte the host kept, at a boundary that is not inside an escape or a UTF-8 sequence). `end` is where the shell had written to when the page took the terminal: the bytes `[start, end)` are the **replay**, everything after is live. `size` and `modes` are what is in force at `end`; `start_size` and `start_modes` are what the first byte of the replay was written under. A page that starts an emulator at `start` sets `start_size` and `start_modes` first, writes the replay with its replies to queries muted (output whose `offset` is below `end`), then resizes to `size`. `lost` is how much of what the page asked for is gone: `start - from_offset` when `from_offset` is below `start`, and zero when the page gave none. `ended` is set when the terminal had already ended (section 9).
3. Then `output` frames: first the replay, then what the shell writes, **on one ordered connection, with no gap and no byte twice at the join**: replay and live output are one read of the host's ring, so there is nothing to join. Each frame's `offset` is where the one before ended, or the `to` of a `gap` that came between.
4. An `attach` whose `from_offset` is past the end of the output is not this terminal's offset: the stream closes with no answer.

## 6. Bytes, offsets, gaps

Every byte the shell writes has an offset, its position in the one sequence of the terminal's output, counted from zero. The page keeps the offset it has applied up to and, after a reload or a lost stream, attaches again with `from_offset` set to it. The host replays from exactly there when it still has the bytes, so a page that reloads under a flood has every byte once and in order (the host's tests reload a page at random places of a 2 MB flood, twenty times, and compare byte for byte).

A `gap` is the host saying, honestly, that it could not keep what the page had not taken: the page writes nothing for `[from, to)`, resets its emulator (`ESC c`) and continues at `to` with the modes of the next `ready` or its own tracking. A `ready.lost` above zero is the same fact for an attach. Nothing is ever lost silently, and `sent + gap = end` holds at every moment the host is caught up (the tests assert it).

## 7. A page that sleeps (the hidden-page policy)

A locked screen or a hidden window suspends the page: it cannot read or acknowledge. The shell must not stall for ever at a credit limit, as the pty hosts of VS Code and JetBrains do not. The host reads the shell into a **bounded ring** whatever the page does:

- **The pump never depends on the page.** It reads, appends to the ring (`channel_ring_bytes`, default 8 MiB) and advances `end`. When the ring is full it overwrites its oldest bytes and counts them (`overwritten`, always the output less what the ring holds).
- **Backpressure only while the page is alive, and lossless.** While more than `channel_high_bytes` (1 MiB) of output wait unsent, and the page made progress within `channel_stall_ms` (2 s) (a frame the transport took, or an `ack`), the pump waits until the sender has brought the backlog down to `channel_low_bytes` (256 KiB): a slow page that is alive gets every byte, and the shell goes at its speed. When no progress came for the stall, or nobody holds the terminal, the pump does not wait: the shell is never blocked by a page that sleeps. When progress comes back the pump waits again from the new backlog.
- **When the page wakes** the parked `Send` returns, the stream emits one `gap{from, to}` for what the ring overwrote meanwhile, then continues from the first byte the ring still has.
- **`ack` is optional.** A page that acknowledges (the first `ack` turns it on) holds at most `channel_inflight_bytes` (1 MiB) sent and not acknowledged, for its own memory; acknowledge the bytes of `output` frames only, never a `gap`. A page that never acknowledges is limited only by the transport: its output is paced by what Wails' queue takes.
- The credit of the events lane (`AckTerminal`, the watchdog, `DeliveryReporter`) is not used for a channel terminal.

## 8. Holder, detach, takeover, lease

- **The connection is the holder.** When the stream ends however it ends (the page is gone, Wails closed it, the host is shutting down) the terminal is *detached*: nobody holds it, its shell goes on (its output goes into the ring), and its lease runs. A new stream that shows the capability, with `from_offset`, takes it again, byte-exact. At the end of the lease the terminal ends as a close does, `closed_by: "detach-timeout"`.
- **A second stream with the same capability takes the terminal** (a duplicated tab carries a copy of the slot). The first stream is sent `taken-over` after the frame it may be parked in, and closes; from the moment of the handover it cannot type: its input and acknowledgements are refused. The displaced tab takes it back by attaching again.
- Who holds the terminal and what a frame does to it are decided in one step under the terminal's lock. Input admitted before a handover is applied before the new holder's, input after it is refused, a close that wins a race with an attach wins entirely, two attaches at once have one winner, and a terminal whose end is decided cannot be claimed (the attach is told `not-found`).
- A frame that is too short or too long for its type, a size that is not one, an unknown type, a type that is the host's, a second `attach`, or a first frame that is not an `attach`: the host closes the stream, with no answer once it has attached (and `not-found` before). The terminal is detached as for any end of a stream, and nothing panics.
- Frames of one stream are applied in order, one at a time: a write that blocks in the kernel (a program that does not read its terminal) holds up that stream's later frames, `ack` included.

## 9. Ending

- When the shell ends the stream that holds it is sent every byte, then `ended{End}`, then the host closes it. `last_offset` is the length of everything the shell wrote.
- The end is kept (the output too) **when the shell ended by itself**, until `DismissChannelTerminal(capability)` or the lease would have run out (at most 16 are kept). A stream that shows the capability then gets `ready` with `ended` set, the output from `from_offset`, `ended` again, and the host closes it. A terminal the host closed (`CloseChannelTerminal`, the lease, a shutdown) leaves nothing: its capability opens nothing afterwards.
- A capability that is dismissed, expired or closed opens nothing: the one not-found.

## 10. A worked example

Page and host, a shell that prints `hi`, waits for a line and prints `bye`:

```
page -> host  01 7b 22 76 22 3a 31 2c 22 63 61 70 22 3a 22 ... 22 7d        attach {"v":1,"cap":"..."}
host -> page  81 7b 22 76 22 3a 31 2c 22 73 74 61 72 74 22 3a 30 ...         ready  {"v":1,"start":0,"end":4,...}
host -> page  82 00 00 00 00 00 00 00 00 68 69 0d 0a                          output offset 0, "hi\r\n"
page -> host  02 67 6f 0a                                                     input  "go\n"
host -> page  82 00 00 00 00 00 00 00 04 62 79 65 0d 0a                       output offset 4, "bye\r\n"
page -> host  04 00 00 00 0a                                                  ack    10
host -> page  84 7b 22 72 65 61 73 6f 6e 22 3a 22 65 78 69 74 65 64 ...       ended  {"reason":"exited","exit_code":0,"last_offset":10}
(the host closes the stream)
```

A page that was hidden for a minute under `yes` and wakes sees, instead: `82 <offset 0> <64 KiB>` (the frame that was parked), `83 <from 65536> <to 5242880>` (the gap), then `82 <offset 5242880> ...` and on.

## 11. What the page does

1. Opens `Stream('terminal')`, sets `binaryType = 'arraybuffer'`, waits for `open`, sends `attach` with its capability and `from_offset` (the offset it applied up to, absent for a fresh emulator).
2. Takes `ready` first, sets up the emulator from `start_size`, `start_modes`, writes the replay muted, then `size`.
3. Applies `output` by offset (it never needs to drop a duplicate: there is none), `gap` as in section 6, `ended`, `taken-over` (stops typing, shows the terminal as taken), `not-found` (forgets the capability).
4. Sends `input`, `resize`, `ack`, and `detach` on `pagehide`. It never retries a frame: order is the stream's.
5. When the stream closes with no `ended`, `taken-over` or `not-found`, it attaches again with its offset, with a backoff, and gives up after a few tries.

## 12. Not in this change

The UI that uses all of this, and the removal of the events lane for terminals, are the next two changes: the UI change switches the new UI to the channel (the lane stays until then); the Go change "step 6, delete at the flip" removes, for terminals, the events lane (`core/exec/stream/output|CLOSE|DETACHED`), the host credit of `AckTerminal` with `flow.go`'s watchdog and the stack-recognition of the credit point, `DeliveryReporter`, the bare-id local terminal bindings, the legacy offers and ownership by window. Its trigger is the UI change merged with the new UI as the default. No double pathway may remain after it.
