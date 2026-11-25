# Status: T3-channel-page (the new UI's terminal on the terminal channel, #693 step 4)

- Goal: the Terminal tool of `ui-next/` reaches its terminals only by capability and one Wails stream per terminal (`docs/ui-next/terminal-channel-protocol.md`), and the events lane is no longer used by the new UI for terminals. Issue #693, steps 4 and 5; epic #692.
- Worktree: `~/omniview/wt/t3-channel-page`. Branch: `ui-next/t3-channel-page`, made from `origin/feat/terminal-channel-backend` at `f009987239743ea1b407bd5d4c86a4d3713ee340` (PR #704 before it merged; the lead allowed building on it, #693 comment of 2026-11-24). #704 merged on 2026-11-25 (`169da34c`); `origin/main` has since been merged into this branch (no rebase: the branch keeps its red-first history).
- PR: #716 (https://github.com/omniviewdev/omniview/pull/716), ready for review. Next: CI and CodeRabbit on its head, the merge gate of `HOW-WE-WORK.md` section 15.

## Open decision (owner)

- #693 "Open decision": a window hidden longer than Wails' 10-minute stream grace loses its stream, and the 5-minute detach lease then ends the terminal. Not answered on 2026-11-24. The page states what the host does (the terminal comes back ended); it does not keep a lease alive by itself.

## Log

- 2026-11-24 20:58: `uptime` load average 0.72, 0.78, 0.79. Worktree made; `pnpm install --frozen-lockfile` and `task packages` ok.
- 2026-11-24 21:05: the contract `ui-next/shell/panel/terminal/channel.ts` (`4d016ee6`). Slice A (`terminalChannel.ts`, `localShell.ts`, `PluginHostScreen.tsx`, `pageKey.ts` deleted, four calls added to the runtime's `ExecClient`): red `bebf03da`, green `111c51f4`. Slice B (the feed, held output, the registry; `rejoin`, the page key, sequence numbers, `DETACHED`, base64 deleted): red `95449d6f`, green `c8f607ad`. Merged `0514d47f`.
- 2026-11-24 21:28: `pnpm test ui-next/shell/panel/terminal ui-next/plugins/host`: 1,933 of 1,934; the one failure is `screen.test.ts` "writes what the host kept in slices ..." by the 5 s timeout at load average 16 (9.2 s); slice B saw it fail on the base commit too. Both tsc projects clean except `ui-next/shell/probes/terminal-fixture.tsx` (slice C). Slices C (probes), D (seam), E (memory on the real host) started.
- 2026-11-24 21:45: take it back after `taken-over` never offered (nothing called `refresh`; found by ChannelSeam): red `74abcd94`, green `a5cd444e` (`refreshLost` on visibility, focus and every 5 s).
- 2026-11-24 21:50: memory on the real host (slice E, `9e76740e`): four cases flat, at most 55.5 MiB over the start (section below).
- 2026-11-24 22:00: in server mode the page's `Stream('terminal')` took Wails' HTTP poll, not the WebSocket route, because the page bundles its own runtime and never loads the host's `/wails/runtime.js` prelude (found by ChannelSeam: 0 sockets to `/wails/stream/ws`, poll GETs and send POSTs instead). Red `79538850`, green `8edf35f2` (`streamOpener`: a browser opens `/wails/stream/ws?name=terminal` itself, as the prelude does).
- 2026-11-24 22:05: independent review (ReviewChannelPage, on `ad0ef486`): FIX FIRST. B1: replay bytes were never acknowledged, and the host counts every output frame, replay included, against the window: a replay over 1 MiB deadlocks once `ack(0)` lands in the middle of it (decision 3 of the design was wrong for the channel). S1: host errors left the channel unscrubbed. S2: 17 surviving mutants. N1: a drop in the middle of the replay of an ended terminal loses the replay. Fixes in progress, tests first.
- 2026-11-24 23:05: slice C (probes on the channel: the fixture host speaks the channel and enforces the host's window, replay included) `a2544f2f` to `4a3759da`, lint `fb024203`; slice D (seam r to r5 on the channel, r6 reconnect, r7 isolation, controls `terminal-reconnect` and `terminal-isolation`) `809042c0`.
- 2026-11-24 23:30: follow-up review (ReviewChannelPage, on `be142522`): MERGE. B1, S1, N1 fixed and verified; every S2 mutant killed by a named test; the fixture host enforces the window as `channel_serve.go` does (a page that does not credit its replay turns `reattach.exact` and `reattach.modes` red). SHOULD S-a (a short gap frame): tests `6b72f06f`. SHOULD S-b (`hidden.frames` loosened by twice the deliveries): one frame per delivery plus fixed slack, `0290630f`.
- 2026-11-24 23:40: `hidden.work` (a time bound) fails on this machine on `origin/main` `8a2160a1` too (685 ms against 310 at 2 MB, load 5.2); on this branch 567 ms at 2 MB and 1,913 ms against 1,750 at 20 MB (load 5.0). Counts held in both. CI's runner decides the time bounds.
- 2026-11-25 00:00: seam on the real host (`bin/Omniview-server` of `69784da5`), bash, `SEAM_TERMINAL_ONLY=r,r2,r3,r4,r5,r6,r7`: chromium exit 0 (load 13.9), webkit exit 0 (load 5.1).
- 2026-11-25 00:30: #704's review moved the capability out of the window-state slot (`WindowClient.GetState` answers any window; `windows.json` keeps slots on disk): it lives in page memory and the tab's `sessionStorage` (`omniview.terminal-capabilities`). Page red `45a1061b`, green `03989c9e` (`terminalChannel.window.test.ts`: no capability reaches `SaveState`); probes `9b36e339` (control `cap-in-state`); seam `dcd214a0`, control `cap-in-window-state` `fbc3c29a`.
- 2026-11-25 00:55: second follow-up review (ReviewChannelPage, on `0e35c56a`, with the seam on the real host this time): MERGE. Controls `terminal-reconnect` and `terminal-isolation` detected, and undetected with one assertion removed each. Notes N1 (no seam control for the window-state assertion) and N2 (a stale comment) fixed in `fbc3c29a`.
- 2026-11-25 01:02: #704 merged (`169da34c`). `origin/main` merged into this branch (`ab96d39d`): #703 (find, menu, links) ported to the channel in the fixture host and the seam (its scenario is `r8` now), #706 and #711 kept.
- 2026-11-25 01:10: seam repeat (r3, r5, r6 x3, chromium): r6 failed once, "a cut of the terminal stream for 5 s: what was typed ... during it too, in order". Not reproduced in 11 more runs. Cause (inference, from the code): the socket's `readyState` was no longer OPEN but its `close` event had not run, so the input frame went to a dead socket and was dropped. Fix: red `7e4a15cd`, green `532d7a89` (`ChannelLink.input` answers whether it sent; a link whose socket is not open ends as `closed` once, and the feed sends the refused input after the next `ready`). The wider gap (input sent on a socket that is open but already cut) stays the WIRE item below.

## Dev tools

- `ui-next/shell/panel/terminal/testing.ts` `fakeChannels`: a fake `TerminalChannels` driven frame by frame.
- `ui-next/shell/probes/terminal-host.mjs` (rewritten): the probes' far end as a channel host, plain JS for Node and the page: capabilities, the frames, the holder, takeover, the lease, the ring and `gap`, and the host's credit window counted as `channel_serve.go` counts it (every output frame, the replay included). `terminal-serve.mjs` serves it to the page; `terminal-host.d.mts` types it; `terminal-host.test.mjs` pins it.
- `ui-next/shell/probes/terminal-host-memory.mjs` (rewritten): starts the real server build on a fresh HOME, makes a channel terminal through `CreateTerminal`, reads `/wails/stream/ws?name=terminal` over a raw socket (so a stalled reader really stops reading), types `exec yes`, and samples the host's RSS by its pid; four cases (no acks, acks, two terminals one stalled, a 20 s stall then resume). Manual, not CI.
- Seam: `SEAM_TERMINAL_ONLY=r,...,r8`, `SEAM_TERMINAL_REPEAT=n`, control groups `terminal-reconnect` and `terminal-isolation` (with `cap-in-window-state`), `SEAM_REMOVE=<control>`; the r6 failure message lists each stream since the cut with its frames (`3c352111`).
- WebKit on this Linux box: Playwright's WebKit needs libraries the machine lacks; they were unpacked under `/tmp/c-libs` and passed with `LD_LIBRARY_PATH=/tmp/c-libs/ex/usr/lib/x86_64-linux-gnu` (not installed system-wide). The Go toolchain the build needs: `PATH=$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.4.linux-amd64/bin:$PATH` (the machine's `go` is 1.26.1).

## Backend catalog

- **WIRE: a displaced holder is not told when the taker lets the terminal go.** `docs/ui-next/terminal-channel-protocol.md` section 8: `taken-over` closes the displaced stream, so the events lane's `DETACHED` (`requested`, `window-retired`) has no channel equivalent. Evidence: the seam's r5 (take it back) cannot pass without it (ChannelSeam, 2026-11-24). Interim in the page: a tab that lost a terminal asks `ListChannelTerminals` for it when the page becomes visible or focused and every 5 s while it is visible (`attached === false` offers "Take it back"). Proper fix at the producer: a frame or a watcher connection that tells the displaced page when the terminal is free.
- **WIRE: input the page cannot confirm is lost without a word.** The channel has no input numbers and no input acknowledgement (the events lane had `seq` and `next_input_seq`), so the page cannot tell which input frames the host applied. In the page: input refused by a socket that is no longer open (its `readyState` changed before its `close` event ran) is kept and sent after the next `ready`, in order (`532d7a89`). Still open: input handed to a socket that reports `OPEN` but whose connection is already cut is lost, and the page cannot know it. Evidence: the seam's reconnect scenario (ChannelSeam, 2026-11-24). Proper fix at the producer: `ready.input_applied` (input bytes applied from this capability, across streams), so the page resends what came after it. Asked on #693.

## Memory on the real host

The acceptance of #693: the host's resident set stays at most 100 MiB over its start while a reader floods, stalls and resumes. Measured with `ui-next/shell/probes/terminal-host-memory.mjs`, a manual dev tool (not CI; it asserts nothing about memory, it measures and prints, and it holds every received byte to the pattern of `yes`). It starts the real server build over a fresh HOME, makes a channel terminal through the bound call `CreateTerminal` (`launch.channel`), opens `/wails/stream/ws?name=terminal` from Node over a raw socket (so that a stalled reader really stops reading the kernel's buffer), attaches with the capability, types `exec yes` once the shell shows its prompt, and samples `ps -o rss= -p <pid>` of the host process it started once a second for 30 s. No browser, no page code.

Run 2026-11-25 10:52 to 10:54 (after the second round of review fixes of #716), Linux x64 (Node v26.13.0, Go 1.27.4), branch `wip/t3cp-e` merged with `ui-next/t3-channel-page` at `5e3b8795`. The tool now waits for the first output of `yes` on every stream before the sample window starts, and its `integrity` column (flood ran, every byte and offset exact, one new gap with output after it for the stalled reader of case d and of case c, a stall of the full `--stall` by the clock of the pause and resume calls, no stream ended or closed before the window closed; a run that lacks samples is `INCOMPLETE`, not `PASS`) sets the exit code; the memory limit stays report-only:

```
$ uptime
 10:52:53  up 26 days 18:27,  0 users,  load average: 22.13, 10.76, 7.63
$ GO_TOOLCHAIN="$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.4.linux-amd64"; PATH="$GO_TOOLCHAIN/bin:$PATH" OMNIVIEW_UI=next GOWORK=off GOFLAGS= GOTOOLCHAIN=local task build:server
$ node ui-next/shell/probes/terminal-host-memory.mjs --json=/tmp/hostmem-t3cp-e3.json
```

(The `go` of the machine's PATH is 1.26.1 and `go.mod` wants 1.27.0, which `GOTOOLCHAIN=local` refuses: the build ran with the 1.27.4 toolchain of the module cache first on PATH.) The load of the machine at the start of each case was 22.1, 19.6, 18.5 and 22.2 (the `uptime` line of each case is in the JSON).

| Case | Start MiB | Max MiB | End MiB | Max - start | Received (reader 1) | Gaps | Bad bytes / offsets | Memory (limit 100) | Integrity |
|---|---|---|---|---|---|---|---|---|---|
| a: reads, never `ack` | 103.3 | 141.5 | 141.5 | 38.2 | 163,572,756 B (156 MiB) | 0 | 0 / 0 | PASS | PASS |
| b: reads and acks every frame | 107.7 | 145.6 | 145.6 | 37.8 | 140,648,855 B (134.1 MiB) | 0 | 0 / 0 | PASS | PASS |
| c: two terminals; stream 1 reads and acks, stream 2 never reads | 106.0 | 161.3 | 161.3 | 55.3 | 102,797,426 B (98 MiB) | 0 | 0 / 0 | PASS | PASS |
| d: reads 2 s, stalls 20 s (seconds 3 to 22), resumes | 107.5 | 150.7 | 147.6 | 43.2 | 67,869,194 B (64.7 MiB) | 1 | 0 / 0 | PASS | PASS |

- Start is the host's resident set after the terminal was made and before the stream attached (the host itself is about 104 MiB at rest: this is over that).
- Case c, stream 2 (the one that never read): totals through the end of the drain, so they include the first reads until `yes` was seen and the drain after the window, not only the drain: `ready` end 321, 13,043,729 B received in 7,564 frames, and one `gap [4321722, 90898432)` of 86,576,710 B with 8,722,007 B of output after it; received + gap = 99,620,439 = its next offset; 0 bad bytes and offsets. It was paused throughout the 30 s of RSS sampling (from the moment its flood was seen) and resumed after it, so the RSS above is with it stalled.
- Case d: paused 20.01 s by the clock of the pause and resume calls; one new gap `[7951409, 103612416)` of 95,661,007 B, then 59,917,785 B of exact output after it: received + gap = 163,530,201 = the next offset, 0 bad bytes, 0 bad offsets.
- Every case: `received + gaps = next offset` (start 0) and the pattern of `yes` held byte for byte (`y`, CR, LF from the first run of three lines).
- A 4 s stall (a shorter earlier run) made no gap: the kernel's socket buffers took what the host sent. Only the 20 s of the acceptance was run for the table.
- Every host was stopped by the pid the tool started (SIGTERM, `code 0`, 0 s), and no pid was left. The temporary HOME of each case was removed.

Not run: the native build (Wails WKWebView on macOS, where the stream is a held poll and not a WebSocket, and `ps` counts only resident pages); Windows; a browser reader (the reader here is the protocol, not the page's code: the emulator's parse cost is not in these numbers); a run on an idle machine (the load above is from other work on the box).

## Interim: closing a tab whose feed holds no live stream

A feed ends its terminal (`CloseChannelTerminal`) on a tab close only when it holds a live stream after `ready`, or made the terminal and never opened one. A feed whose stream dropped, is being connected again, or has not said `ready` leaves the terminal alone: another tab may hold it now, and a close of the capability alone would end what that tab shows. The host's lease ends the terminal if nobody holds it. The holder-bound close (the host refusing a close from a stream that is not the holder) belongs to the host, in the v2 wire PR.
