# Status: T7-resolve (#696 step 3, `ResolveLink` in Go)

- Agent: ResolveLink. Worktree `~/omniview/wt/t696-resolve`, branch `feat/terminal-resolve-link`, on `origin/main` `11b8d3758`. Not pushed; no pull request.
- Commits: red `b2672a539` (tests against a naive `lstat`: 15 of 18 tests fail by assertion); green `9074c5e93` (resolver, binding, policy pin, bindings, T1-go.md 2.9); lint `dd5f0581b` (no behaviour change; same tests green).
- Contract: `docs/ui-next/status/T1-go.md` section 2.9. Code: `backend/pkg/terminal/linkresolve` (pure, no terminal import), `backend/pkg/terminal/links.go` (the manager's call), `backend/pkg/plugin/exec` (`ChannelTerminalResolveLink`: controller, wrapper, span with no attribute). Windows: `unsupported` like every terminal call.

## Decisions

1. **Name and shape.** `ChannelTerminalResolveLink(capability, rowDirectory, text) -> terminal.LinkResolution{kind file|dir|unknown, path, line, col, reason}`. The Go side parses the position out of the text (`:l:c`, `(l,c)`, `#Ll`, `line N`, `"p", line N`, a trailing `.` `,` `;`, quotes, brackets, `a/` `b/`); one parser, so the page's matcher (step 2) only has to find the candidate. Capability-bound as `ChannelTerminalCwd` is: `liveByCapability`, the one not-found for anything that opens nothing. A plugin session (pod) has no capability, so it can never be resolved against the host's disk.
2. **Directory order.** The row's directory, then the roots, then a bounded scan. The row directory is accepted only if the host vouches for it: the directory the shell is in now, or a record directory with `cwd_trust` `nonce` (#694). Otherwise `unvouched` (a page cannot make the host look at a disk it names). Empty row directory: the shell's own (`s.directory()`); unknown is `no-directory` (or `remote`), never home, never the host's own cwd (test `TestAnUnknownDirectoryIsNotHome`, with HOME and the process cwd set to a directory that has the file).
3. **Roots.** The host knows none (no workspace concept in Go or in the new UI; `window.KindWorkspace` is a window kind). The only root is the terminal's start directory (`Session.Cwd`).
4. **Containment.** A path is answered only if its real path (every link followed) lies in the row directory or a root. This refuses: a symlink out, an absolute path outside, `..` above the roots (`..` is lexical as in VS Code, then the real path is checked). Reason `outside`. Stricter than VS Code on purpose: a stack trace into `/usr/lib/...` is not a link.
5. **Never `/dev`, `/proc`, `/sys`.** Links are walked one component at a time with `lstat` and `readlink` (own `real`, not `filepath.EvalSymlinks`), and the check precedes every look, so the target of a link into `/dev` is read as text and never looked at. Test records every path the file system was asked about.
6. **FIFO, socket, device.** `lstat` only; `special`; never opened.
7. **Time bound.** Per call: 400 ms, 256 operations. Each operation runs in a goroutine that holds one of 16 slots until the system returns it; when all are taken a call answers `timeout` at once. So a hung mount costs at most 16 goroutines, not one per hover. The test holds a `Lstat` on a gate.
8. **Cache.** 10 s, 256 entries, LRU, only hits; every use looks at the file once more. Reason: the host has no write event (VS Code resets on a terminal write), so time is the bound and the last look is cheap (one `lstat`); a deleted file is `gone` then `not-found`; a file made after a miss is found at once. Measured below.
9. **Unicode.** As printed, then NFC, then NFD; the answer is the disk's spelling. Linux is byte-exact, macOS is not.
10. **Scan.** Only when the text is a relative name that climbs nowhere; exactly one match or `ambiguous`; at most 2,000 entries, 4 levels, 512 per read; never enters a link, a hidden directory or `node_modules`.
11. **Canary.** No log line anywhere in the resolver; span `exec.ChannelTerminalResolveLink` has no attribute; errors hold nothing the caller sent. The text is in the answer only.
12. **Policy pin.** `ChannelTerminalResolveLink` denied in `internal/auditgate/policy.json` and listed in `main_audit_policy_test.go`; the channel-isolation classification test lists it as by-capability.
13. `golang.org/x/text` is now a direct dependency (was indirect).

## Controls (each negative has its positive twin in the same test; run whole by `go test -race ./backend/pkg/terminal/linkresolve/ ./backend/pkg/plugin/exec/`)

| Negative | Twin |
|---|---|
| link for a file that does not exist | same text, file present |
| wrong directory | right directory |
| unknown directory is not home | same text with the directory |
| probe of `/dev/*`, `/proc`, `/sys`, and a link into `/dev` (recorder shows none looked at) | a file of the workspace is looked at and found; recorder not empty |
| symlink out of policy, absolute path outside, `..` above the roots | link inside, absolute inside, `..` up to a root; the same out-link with the target's directory as a root |
| symlink loop | `self -> .` chain that ends |
| FIFO and socket not opened | regular file found |
| no time bound (hung `Lstat`) | a path that does not hang resolves meanwhile; released, the hung path resolves |
| deleted file: `gone` | still there: from the cache, one `lstat` |
| canary | the control: the spans were recorded, the secret is in the answer |

Red run (`b2672a539`, naive `Lstat` of `Join(dir, text)`): 15 failures by assertion (no-directory, roots, `/dev`, outside, `..`, loop, unicode, special, timeout, gone, cache, scan, refusals, shapes, end state); the two that passed are the positive twins (exists, right directory).

## Commands and results (Linux amd64, go1.27.4, `GOWORK=off`)

- `go test -race -count=1 ./backend/pkg/terminal/... ./backend/pkg/plugin/exec/...`: ok (terminal 269 s, linkresolve 2.4 s, exec 46 s). `-tags server ./backend/pkg/plugin/exec/streamroute/`: ok. `go test . -run 'Policy|Audit'`: ok.
- `go test -fuzz FuzzParse -fuzztime 20s ./backend/pkg/terminal/linkresolve/`: no failure (76k execs).
- `golangci-lint run --new-from-rev=origin/main` on both trees: 0 issues. `go vet` linux; `GOOS=darwin go vet ./backend/pkg/terminal/...`: ok; `GOOS=windows go build ./backend/pkg/terminal/... ./backend/pkg/plugin/exec/...`: ok. (`GOOS=darwin go vet` of the exec package cannot build wails' cgo guard on Linux: not run.)
- `task bindings`, then `task check:bindings-check`: exit 0. `task packages` then `task check:ui-typecheck` (tsc app, tsc test, kit): exit 0; the two files `task packages` dirties were restored.
- Benchmark `BenchmarkTheCacheHitAgainstTheMiss`: hit 19 us, 16 allocs; miss and scan on a small tree about 157 us, about 100 allocs per resolve.
- End state: `TestAThousandResolvesLeaveNoGoroutineDescriptorOrCacheGrowth`: 1,000 resolves (hit, scan, miss, `/dev`), then `InFlight` 0, cache at most 16 (configured), goroutine count back to the start, `/proc/self/fd` count equal. Timers: each call has one `context.WithTimeout`, cancelled by `defer`; no timer is created otherwise (not counted directly: Go exposes no timer count).

## Not verified

- macOS (`proc_info`, APFS normalisation-insensitive names): the NFC/NFD path was tested on Linux only.
- A real hung network mount: the hang is a gate in the test's file system, not an NFS/SMB mount.
- `remote`: returned when `GetCwd` says remote; no test forces it (the local PTY backend never says it). A local shell that runs `ssh` is not detected: the host cannot tell where the command ran; rows of such a command may resolve against the local directory (the issue's last pitfall). The page should show no link while the foreground is not the shell.
- The page, `openFile`, the seam: not part of this slice. No emulator was involved in any test here (Go only; real `sh` for the exec tests).
- Windows: stub only.
