# Status: T3-channel-page (the new UI's terminal on the terminal channel, #693 step 4)

- Goal: the Terminal tool of `ui-next/` reaches its terminals only by capability and one Wails stream per terminal (`docs/ui-next/terminal-channel-protocol.md`), and the events lane is no longer used by the new UI for terminals. Issue #693, steps 4 and 5; epic #692.
- Worktree: `~/omniview/wt/t3-channel-page`. Branch: `ui-next/t3-channel-page`, made from `origin/feat/terminal-channel-backend` at `f009987239743ea1b407bd5d4c86a4d3713ee340` (PR #704, not merged; the lead allows building on it, #693 comment of 2026-11-24). After #704 squash-merges: `git rebase --onto origin/main f009987239743ea1b407bd5d4c86a4d3713ee340 ui-next/t3-channel-page`.
- PR: none yet. Opened as a draft against `main` only after #704 merges (the lead's rule on #693).

## Open decision (owner)

- #693 "Open decision": a window hidden longer than Wails' 10-minute stream grace loses its stream, and the 5-minute detach lease then ends the terminal. Not answered on 2026-11-24. The page states what the host does (the terminal comes back ended); it does not keep a lease alive by itself.

## Log

- 2026-11-24 20:58: `uptime` load average 0.72, 0.78, 0.79. Worktree made; `pnpm install --frozen-lockfile` and `task packages` ok.

## Dev tools

## Backend catalog

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
