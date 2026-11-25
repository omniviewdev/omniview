# Status: T3-channel-page (the new UI's terminal on the terminal channel, #693 step 4)

- Goal: the Terminal tool of `ui-next/` reaches its terminals only by capability and one Wails stream per terminal (`docs/ui-next/terminal-channel-protocol.md`), and the events lane is no longer used by the new UI for terminals. Issue #693, steps 4 and 5; epic #692.
- Worktree: `~/omniview/wt/t3-channel-page`. Branch: `ui-next/t3-channel-page`, made from `origin/feat/terminal-channel-backend` at `f009987239743ea1b407bd5d4c86a4d3713ee340` (PR #704, not merged; the lead allows building on it, #693 comment of 2026-11-24). After #704 squash-merges: `git rebase --onto origin/main f009987239743ea1b407bd5d4c86a4d3713ee340 ui-next/t3-channel-page`.
- PR: none yet. Opened as a draft against `main` only after #704 merges (the lead's rule on #693).

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
- **WIRE: input sent on a stream that drops is lost without a word.** What the page types between a cut of its stream and the moment it sees the close goes into the dead socket, and the page cannot tell which input frames the host applied (the channel has no input numbers and no input acknowledgement; the events lane had `seq` and `next_input_seq`). Evidence: the seam's reconnect scenario (ChannelSeam, 2026-11-24) has to wait for the page to see the close before it types. Interim: none in the page. Proper fix at the producer: `ready.input_applied` (input bytes applied from this capability, across streams), so the page resends what came after it. Asked on #693.

## Memory on the real host

The acceptance of #693: the host's resident set stays at most 100 MiB over its start while a reader floods, stalls and resumes. Measured with `ui-next/shell/probes/terminal-host-memory.mjs`, a manual dev tool (not CI; it asserts nothing about memory, it measures and prints, and it holds every received byte to the pattern of `yes`). It starts the real server build over a fresh HOME, makes a channel terminal through the bound call `CreateTerminal` (`launch.channel`), opens `/wails/stream/ws?name=terminal` from Node over a raw socket (so that a stalled reader really stops reading the kernel's buffer), attaches with the capability, types `exec yes` once the shell shows its prompt, and samples `ps -o rss= -p <pid>` of the host process it started once a second for 30 s. No browser, no page code.

Run 2026-11-24 21:37 to 21:40, Linux x64 (Node v26.13.0, Go 1.27.4), branch `wip/t3cp-e` at `0514d47f`:

```
$ uptime
 21:37:57  up 26 days  5:12,  0 users,  load average: 6.90, 9.28, 6.96
$ PATH=<go1.27.4>/bin:$PATH OMNIVIEW_UI=next GOWORK=off GOFLAGS= GOTOOLCHAIN=local task build:server
$ node ui-next/shell/probes/terminal-host-memory.mjs --json=/tmp/hostmem-t3cp-e.json
```

(The `go` of the machine's PATH is 1.26.1 and `go.mod` wants 1.27.0, which `GOTOOLCHAIN=local` refuses: the build ran with the 1.27.4 toolchain of the module cache first on PATH.) The load of the machine at the start of each case was 6.9, 8.3, 8.4 and 10.0 (the `uptime` line of each case is in the JSON).

| Case | Start MiB | Max MiB | End MiB | Max - start | Received (reader 1) | Gaps | Bad bytes / offsets | Verdict (limit 100) |
|---|---|---|---|---|---|---|---|---|
| a: reads, never `ack` | 103.2 | 142.7 | 142.7 | 39.6 | 187,685,227 B (179 MiB) | 0 | 0 / 0 | PASS |
| b: reads and acks every frame | 104.1 | 145.0 | 145.0 | 40.9 | 160,875,858 B (153.4 MiB) | 0 | 0 / 0 | PASS |
| c: two terminals; stream 1 reads and acks, stream 2 never reads | 106.1 | 161.6 | 161.6 | 55.5 | 223,533,643 B (213.2 MiB) | 0 | 0 / 0 | PASS |
| d: reads 2 s, stalls 20 s (seconds 3 to 22), resumes | 106.2 | 144.9 | 144.9 | 38.8 | 76,443,791 B (72.9 MiB) | 1 | 0 / 0 | PASS |

- Start is the host's resident set after the terminal was made and before the stream attached (the host itself is about 104 MiB at rest: this is over that).
- Case c, stream 2 (the one that never read): `ready` end 167, then, read in the 2 s after the 30 s window, 22,835,911 B in 77,879 frames and one `gap [2514432, 142737408)` of 140,222,976 B; received + gap = 163,058,887 = its next offset. Its bytes and offsets are exact too (0 bad). It was resumed only after the 30 s of samples, so the RSS above is with it stalled.
- Case d: one `gap [12726649, 115408896)` of 102,682,247 B after the stall, then exact bytes to the end: received + gap = 179,126,038 = the next offset, 0 bad bytes, 0 bad offsets.
- Every case: `received + gaps = next offset` (start 0) and the pattern of `yes` held byte for byte (`y`, CR, LF from the first run of three lines).
- A 4 s stall (a shorter earlier run) made no gap: the kernel's socket buffers took what the host sent. Only the 20 s of the acceptance was run for the table.
- Every host was stopped by the pid the tool started (SIGTERM, `code 0`, 0 s), and no pid was left. The temporary HOME of each case was removed.

Not run: the native build (Wails WKWebView on macOS, where the stream is a held poll and not a WebSocket, and `ps` counts only resident pages); Windows; a browser reader (the reader here is the protocol, not the page's code: the emulator's parse cost is not in these numbers); a run on an idle machine (the load above is from other work on the box).
