# T-terminal-channel: terminal access by capability, output on a per-terminal stream

> **Copy for the terminal handoff** (2026-11-24), unchanged: a design note of the lead's (`T-terminal-channel.md`). It is a design and a spike, not shipped code; the spike branch is public (`wip/spike/terminal-channel`, no PR). Cross-references: `T1-go.md`, `T2-go.md` and `T2b.md` are in `../status/`; "SDK2 exec lane" is `exec-lane.md` and the prior-art study is `prior-art.md`, both in this folder; `T2c-go.md` and the review of #677 are private notes (what they found is in section 1 here and in `backend-catalog-terminal.md`). The backend step of this design may be in progress: the epic says where.
>
> **Two points a review of this copy raised; both are open for #693 (the design text below is unchanged).** (1) The lease: a window hidden longer than Wails' 10-minute stream grace loses its stream, and the 5-minute detach lease then ends the terminal, so a window hidden for about 15 minutes or more closes its terminals. Decide: accept that and say so in the UI, or keep the lease alive while the window is merely hidden. (2) Who may close: after tab B takes over, tab A still holds the same capability. Input, resize and acknowledgement travel on the stream and stop with it; `CloseTerminal(cap)` is the one call that does not, so it must be refused for a displaced holder (bind it to the current stream or to a holder credential), or the takeover invariant holds in the page and not on the host.

**Status:** design + spike, **verdict after step 0: GO on Wails GoStream** (section 0). No product PR for the design. Spike code and raw results: host branch `wip/spike/terminal-channel` at `bda35f96a604d0429ff314a72f43e75e014bd13c` (`spike/terminalchannel/`: `drive/`, `out/`), pushed, no PR. **Date:** 2026-11-24. **Author:** agent `TerminalChannel`.
**Answers:** backend catalog B-111 (not closed by #677), B-110 (cause found, section 4.5), B-112 (plugin UI in the page), B-79/B-87/B-114 (window identity in server mode), review of #677 (B1, S1-S4), prior-art study rank 11 and mechanisms 1-3, SDK2 exec lane 4.5.
**Also shipped, not part of the design:** host PR #690 (B-113, `CreateSession` refuses an id another session has), CI 26 of 26 green at `4bc1ee4d2cf02784c4b5f548bae5dba2e3f3d82c`, three CodeRabbit comments answered (two fixed, the rule-28 second half left open on purpose: `docs/ui-next/status/B113.md`).
**Machine and load:** macOS 27.0.1 (26A434) arm64, WebKit 22625.1.29.11.28, Go 1.27.4, Wails v3.1.0, Playwright 1.64.1 (Chromium 1248, WebKit 2370). Load average 4 to 14 from other agents at every run: counts are exact, timings compare, none certifies; two passes of one cell differ by up to 40% in MB/s, so read ratios of 1.5x or less as noise. **The screen of this Mac was LOCKED during every native run** (section 4.4): native numbers are for a page WebKit considers hidden, with a host keepalive.

## 0. The answer

**Verdict: GO on Wails GoStream** (`App.HandleStream("term", ...)`, JS `Stream`) as the one transport of the per-terminal stream. The red gate of the first draft (native pages stopped being serviced after 4 to 12 s, 9 of 9) **has a cause, and it is not the library**: the screen was locked, so WebKit reported `document.visibilityState = "hidden"` and suspended the page; page-initiated work (the held poll, a fetch, a socket handler, my heartbeat) stops, host-initiated `evaluateJavaScript` (the events lane) does not. Proof: with a host-side keepalive (a no-op `evaluateJavaScript` every 50 ms) the same page, still `hidden=true`, runs every transport for 60 s (section 4.3). Wails' own `tests/stream-performance` hung here for the same reason.

**Chosen transport and the numbers** (native WKWebView, page hidden + keepalive, 60 s of `yes`, acks on; server build, Chromium and WebKit):

| | native MB/s | native page RSS peak | echo p95/p99 under another terminal's flood (native) | host RSS | simplest |
|---|---|---|---|---|---|
| **1. GoStream** | **82.2** | **360 MiB** | **1 / 2 ms** | flat | **yes: no port, no listener, one handler for both builds** |
| 1. own WebSocket (loopback) | 34.3 | 873 MiB | 2 / 2 ms | flat | a port and an origin rule |
| 2. pull binding | 92.7 | 827 MiB (2.2 GiB in Chromium) | not run | flat | no port, but base64 JSON and a call per fetch and per keystroke |
| events (today) | 49.5 | **2,027 MiB** | **12 / 16 ms** | flat (probe), **9.5 GiB in 30 s in the real host: B-110** | n/a |

GoStream wins on every criterion Main named except raw MB/s against the pull binding (which pays for it in page memory and a binding call per keystroke). Server build, Chromium: 42.7 to 46.9 MB/s, echo p99 under a flood 0.8 ms (events 10.5); WebKit: 28.8 MB/s (events 19.7).

**B-110 is OPEN and its cause is found; it is not the stream's problem and the stream does not fix it** (section 4.5): the reviewer's own Go reader against the REAL host build of main takes it from 67 MiB to **9,523 MiB in 30 s**; the same client against my probe (same exec controller, same events path, but no window) stays at 76 to 78 MiB. The heap at 10 s is 97.8% `fmt.Sprintf` strings queued under `WebviewWindow.DispatchWailsEvent`: `main.go:875` creates a `WebviewWindow` in the server build and nobody drains its event JS queue. My first draft's "not reproduced" was the probe having no window; it is corrected here.

**Recommended design (unchanged in shape; accepted by Main).** Every local terminal has a **capability**: 256 random bits the host mints at create, returned once, required on EVERY call that touches the terminal and as the first frame of the terminal's **stream**. The stream is a per-terminal, ordered, bounded connection to the page that holds the capability: output, replay, the end, input, resize and acknowledgements travel on it. **The connection is the holder**: when it ends the terminal is detached (T2's lease); a new stream with the capability and `from_offset` re-attaches it, byte-exact. **Window identity is used nowhere**, so B1 of #677 and B-87/B-114 stop mattering for terminals; terminal bytes leave the broadcast bus, so S1 stops applying to the new lane and the lane is outside B-110's queue by construction.

**One product consequence of the finding.** A hidden, locked or minimised window stops servicing a page-initiated stream after about 5 s: the host's `Send` parks, the shell blocks in its own write (bounded, measured: host RSS flat), the connection stays open, and it resumes when the window is visible again. That is the behaviour a terminal wants; it needs a test (step 3) and the 10-minute stream-session grace of Wails (`streamSessionGrace`) means a window hidden longer than that loses its stream, which is T2's detach and rejoin by offset.

**Legacy UI:** leave it on the old lane (bare id, broadcast events), unchanged, until the flip; the new lane is opt-in per terminal (`launch.channel`).
**Plugin UI (B-112):** a capability in a private module variable is not a boundary against plugin code in the same page (R10: same realm, no sandbox, no CSP); it is useless to another window or a network peer; the real boundary is a separate realm for plugin UI (section 5).

## 1. The problem, in the review's words
- **B1 (blocker of #677):** a server-mode page's events socket reconnects 1 s after it drops with the same client id; Wails makes a NEW `BrowserWindow` per connection (`websocket_server.go:86`); `IdentityOf` = (type, `window.ID()`); every bare-id call of the reconnected page is "not found" and nothing can end its shell. Same root as B-79/B-87/B-114.
- **S1:** output, CLOSE and DETACHED events reach every window and name the id; Wails 3.1.0 has no addressed emit and no per-client send (`T2c-go.md` section 4).
- **B-110:** a healthy reader grows the host without bound in server mode (2.36 GiB at 60 s Node, 11.4 GiB with two clients one stalled; native stalled webview 3.4 GiB at 30 s). **Reproduced here and attributed** (4.5).
- **S2:** an offer is a bearer right for 60 s because ids are public. **N1/B-113:** an existence oracle on a create that names an id (#690 closes the plugin side).

## 2. The design
### 2.1 Mint, hold, present
- `CreateTerminal(opts, launch{channel: true, ...})` answers `{session, cap}`; `cap`: 32 random bytes, base64url, per terminal, host-minted, never listed, logged, in a URL, an event or an error. A terminal without `channel` is the legacy lane, untouched.
- **Where the page keeps it:** memory in one host module (`terminalChannel.ts`) and, so a reload can re-attach, the host window-state slot T2b already uses (`terminal-page-key`, `pageKey.ts`) as `id -> cap`. The T2 page key stops being the credential; the cap is. Section 5 says what that protects.
- **Every call takes the cap, not the id.** Input, resize and ack are stream frames; the calls that stay bound (`CloseTerminal(cap)`, `GetCwd(cap)`, `IsBusy(cap)`, `ListTerminals(caps[])`) take caps and answer one error, `omniview:session/not-found`, whatever the reason. `ListTerminals` answers only for the caps given: a page cannot enumerate terminals it was not given. **The id is a label**; it opens nothing.

### 2.2 The stream
- One stream per terminal. **The first frame is `{cap, from_offset?}`**; the stream name carries nothing secret (GoStream puts it in the URL: `?name=` in server mode, the fragment of the poll URL natively).
- Host answers `ready{start, end, size, modes, next_input_seq?}`, the replay `[start, end)`, then live output, **on one ordered connection**: no event after the attach's answer (7 in 2,051 on Linux, S2 of #674), no gap or duplicate at the join.
- Page to host on the same stream: input, resize, acknowledgement; order is the stream's, so the sequence numbers and `SEQUENCE_STALE/AHEAD` of `ordered.go` are not needed for channel terminals. Host to page besides bytes: `ended{...}`, `taken-over`, `lease` (they replace the broadcast `CLOSE/<id>`, `DETACHED/<id>` and the `attachment` numbers).
- **Pacing.** `Send` blocks when the transport's queue is full (GoStream: 256 frames or 8 MiB per window, 256 MiB globally), the manager takes the return of `Output` as delivery, the pty read blocks, the shell blocks in its own write (the goroutine dump at the hidden-page stop shows the pump parked in `streamSession.enqueue`, host RSS flat). The acknowledgement frame stays as a per-terminal in-flight limit (1 MiB; 5 bytes per 64 KiB) for page memory and fairness; it no longer protects the host, so the watchdog, the 8 MiB ceiling, the stack-recognition of the credit point and `DeliveryReporter` can go for channel terminals.

### 2.3 Lifetime, takeover, duplicates
- **The connection is the holder.** A stream that ends detaches the terminal (reader held, lease 5 min, at most 30, ring keeps the credit window); a stream that opens with the cap re-attaches it. A server-mode reconnect (B1) is just another stream.
- **Taker semantics as T2:** a second stream with the same cap (a duplicated tab carries a copy of the slot) takes the terminal; the first gets `taken-over` and closes; the displaced tab cannot type until it takes it back (T2d). Decide and act is one step in the manager (the idea of #677's `withHeld`): the handover is under the terminal's lock; input admitted before it is applied before the new holder's; input after it is refused.
- **Ending:** `CloseTerminal(cap)`; `closed_by: detach-timeout` after the lease; the tombstone kept for the cap, dismissed by the cap. **No window realm** for terminals.
### 2.4 What it does not change
The legacy lane; plugin sessions (the pod exec lane gets the same shape through SDK2 `Attach{from_offset}` later); shell start, environment, ring, mode scanner, typed `End`.

## 3. The options, as built and measured
Spike `spike/terminalchannel/` (`wip/spike/terminal-channel`): one probe app for both builds over the host's real `terminal.Manager`; the baseline goes through the host's REAL exec controller and wrapper (keyed `CreateTerminal`, `core/exec/stream/output/<id>` events with offsets, `AckTerminal`). The page (`web/client.js`) picks transport and client state from its query string; drivers `drive/server.mjs` (Playwright), `drive/native.mjs` (a real WKWebView), the `matrix-*.sh` scripts. Programs: `sh -c 'read x; exec yes FLOOD...'` (B-110's flood), `stty raw -echo; exec cat`, a 10 MB/s perl loop.

| | events (today) | own WebSocket | pull binding | GoStream |
|---|---|---|---|---|
| Server build | yes | yes on its own loopback port. **On the application's port through the asset middleware: no** (the page got neither open nor error, 0 bytes) | yes | yes, a real WebSocket at `/wails/stream/ws` |
| Native WKWebView, 60 s under `yes` | yes (needs no keepalive) | yes (with keepalive when hidden) | yes (idem) | yes (idem) |
| Order and replay join | events and replies travel apart | ordered | ordered | ordered |
| Binary | base64 in JSON | binary | base64 in JSON | binary |
| Host bound by construction | no (an unbounded window queue: B-110) | TCP | the ring window | 256 frames / 8 MiB, blocking `Send` |
| Moving parts | none | listener, origin rule, port | none | none (Wails maintains it) |

## 4. Measurements
### 4.1 Server build, Chromium, flood of `yes`, acks on (what the T2d UI does)
60 s healthy; 40 s stalled (the page busy-loops from second 3). Host RSS is the driver's `ps` of the host pid every 5 s. **The probe has no window, so its events lane cannot show B-110 (4.5): these host rows say how each transport behaves, not that the events lane of the real host is fine.** Raw: `out/server-matrix*.jsonl`.

| transport | healthy MB/s (pass 1 / 2) | host RSS MiB healthy | host RSS stalled | browser RSS peak healthy (MiB) |
|---|---|---|---|---|
| events | 27.0 / 38.7 | 77.6 -> 79.0 | 77.0 flat | 514 / 678 |
| stream (GoStream) | 46.9 / 42.7 | 76.1 -> 78.2 | 76.5 flat | 359 / 953 |
| ws (own port) | n/a / 43.9 | 75.8 -> 77.7 | 75.4 flat | 692 |
| pull | 72.0 / n/a | 84.0 -> 86.7 | 82.2 flat | **2,168** |

Acks OFF: events 41.0 MB/s, stream 46.8, ws 46.2, host flat in all; stalled page, no acks: flat in all (events: Ctrl-C afterwards 151 ms, the others 31 to 33 ms). **Playwright WebKit** (acks on, 60 s): events 19.7 MB/s, host 74.9 -> 79.3, browser RSS 1,207 MiB; stream 28.8 MB/s, host 75.4 -> 78.1, browser RSS 814 MiB; stalled: events host 77.3 flat, stream 76.3 flat, browser 933 / 1,083 MiB.

### 4.2 Keystroke echo and fairness (server build, Chromium; native in 4.3)
| transport | idle p50 / p95 / p99 (ms) | with another terminal flooding in the same page | flood meanwhile |
|---|---|---|---|
| events | 0.8 / 1.0 / 1.1 | 0.6 / 3.1 / **10.5** | 188 MB |
| stream | 0.3 / 0.4 / 0.5 | 0.2 / 0.3 / **0.8** | 202 MB |
| ws | 0.3 / 0.4 / 0.5 | 0.2 / 0.4 / 0.6 | 239 MB |
| pull | 0.8 / 1.0 / 1.1 (a binding call per keystroke) | not run | |

### 4.3 Native WKWebView, 60 s under `yes`, page hidden (screen locked) + host keepalive (50 ms `evaluateJavaScript`), acks on
| transport | MB/s (MB in 60 s) | host RSS MiB (5 s .. 60 s) | WebKit processes RSS peak | echo idle p50/p95/p99 | echo under flood p50/p95/p99 (flood MB) |
|---|---|---|---|---|---|
| **GoStream** | **82.2** (4,931) | 142.8 -> 171.0 | **360 MiB** | 1 / 1 / 2 ms | 1 / 1 / 2 (327) |
| own WebSocket | 34.3 (2,058) | 143.9 -> 166.5 | 873 MiB | 1 / 1 / 1 | 0 / 2 / 2 (172) |
| pull binding | 92.7 (5,562) | 143.6 -> 175.4 | 827 MiB | 1 / 1 / 1 | not run |
| events | 49.5 (2,968) | 142.6 -> 171.4 | **2,027 MiB** | 1 / 1 / 2 | 2 / **12 / 16** (340) |

Timers of a hidden page are clamped (1 ms resolution and 1 s intervals), so the echo figures are coarse and the Ctrl-C stop times (444 to 1,018 ms) are artifacts of the page's own timer, not results. The stream moved 66% more bytes than events with a sixth of the page memory. A 30 s GoStream run before the matrix: 64.2 MB/s. **Not measured: a VISIBLE window without keepalive** (step 0b), a native hidden-window flood with the events lane's own numbers (the B-110 follow-up's: 142 to 261 MiB flat), two terminals in one native page.

### 4.4 The cause of the freeze, and its proof
- **Observation:** every page-initiated native run (9: 7 GoStream, 1 pull binding, 1 own WebSocket) stopped being serviced 4 to 12 s in, at 10 MB/s as well as 90; the host stayed bounded (RSS flat, `Send` parked, the pump parked in `streamSession.enqueue`); the host was idle with no held poll; the WebContent main thread idle at 0% CPU; the events lane in the same page ran to its end; Wails' own `tests/stream-performance` (`rate-1000` delivered 341 of 1000 frames/s, `unthrottled-64KB` never finished) did the same.
- **Ruled out first:** my sampler, the heartbeat calls, the acks, the rate, a Regular-policy window shown, focused and always on top, the app launched as a `.app` through LaunchServices.
- **Cause:** `screencapture` of this Mac shows the LOCK SCREEN (the first capture was black: display asleep); the page's own note said `visibilityState=hidden hidden=true focus=false` in every run. WebKit suspends a hidden page's page-initiated work after a few seconds; evaluateJavaScript from the UI process counts as activity.
- **Proof:** `PROBE_KEEPALIVE_MS=50` (`keepalive_native.go`) and nothing else changed: GoStream 30 s completed (64.2 MB/s), then all four transports ran 60 s, the page still `hidden=true` (4.3).
- **What it is not:** a Wails or a transport defect; the `fetch` and `Stream` paths are fine when the page is serviced.

### 4.5 B-110: reproduced, attributed (OPEN)
The reviewer's own driver (`followup-e457/js/fast.mjs`) and Go reader (`wsclient`): an UNKEYED terminal (stdout events), no acks, one raw socket reader.
- **Real host, server build of main `b015ceb5` (`go build -tags production,server .`), 30 s:** RSS 67 -> 1,577 (5 s) -> 3,413 (10 s) -> 4,880 (15 s) -> 6,308 (20 s) -> 7,750 (25 s) -> **9,523 MiB (30 s)** with 2,524 MiB received at 73 to 95 MiB/s: 3.8x the delivered bytes held.
- **The same client against the probe's server build** (same exec controller and wrapper, same events path, no window): 76 -> 78 MiB over 25 s, 2,089 MiB received.
- **Heap profile of the real host at 10 s** (`out/b110-real-host-heap-at-10s-top.txt`): 1,321 of 1,351 MiB in use (97.8%) is `fmt.Sprintf` cum under `mailbox.(*Mailbox).drain <- (*WebviewWindow).DispatchWailsEvent <- (*EventIPCTransport).DispatchWailsEvent <- (*EventManager).dispatch`. `main.go:875` calls `app.Window.NewWithOptions(mainWindowOptions)` unconditionally, so the server build holds a `WebviewWindow` that has no webview, every event is formatted into a JS string for it, and the queue that would be drained by a webview is never drained. That is the "inline event string" of the review's hypothesis, found.
- **So:** B-110 is the real host's headless window in server mode, not Wails' event path in general and not the client (my Chromium and WebKit runs on the probe are flat because the probe has no window; my first draft's reading of that as "not reproduced" was wrong). The native stalled-webview case (3.4 GiB at 30 s) is the same queue with a webview that does not drain it.
- **Fix candidates, neither part of this design:** (a) the host: no main window in a server build, or its events not dispatched to it, keeping what a call with no client id relies on (`getTargetWindow` -> `windows[0]`, review note N2); (b) a Wails patch (`patches/`): `WebviewWindow.DispatchWailsEvent` a no-op when there is no webview. The reviewer's `fast.mjs` is the red test (9.5 GiB against a flat line). A separate small PR (step 1b).

### 4.6 Is the acknowledgement needed?
For the host: not in any lane I ran without the window; the real host's retention (4.5) is after the credit point in a queue nothing drains, so acks would not bound it either. Kept in the design as a per-terminal in-flight limit for page memory and fairness (5 bytes per 64 KiB); the watchdog and the stack-recognition of credit are what go.

## 5. B-112: what a plugin UI can reach (read, not run; scout `PluginReach`; every exploitation claim is inference from call sites)
Plugin bundles load through SystemJS into the same page (`ui-next/plugins/loader/importBundle.ts:14-18,79-82`) with the host's own React and kit instances (`shared.ts:27-38`); no iframe, worker or Realm for plugin code, no CSP (`index.html`, `main.go:297-318`), no hardening of globals; `/wails/runtime.js` and the host's chunks are importable by URL and only their exports callable; the new UI's curated runtime (`@omniviewdev/runtime/ui/v1`) does not export `ExecClient`, the legacy `/api` entry does (`api.ts:2`). **The T2b page key is NOT in `sessionStorage` (as T2-go.md says) but in the host window-state slot `terminal-page-key`, readable by any script through `WindowClient.GetState`** (`pageKey.ts:3-10,31-46`).

| Question | Answer |
|---|---|
| Can plugin code read a capability in a private module variable? | Not by name. It can import the host's chunk and call what it EXPORTS, wrap `fetch`/`WebSocket`/`JSON.stringify`/`window._wails` and read the cap off the next call or frame, and read the window-state slot if the cap is persisted there. |
| Can it reach another window's terminals? | No: no capability, ids open nothing, `ListTerminals` takes caps. |
| A boundary against plugin code in the page? | **No.** Same realm, same trust (R10). In #677 the plugin IS the window; here it must tamper, and a leaked cap is one terminal. |
| Smallest real boundary | A separate realm for plugin UI (sandboxed frame or worker with a message API), the host holding the cap on its side; the design needs only a plugin API that never returns the cap. |
| Remote audit browsers | `/wails/stream/ws` is `PathStream`, denied by the gateway; a new path is 404 by default (`internal/auditgate/evaluate.go:253-282`, `docs/development-audit-gateway.md:63-80`); new bound calls must be pinned denied in `policy.json`. |

## 6. What of #677 is salvaged, what is dropped (scout `Salvage677`, diff `994d557c..f49f7f08`)
Production source of #677 is +1,373/-153 lines (inference from the file stats): about 400 (29%) are window bookkeeping that is DROPPED, about 960 (70%) hold an idea that is ADAPTED (key: window identity -> capability and connection), about 13 are kept as is; non-production: seam and fixtures 97, status docs 114, the mutation runner 432 (kept).
- **KEEP:** negative acknowledgement validation; the `snapshotLocked` extraction; the mutation runner; the forced-order test shapes.
- **ADAPT (the value):** decide-and-act in one step (`withHeld`, the `*Owned` calls, `commitClose`): the predicate becomes "this stream holds the terminal now"; same ordering of input across a handover; not-found in the same words; a closing session is not claimable; the tombstone dismissal by its holder; the `GuardSessionCreate` principle against stream lifecycle; the one-time transfer, bounded and revocable (**offers**: kept for the day the new UI moves a terminal tab between windows, as a one-time TOKEN the target redeems; not built now: nothing in the new UI moves tabs between windows and legacy keeps its bare ids).
- **DROP:** `ValidOwner`/`callerOf`/`IdentityOf`/realm retirement subscription for terminals; orphan adoption; `claimable`'s ownerless exception; per-window creation guards; the legacy UI's offer-before-move code; the seam's page impersonation; "different window always denied" tests.
- **Invariants to pass** (tests to port: `TestAWindowCannotUseTheTerminalOfAnotherWindowByAnyBindingThatNamesItById`, `TestInputThatWasTakenInBeforeAClaimIsAppliedBeforeTheNewHoldersAndNothingAfterIt`, `TestAResizeThatWasTakenInBeforeAClaimIsAppliedBeforeTheNewHoldersAndNothingAfterIt`, `TestInputOfAWindowThatGivesATerminalAwayAndTheClaimOfItAtOnceKeepTheirOrder`, `TestAnOfferIsUsedByExactlyOneOfManyWindowsThatClaimAtOnce`, `TestTheDismissalOfTheEndOfATerminalAndTheAttachOfItAtOnceHaveOneOutcome`): every non-holder is told what an id that never was; input before a handover precedes the new holder's and none after; close before a handover wins, one after protects the new holder; a session whose end is decided cannot be claimed; one winner of two claims; repeated teardown is one transition. **S3 of #677** is not a gap here: the claim IS the stream, and a stream that ended before its attach finished is detached by the same lock.

## 7. Steps (each a small PR; tests first, seen red; one push each)
0. **Step 0, done (a):** the cause of the native freeze (4.4) and the verdict. **(b), 5 minutes, no code:** run `drive/native.mjs` WITHOUT `PROBE_KEEPALIVE_MS` on an UNLOCKED session (and, if cheap, on macOS 14 or 15 / CI's macOS runner) to confirm a visible window needs no keepalive. It gates the claim, not the design.
1. **#690 (B-113)**, open, CI green: merge first; conflicts with #677 only at the write block of `CreateSession`.
1b. **B-110 (host or Wails patch):** the server build's window (4.5), red test = the reviewer's `fast.mjs` (real host), green = flat; independent of the channel.
2. **Capability on the calls (Go).** `CreateTerminal` mints and returns `cap` for `launch.channel`; `ListTerminals(caps)`, `CloseTerminal(cap)`, `IsBusy(cap)`, `GetCwd(cap)`; one not-found; audit policy pins them denied; #677's isolation matrix ported. Legacy lane untouched.
3. **The channel (Go).** `terminal.Channel` (blocking `Send`, ordered `Recv`) and the attach-by-cap handshake in the manager (decide-and-act under the terminal's lock): replay and live on one connection, resume by `from_offset`, `taken-over`, lease on stream end; a pipe-backed fake channel for the ported byte-exact reload and takeover tests of T2-go; the GoStream adapter behind it; **a hidden-page test** (the stream is not serviced for a while: the shell blocks, host memory flat, the terminal resumes exactly; and a session reaped after Wails' 10-minute grace detaches and rejoins by offset); deletes for channel terminals: `emitMu`, the sequence queue, the watchdog and the stack-recognition of credit.
4. **The page (TS).** `terminalChannel.ts` (sole holder of caps, exports none), `localShell.ts` and `execFeed.ts` consume frames; delete the event names, the `DETACHED` attachment numbers and the dedup-by-offset rules of T2-go 2.4 rule 5; the slot stores `id -> cap`. Seam scenarios `r`..`r4` plus a RECONNECT scenario (B1).
5. **Gate and docs.** `policy.json` pins; `T1-go.md`/`T2-go.md` 2.7 say what the key and the cap guard.
6. **Delete (at the flip).** The events lane for terminals, the host credit of `AckTerminal`, bare-id local terminal calls, the legacy offers.
7. **Later.** The one-time transfer token for tab moves between windows; the same shape for plugin sessions through SDK2 `Attach{from_offset}`; a realm for plugin UI (the real B-112).

## 8. Open points
1. **Per terminal or per page?** Per terminal (a leak is one shell); the page keeps a map.
2. **Rotation.** Not recommended: a stable cap plus "the live stream holds it" gives T2's taker semantics and lets the displaced tab take it back.
3. **Fallbacks, not needed now:** the own WebSocket (a loopback port, 34 MB/s natively, 873 MiB page RSS) and the pull binding (92.7 MB/s but base64 JSON per call, 827 MiB to 2.2 GiB page RSS) both work and are measured; encrypted events (a per-terminal key derived from the cap, AES-GCM on the existing bus) would close S1 by cryptography if streams were ever unusable, but keep the bus and B-110.
4. **Same-port WebSocket** through the asset middleware does not upgrade in the server build; GoStream's own route is on the server mux and needs no workaround.

## 9. Verified, not verified
**Run:** the spike on both builds; server build: Chromium (healthy 60 s, stalled 40 s, echo, echo under flood, acks on and off) and Playwright WebKit (healthy and stalled, events and stream); native WKWebView: the freeze (9 runs and Wails' harness as control), the cause (screenshot, `visibilityState`, goroutine and process samples) and its proof (keepalive), then 60 s of all four transports, echo and echo under flood; the reviewer's `fast.mjs` and Go reader on the real host build and on the probe, and a heap profile of the real host. **Read, not run:** the GoStream sources; #677 (scout `Salvage677`, no shell: the line split is an estimate); plugin reach (scout `PluginReach`).
**Not run:** a visible native window without keepalive (step 0b); macOS other than 27.0.1; native hidden-window flood on the events lane, two terminals in one native page, Windows and Linux native; the reviewer's Node reader and the no-ack keyed variant against the real host (so which factor beyond the window matters, if any, is not separated); the capability handshake, reload exactness and hidden-page tests (step 3). The probe's `ws` endpoint accepts every origin, has no replay on reconnect and no ownership: it measures transports, it is not the design's code; the probe is a small app (55 to 79 MiB server, 143 to 175 MiB native baseline), not the real host.
