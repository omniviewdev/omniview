# Status: T1-go (the host's local terminal backend states what it knows)

- Agent: TerminalSignals. Goal: close the six producer gaps the Terminal tool's first slice found (`docs/ui-next/status/T1.md`, sections 6 and 7, on `wip/ui-next/t1-terminal`), each at the producer and with a test: initial size, how a session ended, what runs in the foreground, which shell and where, the order of input and resize, release of a retired window's shells. **Owner ruling (2026-11-22), added to the same PR:** the terminal must be an exceptional functional terminal that does what one expects in an IDE, so the shell is a real login environment and the host states the rest of what a terminal knows (section 2.8: login shell and environment, `TERM`, `COLORTERM`, `TERM_PROGRAM`, the `cwd` option and the cwd fact, hangup before kill, flow control, bytes passed untouched).
- Worktree: `~/Repos/omniviewdev/worktrees/t1-go-terminal-signals`
- Branch: `feat/t1-go-terminal-signals` (two commits on `origin/main` `232abbab`: the six items, then the owner ruling; the PR is the pull request of that branch).
- Owned and changed: `backend/pkg/terminal/**`, `backend/pkg/plugin/exec/{service_wrapper,controller,terminal}.go` and their tests, the regenerated bindings, `internal/auditgate/policy.json` (the five new bound methods `IsBusy`, `WriteTerminal`, `ResizeTerminal`, `GetCwd` and `AckTerminal`, all denied), `internal/shellenv/shell.go` (typed refusals and `Name`, see 2.7), `packages/omniviewdev-runtime/src/{exec,models}.ts` (exports), the legacy caller `ui/providers/BottomDrawer/tabs.tsx` (one line), this file and `docs/ui-next/status/T1-go/`. Not touched: `ui-next/**`.

## 1. The six items, in one table

| # | Gap (T1.md section 7) | The producer now says | Where |
|---|---|---|---|
| 1 | Shell started at 72 x 27 | `CreateTerminal(opts, launch)`: the pty has the size before the shell starts; the answer states the applied `cols` and `rows`; zero is the default 80 x 24; a dimension below zero or over 1000 is refused, naming the field | `terminal/manager.go` `launch`, `errors.go` `resolveSize` |
| 2 | CLOSE said "Session terminated" | CLOSE carries a typed `End`: `exited` with `exit_code`, `signaled` with `signal` and `signal_number`, `closed` with `closed_by`, `failed` with `failure.stage`; one per session, after the last output | `manager.go` `wait`, `read`, `finish`, `settle` |
| 3 | No foreground fact | `IsBusy(session)`: `idle`, `busy` (with `name` and `pgid`) or `unknown` (with `reason`): a third state, never a guess | `manager.go` `Busy`, `pty.go`, `foreground_*.go` |
| 4 | Create named no shell | The answer has `shell.path`, `shell.name`, `cwd`, `pid`, `cols`, `rows`, `limits` | `types.go` `Session` |
| 5 | Unawaited input and resize unordered | A per-session bounded queue applies writes and resizes one at a time, in order; an optional `seq` restores the order they were SENT in when the transport delivers them out of order | `terminal/ordered.go` |
| 6 | A reloaded or closed page leaks its shell | A shell belongs to the window that opened it and is ended when the window is retired (rule (a): ended, the restored tab says so) | `service_wrapper.go` `CreateTerminal`, `terminal.go` |

## 2. The UI-facing contract (read this; no Go needed)

Calls are on `ExecClient` (`@omniviewdev/runtime/api`); the types are generated in `packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/terminal/models.ts` and exported as the `terminal` namespace of `@omniviewdev/runtime/models`.

### 2.1 Calls

```ts
CreateTerminal(opts: SessionOptions, launch: { cols?: number; rows?: number; cwd?: string; flow?: boolean }): Promise<terminal.Session>
GetCwd(sessionId: string): Promise<terminal.Directory>
AckTerminal(sessionId: string, bytes: number): Promise<void>   // only meaningful for a session created with flow: true
IsBusy(sessionId: string): Promise<terminal.Foreground>
WriteTerminal(sessionId: string, seq: number, data: string /* base64 */): Promise<void>
ResizeTerminal(sessionId: string, seq: number, rows: number, cols: number): Promise<void>
CloseSession(sessionId: string): Promise<void>            // unchanged name
// unchanged for the legacy UI and for plugin sessions; on a local session they now go through the same queue (arrival order, seq 0):
WriteSession(sessionId: string, data: string): Promise<void>
ResizeSession(sessionId: string, rows: number, cols: number): Promise<void>
```

`CreateTerminal`:
- `opts` is the SDK's `SessionOptions` (it had to stay: `exec.SessionOptions` is the plugin-facing type and the generator keeps it only while a bound method names it). Read: `id` (optional, at most 128 bytes: choose it so the page can listen BEFORE the shell starts; an id that any session, local or plugin, already has is refused 409 `ALREADY_EXISTS` and the first shell is untouched), `command` (empty is the account's login shell; `[path]` an explicit shell; a program that is not a shell is refused), `labels` and `params` (kept and listed as before). Any `resource_*`, `reference` or `route` is refused `INVALID_REQUEST`. `tty` is ignored (always a tty).
- `launch.cols` and `launch.rows`: the size to open the pty at. `0` or absent means "not given": 80 columns, 24 rows, each on its own (the old default was 72 x 27). Below zero or over 1000: refused `INVALID_REQUEST`, detail names `cols` or `rows`; nothing starts. (The legacy UI passes `{ cols: 0, rows: 0 }`: every field of `launch` is optional.)
- `launch.cwd`: the directory the shell starts in: an absolute path to a directory that exists. Empty or absent is the user's home. Anything else is refused `INVALID_REQUEST`, detail names `cwd`; nothing starts.
- `launch.flow`: flow control for this terminal's output (2.8.6). Off, the default, is what a caller that never acknowledges needs.
- A call that comes from no window (a script with no page) is refused 403 `FORBIDDEN`: a terminal nothing could retire would outlive everything (2.6). A window the realm refuses (limit, retired) is refused with the realm's error.
- The answer, `terminal.Session`:

```ts
{ id: string; created_at: string;            // ISO time
  pid: number;                               // the shell's process id
  shell: { path: string; name: string };     // absolute executable; the shell's own name ("zsh", "bash", "dash"): the file a symlink points at
  cwd: string;                               // the directory the shell started in: launch.cwd, or the user's home
  cols: number; rows: number;                // the size the pty was opened at: the size asked for, or the default
  flow: boolean;                             // flow control is on for this terminal (launch.flow)
  limits: { max_dimension: 1000; pending_ops: 256; pending_bytes: 1048576; seq_ahead: 64; gap_wait_ms: 2000;
            flow_high_bytes: 1048576; flow_low_bytes: 262144; hangup_grace_ms: 1500 } }
```

### 2.2 Events (every window receives them; filter by the id)

| Name | Payload |
|---|---|
| `core/exec/stream/stdout/<id>` | the bytes of one pty read, base64 (unchanged). At most 20,480 bytes; the event owns its bytes now (the read buffer is reused) |
| `core/exec/signal/CLOSE/<id>` | **an object**, `terminal.End` (it was base64 text, "Session terminated") |

```ts
type End =
  | { reason: 'exited';   exit_code: number }                                          // the shell exited by itself; 0 is a code: the field is there
  | { reason: 'signaled'; signal: string; signal_number: number; core_dumped?: true }  // killed by a signal the host did not send: "SIGTERM", 15
  | { reason: 'closed';   closed_by: 'request' | 'window' | 'shutdown' }              // the host ended it: CloseSession, the window went away, the host quit
  | { reason: 'failed';   failure: { stage: 'read' | 'wait' | 'pty'; message: string } } // the pty or the wait failed; message is the system's words, nothing branches on it
```

Guarantees (tested): exactly one CLOSE for a session; it is the LAST event of the session (every stdout event, including what the shell wrote just before it exited, comes before it: 25 of 25 runs of a 400-line burst then `exit 4`); none before the session ends; when `CloseSession` (or the end of a retired window's shells) returns, the CLOSE has already been delivered and no event of that session follows, even from a flood. `closed` wins over what the process died of (a closed shell is not "signaled SIGKILL"). A `failed` pty ends the shell too. There is no `ERROR` event for a local terminal.

### 2.3 The busy fact (`IsBusy`), three states

```ts
type Foreground =
  | { state: 'idle' }                                                    // the shell itself holds the foreground (background jobs do not count)
  | { state: 'busy'; pgid: number; name?: string }                       // a process other than the shell holds it; name when the platform gives it
  | { state: 'unknown'; reason: 'unsupported' | 'query-failed' | 'remote' } // the host cannot tell: ASK
```

- How: `ioctl(TIOCGPGRP)` on the pty master gives the foreground process group; it is compared with the shell's own group (`getpgid`). One call at the moment the user presses Close; **no polling, no change event** (the kernel gives none; a push would need a timer). The UI calls it when it needs it.
- The name: macOS, `sysctl kern.proc.pid.<pgid>` (the executable's name, 16 bytes; if the leader of the group has exited, the first live member of `kern.proc.pgrp`); Linux, `/proc/<pgid>/comm` (15 bytes, empty if the leader is gone while the group lives). Both are one syscall or one file read. Empty `name` with `busy` is still busy.
- `idle` is exactly "the shell holds the foreground": `sleep 60` is `busy` with `name: "sleep"`; `sleep 60 &` is `idle`. **Known limit:** a shell that `exec`s into a program is still the foreground group and reads `idle` (the host starts every shell on a tty, interactive, so the shell does its own job control; one that did not would also read `idle` for a running program).
- `unknown`: `query-failed` when the system refused the question; `remote` for a session of a plugin (the host holds no terminal for it); `unsupported` on a build that cannot run local terminals (Windows: section 3). The UI treats `unknown` as ask.
- A session that is gone: 404 `omniview:session/not-found`.

### 2.4 Order and bounds (`WriteTerminal`, `ResizeTerminal`, and the legacy calls)

Each session has ONE input queue and ONE goroutine that applies its writes and resizes, one at a time. No lock is shared between sessions: a shell that does not read stalls its own queue and nothing else (tested: another session starts, answers, resizes and closes while one is blocked inside a 16 MiB write; closing the stalled one answers its writer and stops its goroutine).

- **Order.** `seq = 0`: applied in the order the call reached the host (what `WriteSession` and `ResizeSession` do). `seq >= 1`: the host applies the operations in `seq` order whatever order the calls ARRIVE in. The transport runs unawaited calls at the same time (T1.md measured 4 to 22 inversions in 100 unawaited writes and 2 to 10 in 20 runs of 50 resizes), and a number is the only way the host can know the order they were sent in. Count 1, 2, 3, ... for the session, writes and resizes together, one number for each call.
- A call returns when its operation has been APPLIED (or refused): an error from the pty reaches the call that caused it.
- A call ahead of its predecessor waits for it, at most `gap_wait_ms` (2,000). If the predecessor has not come, the host gives the missing numbers up and goes on; the late call, if it ever arrives, is refused 409 `SEQUENCE_STALE` (never applied out of order, never dropped silently: its caller is told). A call more than `seq_ahead` (64) past the next expected is refused 400 `SEQUENCE_AHEAD`. A number already used is `SEQUENCE_STALE`.
- **Bound and flood.** At most `pending_ops` (256) operations or `pending_bytes` (1 MiB, counting what already waits: one large write is taken when nothing waits) are held per session. Past that a call is **refused at once**, 429 `INPUT_BACKLOG`; the operation was not applied and consumed no number, so the same call may be sent again. No silent drop, no unbounded buffer, no waiting without an answer.
- A resize applies as a real `ioctl` in order with the writes; resizes are not coalesced (the UI's "newest wins" is its own choice).
- `ResizeSession` and `ResizeTerminal` refuse `rows` or `cols` of 0, below 0 or over 1000 (`INVALID_REQUEST`); the old call accepted `0 x 0`.

### 2.5 Errors (read `type` or `code`, never the text; the `code` is also in `parseAppError`)

| `type` | `code` | status | when |
|---|---|---|---|
| `omniview:validation` | `INVALID_REQUEST` | 400 | a size, an id, an owner that is not allowed |
| `omniview:resource/conflict` | `ALREADY_EXISTS` | 409 | the session id is in use |
| `omniview:session/not-found` | `NOT_FOUND` | 404 | no running session with that id (also after it ended, and for `IsBusy`, `WriteTerminal`, `CloseSession`) |
| `omniview:terminal/input-backlog` | `INPUT_BACKLOG` | 429 | 2.4 |
| `omniview:terminal/sequence-stale` | `SEQUENCE_STALE` | 409 | 2.4 |
| `omniview:terminal/sequence-ahead` | `SEQUENCE_AHEAD` | 400 | 2.4 |
| `omniview:terminal/shell-unavailable` | `SHELL_UNAVAILABLE` | 422 | the shell is not installed (a missing binary at start: nothing starts, no pty or descriptor is left: tested by counting descriptors) |
| `omniview:terminal/shell-unsupported` | `SHELL_UNSUPPORTED` | 422 | the program is not a shell the host starts |
| `omniview:terminal/start-failed` | `START_FAILED` | 500 | the pty or the process could not start |
| `omniview:terminal/unsupported` | `UNSUPPORTED` | 501 | Windows |
| `omniview:resource/forbidden` | `FORBIDDEN` | 403 | a terminal from no window |

`CreateSession("local", ...)` (the old route to a shell, which had no owner) now answers `INVALID_REQUEST` "A local terminal starts with CreateTerminal."

### 2.6 Release with the window (B-88 for terminals)

The decision, with the rule it follows: **the shell is ENDED when its window is retired** (rule (a)). Why: the restored tab is rebuilt by session restore as `ended` with the cause "The session ended when the app restarted." (`RESTORED_CAUSE`, S3a: panel sessions never come back running, their output is not restored) and T1.md section 9 puts reattach in a later slice, so a shell kept alive for a bounded time would make that restored tab say something untrue and nothing could reach the shell. A21 (a host tool's sessions survive their PLUGIN's unload) is about a plugin leaving, which retires no window; it is unchanged.

- The owner is the window identity the realm uses (`invocation.IdentityOf`). `WindowRealm.OnRetire` fires for a native window closing (its `WindowClosing`) and for a server-mode page that is gone (INV2's sweep: about 3.4 s after the socket goes). The wrapper subscribes before it makes its first terminal and ends every shell of the retired window; each gets its CLOSE (`closed`, `closed_by: "window"`) before the call that ended it returns.
- A race (the window retired while its shell starts) is closed by asking the realm again once the session is registered: either the retirement finds the session or the realm refuses the window and the wrapper ends the shell itself (tested with 25 pages retired at random moments of their own create calls, then the SYSTEM's list of this process's children: zero).
- Proof: **100 terminals across 20 pages, all 20 retired: 0 shells alive, counted by the 100 pids recorded at creation (`kill(pid, 0)`), each with exactly one CLOSE `closed`/`window`; the 21st page keeps its 2 shells, untouched; the index holds exactly those 2; `ps` lists no child of the test process but the 2.** (`TestHundredTerminalsAcrossTwentyRetiredPagesLeaveNoShellAlive`, 0.65 s.)
- **Not covered (stated, not hidden):** a native window that RELOADS in place keeps its window identity, so the realm never retires it and its old shells run on until the user closes them (the restored tab says they ended). A server-mode reload is a new page (a new identity) and IS covered. Closing it needs a "page reloaded" signal from Wails for native windows (`WindowRuntimeReady` is the candidate) that I could not test in a native window.
- A terminal from no window is refused (2.1).
- What a closed shell leaves: 2.8.5 (SIGHUP to the foreground program and the shell first, SIGKILL after 1.5 s for what ignored it). Whether background jobs end with it is the shell's own rule, and 2.8.5 says which shells.

### 2.7 Shell resolution (`internal/shellenv`)

`Resolve` now wraps `ErrUnavailable` and `ErrUnsupported` (same text as before, so settings keep their messages) and `Name(path)` is exported (it was the unexported `shellName`).

### 2.8 A real terminal (owner ruling, 2026-11-22)

The ruling: the terminal does not have to follow the mock exactly, but it must be an exceptional functional terminal that does what one expects in an IDE. Each point below is stated by the producer, with a test in `backend/pkg/terminal/login_test.go`.

**2.8.1 The shell is the user's login shell, with the user's environment.** How the host gets that environment today: at start `main.go` calls `shellenv.Restore` (macOS only), which runs the user's login shell (`SHELL`, or the account's) as an interactive login shell (`-i -l`), prints a marker and then `env -0` (10 s timeout) and sets what it printed on the host process, keeping the keys the host owns (`HOME`, `SHELL`, `PWD`, `TMPDIR`, `XDG_*`, `OMNIVIEW_*`, `PLUGIN_*`, `GOWORK`, `SHLVL`, `_`). A host started from the Dock or Finder, which gets launchd's minimal `PATH`, therefore already holds the `PATH` a terminal window gives. Each terminal shell is then started the same way, `-i -l`, so the user's startup files run again in the terminal's own session (aliases, prompt, `nvm`, `pyenv`). Nothing needed fixing; what was missing was proof. The test starts the host with a stripped environment (`HOME`, `USER`, `SHELL`, `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, no locale) and a `~/.profile` that prepends a directory to `PATH` and exports a marker: the terminal's `$PATH` starts with that directory and still has the system's, and the marker is set (`TestTheShellIsALoginShellSoTheUsersStartupFilesRunWhateverEnvironmentTheHostHas`). A Linux host is not restored at start (a desktop session gives GUI applications the session's environment, and the terminal's login shell adds the rest); Windows has no local terminal (section 3).

**2.8.2 What the terminal tells its programs.** `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=Omniview`, `TERM_PROGRAM_VERSION=<the host's version>` (`internal/version`, `0.0.0-dev` in a development build), `SHELL=<the shell that started>`, and a UTF-8 `LANG` (`en_US.UTF-8` on macOS, `C.UTF-8` elsewhere) only when `LANG`, `LC_ALL` and `LC_CTYPE` are all unset or empty: a locale the user chose is theirs and is never overridden. VS Code's integrated terminal sets the same kind of markers: `TERM_PROGRAM=vscode`, `TERM_PROGRAM_VERSION` and `COLORTERM=truecolor`, which its shell integration scripts and many prompts test for (https://code.visualstudio.com/docs/terminal/shell-integration; from my knowledge of its integration scripts, not re-read line by line in this run). JetBrains' terminal sets `TERMINAL_EMULATOR=JetBrains-JediTerm` and `TERM=xterm-256color` [INFERENCE: from memory, not read in this run]. Omniview does not borrow either name: a program that wants to know it runs in Omniview tests `TERM_PROGRAM=Omniview`. Tests: `TestTheShellIsToldItRunsInOmniviewAndWhatItsTerminalCan` (three locale cases, through a real shell) and `TestTerminalEnvironmentKeepsTheHostsAndStatesTheEmulatorOnce` (the pure function).

**2.8.3 Where the shell starts (`launch.cwd`).** An absolute path to a directory that exists, else the user's home; `terminal.Session.cwd` says which. A relative path, a missing path and a file are refused `INVALID_REQUEST` naming `cwd` before anything starts.

**2.8.4 Where the shell is now (`GetCwd`).** `GetCwd(sessionId)` answers `terminal.Directory`: `{ path }`, or `{ reason: 'unsupported' | 'query-failed' | 'remote' }` (the same words as `IsBusy`'s `unknown`). It is the shell's own current working directory, read when asked: on Linux `readlink /proc/<pid>/cwd`, on macOS the `proc_info` system call with `PROC_PIDVNODEPATHINFO` (what `proc_pidinfo` does; no cgo). One call, no polling, no event: the UI asks when it opens a new terminal in the same place or draws a tab. It names the shell's directory, not a program's: a program the shell runs elsewhere does not change it. On macOS the path is the physical one (`/private/var/...`), as `pwd -P` gives. A session that is gone is 404; a session of a plugin answers `remote`. Test: `TestTheShellStartsWhereTheCallerSaidAndTheHostNamesItsCurrentDirectory` (the shell `cd`s and the fact follows).

**2.8.5 Closing hangs up first.** `CloseSession`, and the end of a retired window's shells, send SIGHUP to the foreground process group and to the shell, wait `hangup_grace_ms` (1,500) for the shell to exit, then kill what is left: SIGKILL to the foreground group and to the shell. This is what a terminal window closing does (the kernel hangs up the foreground group when the master closes; the host sends the signal itself so that the shell's own jobs hear it too). Tests: a shell at its prompt ends inside the grace; a shell that traps SIGHUP and runs a `sleep 600` that inherited the trap lives until the grace has passed, and both are then gone. **Background jobs:** an interactive bash or zsh that receives SIGHUP sends it on to its background jobs before it exits (bash's manual: "Before exiting, an interactive shell resends the SIGHUP to all jobs, running or stopped"), so a job the user did not `nohup` or `disown` ends with its terminal; dash and other shells that do not forward it, and `nohup`ed or disowned jobs, survive. That is the shell's rule and the host does not override it: it does not kill the process tree behind the shell's back. VS Code ends a terminal by closing the pty and calling node-pty's `kill()` on the shell (`src/vs/platform/terminal/node/terminalProcess.ts`, `_kill`, read in this run; node-pty's default signal is SIGHUP [INFERENCE: from memory]) and keeps a separate whole-tree kill, `killTree`, for tasks (`src/vs/base/node/processes.ts`, read in this run); so it too hangs up the shell and leaves the jobs to it. JetBrains: [INFERENCE: pty4j's `destroy` is not read in this run]. Test: `TestClosingHangsUpTheBackgroundJobsOfABashShell` (bash: the job is gone after the close).

**2.8.6 Flow control (`launch.flow`, `AckTerminal`).** Without it the host reads and delivers as fast as the shell writes: the only buffer in the host is the 20 KB read, and the Wails per-client queue after it has no bound (T1.md item 9). With `flow: true` the host counts the bytes it delivered that the caller has not acknowledged. At `flow_high_bytes` (1 MiB) it STOPS READING the pty, so the shell blocks in its own write (the kernel's pty buffer is the only buffer left), and it reads again when the caller has acknowledged down to `flow_low_bytes` (256 KiB). `AckTerminal(sessionId, n)` acknowledges `n` bytes: call it as the output is written into the emulator, in batches. **The bound:** at most `flow_high_bytes` plus one read (20,480 bytes) is ever delivered and unacknowledged. A page that is hidden or stuck simply does not acknowledge, and the shell pauses; it never blocks the close: a paused session still closes (the reader stops waiting once the shell has exited) and its CLOSE is delivered. VS Code does this with `FlowControlConstants` in `src/vs/platform/terminal/common/terminal.ts` (`HighWatermarkChars = 100000` read in this run; the low mark and the acknowledgement size, 5,000 characters each, [INFERENCE: from memory]) and the pause in `terminalProcess.ts`; the unit here is bytes and the marks are larger because an event through Wails costs more than a message to a Node pty host. A terminal started with `flow: false` ignores `AckTerminal`; it is off by default because the legacy terminal never acknowledges and would freeze after 1 MiB. Tests: ten MiB through the real pty arrive complete and in order (a SHA-256 over all 10,485,760 bytes), with flow control off and on; with no acknowledgement the delivery stops within one read of the high mark and nothing arrives for 500 ms, an acknowledgement resumes it, and the paused session still closes (`TestTenMebibytesOfOutputArriveCompleteAndInOrder`, `TestFlowControlStopsReadingAtTheHighMarkAndResumesWhenTheOutputIsAcknowledged`).

**2.8.7 UTF-8 and every other byte pass untouched.** The host never decodes the shell's output: an event is the bytes of one read (at most 20,480), and a multi-byte character, a combining mark or an escape sequence that a read cuts in two arrives in two events as the same bytes. The caller must decode as a stream (`TextDecoder` with `{ stream: true }`, or write bytes to the emulator). Test: a two-, three- and four-byte character, a wide character and a combining mark, cut at every byte boundary by a shell that prints the halves 0.3 s apart (`TestAMultibyteCharacterSplitAtAnyByteBoundaryPassesThroughUntouched`): the bytes are exact, and the test asserts that the host really delivered the cut in two events.

## 3. What works where

| Item | macOS (run) | Linux (run) | Windows |
|---|---|---|---|
| 1 size | tested | tested (arm64 container, root, dash) | `CreateTerminal` answers `UNSUPPORTED`: the host has no ConPTY backend (the stub is unchanged in kind). The size rule is shared code (compiled and vetted) |
| 2 exit | tested | tested | n/a, no session can start |
| 3 foreground | tested, name by sysctl | tested, name by `/proc/<pgid>/comm` | `IsBusy` answers `unknown/unsupported`. What a ConPTY backend could know: it has no process group, so only the shell's child processes; a child can be a background job or the foreground program, so it could say `idle` only when there is no child and `unknown` otherwise, never `busy` |
| 4 identity | tested | tested | n/a |
| 5 order | tested (queue 14 tests, real pty 3) | tested | the queue is platform-independent code, compiled and vetted for Windows; no session to attach it to |
| 6 release | tested (wrapper, real shells) | **exec package not run on Linux here** (Wails needs cgo and GTK, the container has neither); it is Linux CI's job | n/a |
| (a) login environment | tested (stripped environment, `.profile`) | see section 4, row 12 | n/a: no local terminal. The host does no restore on Windows either |
| (b) `TERM` and the rest | tested | see row 12 | the pure function is shared code, compiled and vetted; no session to apply it to |
| (c) `launch.cwd` | tested | see row 12 | `CreateTerminal` answers `UNSUPPORTED` |
| (d) `GetCwd` | tested, `proc_info` | see row 12, `/proc/<pid>/cwd` | answers `unknown/unsupported`; a ConPTY backend would have to read the process's current directory out of its PEB (`NtQueryInformationProcess` and `ReadProcessMemory`): not cheap, not built |
| (e) hangup, then kill | tested | see row 12 | n/a: Windows has no SIGHUP, and no session can start |
| (f) flow control | tested (10 MiB, stall, resume, close while paused) | see row 12 | `AckTerminal` answers `UNSUPPORTED`; the flow code is platform-independent and compiled for Windows |
| (g) bytes untouched | tested (5 characters, every cut) | see row 12 | n/a |

The Windows build and vet are clean (section 4, row 6). The stub's whole API is the unix manager's, so `service_wrapper.go` and `controller.go` compile unchanged.

## 4. Verification (macOS, Darwin 27.0.0 arm64, unless said; `uptime` was 18 at the start, no timing is claimed)

| # | Check | Result |
|---|---|---|
| 1 | Tests first, seen red (queue): the 14 queue tests against a naive stand-in that does what the host did before (every call applies its operation itself, at once, with no order, bound or number; `red-queue.sh.txt`) | **12 of 14 red** (order by arrival, order by number, hold, gap, stale, ahead, duplicate, backlog flood, bytes bound, no-consumed-number, close answers every caller, empty write); 2 pass (a slow device does not block another queue: the stand-in shares no lock either; a device error goes to its caller) |
| 2 | The old manager's global lock: `WriteSession` held `m.mux.RLock()` across the pty write and `CloseSession`/`StartSession` needed `m.mux.Lock()`, so one blocked write stalled every session. The new manager holds its lock only for the map lookup. The test `TestASessionWhoseShellDoesNotReadDoesNotBlockAnother` starts, writes, resizes and closes other sessions while one is blocked in a 16 MiB write; it was not run against the old code (the lock is read from the source above) | green |
| 3 | Negative controls for the rest (rule 28), each fault in a scratch copy of one file built with `go test -overlay`, the worktree untouched (`mutations.sh.txt`, `mutations2.sh.txt`) | **RED, each by the test named for it:** size 72 x 27 (`TestShellStartsAtTheRequestedSize`, `...DefaultSize...`); size not validated (`...AbsurdSize...`); signal never typed (`TestKilledBySignals...`); exit code always 0 (`TestExitedWithACode...`); close always "request" (`TestClosedByTheWindow...`); foreground always idle and a background job counted busy (`TestForegroundIsIdle...`, both); shell name empty and cwd unstated (`TestTheAnswerNames...`, both); duplicate id allowed (`TestASessionIdInUse...`); sequence order ignored (`TestQueueHolds...`, `...TooFarAhead`); queue unbounded (`TestFloodingASession...`); retirement subscriber a no-op (`TestHundredTerminals...`, `TestANativeWindowClosing...`); session created with no owner (`TestANativeWindowClosing...`); **the master not closed when a session ends: green on macOS (a blocked write is woken by the kill there) and RED on Linux** (`TestASessionWhoseShellDoesNotRead...`). Two first attempts broke the build and are not results; the shell-path fault was not re-run. The second half of rule 28 (the same fault passing undetected with the assertion removed) was NOT done |
| 4 | `go test ./backend/pkg/terminal/ ./backend/pkg/plugin/exec/ ./internal/shellenv/ ./internal/auditgate/ -race -count=3` (macOS, the final tree) | **green** (terminal 10.5 s, exec 9.4 s, shellenv 2.8 s, auditgate 6.8 s) |
| 5 | Linux arm64 (`golang:1.27.4-bookworm`, root, `sh` is dash), `go test ./backend/pkg/terminal/ -race -count=1 -v` | **green, 36 tests**. The first run failed 3 tests that waited for the prompt `$`; root's prompt is `#`, so the tests no longer read the prompt (they wait for a marker the shell prints) |
| 6 | Windows: `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build` and `go vet` (tests compiled) of `./backend/pkg/terminal ./backend/pkg/plugin/exec ./internal/shellenv ./internal/auditgate`; Linux `go vet -tags purego` of the three | **clean** |
| 7 | CI Go set (`task check:go-build`, `check:go-vet`, `check:go-test`, `check:go-test-devcontrol`, `check:fmt-check`) | build, vet, devcontrol, fmt **exit 0**. The first whole-module `check:go-test` failed ONE test, `backend/pkg/plugin/metric` `TestReferenceUtilitiesFailBeforeConnectionWorkWithoutAdmission`, which pins that `CreateSession("local", ...)` with a resource intent is `INVALID_REQUEST` (I had removed the local branch: it answered `INTERNAL`). Fixed: the old route now answers `INVALID_REQUEST` always (2.5). **The whole module again on the final tree: 71 packages ok, the root package, `exec`, `metric`, `terminal`, `auditgate` and `shellenv` among them; one failure, `internal/devworkspace` `TestWatchRecoveryCannotDeclareReadyWithUnrebuiltSDKBackend`** (a 15 s wait, 14.96 s, at a load average of 77): the load flake INV3 recorded for the same test at load 16 to 25. It passes alone (`-count=3`, 16 s). The package imports `internal/shellenv`, which this change touched (typed errors, `Name`), and nothing in that test resolves a shell |
| 8 | Bindings: `task bindings`, then `task check:bindings-check`; `TestPolicyMatchesGeneratedBindings`, `TestDangerousMethodsStayDenied` (the three new methods are denied sentinels), `TestRegisteredEventNamesAreClassified` | `check:bindings-check` **exit 0** (the tree is unchanged after it); the three tests are in the whole-module run above; the SDK's `SessionOptions` is still generated (see decision 1) |
| 9 | TypeScript: `tsc -p tsconfig.app.json`, `tsc -p tsconfig.test.json`, the kit's typecheck | clean. Control: with the legacy caller as on `main` the app project fails (`tabs.tsx(119,16): TS2554 Expected 2 arguments, but got 1`); with the new call it passes |
| 10 | Lint, CI's form: golangci-lint v2.15.0 (`/private/tmp/gl215/golangci-lint`), change committed, `git diff origin/main...HEAD` as the patch, `--new=false --new-from-patch --path-prefix=` | **0 issues**. (A first run on the packages without the patch filter found 18 findings in my new and rewritten code; all fixed before the commit: shadowed errors, `nilerr` shapes, an unused `unparam` result, gosec conversions with their reason, a goroutine's context, import order, `go-require` in a test.) |
| 11 | Owner-ruling tests (`backend/pkg/terminal/login_test.go`), macOS: `go test ./backend/pkg/terminal/ -race -count=3` (the whole package, the earlier tests included) | **green** (76 s) |
| 12 | Linux arm64 (`golang:1.27.4-bookworm`, root, `sh` is dash), `go test ./backend/pkg/terminal/ -race -count=1 -v` | **green**: the login `PATH`, `TERM` and the rest, the cwd option and `/proc/<pid>/cwd`, the hangup and the grace, the bash background job, 10 MiB in both modes, the flow stall, every UTF-8 cut. The first run failed two tests: in a container whose first process does not reap orphans a killed grandchild stays a zombie, and `kill(pid, 0)` still finds a zombie. The tests now accept "gone or a zombie" (`ended`), which is what "it was killed" means |
| 13 | Negative controls for the ruling (`T1-go/mutations3.sh.txt`: 13 faults, each in a scratch copy of one file, `go test -overlay`, the worktree untouched) | **13 of 13 RED, each by the test named for it:** no `TERM_PROGRAM`; no `COLORTERM`; the user's locale overridden; no default locale; not a login shell (`-l` dropped); the cwd option ignored; the cwd fact always unknown; close kills at once with no hangup; the hangup never escalates; flow control never pauses; acknowledgements never credited; bytes decoded on the way; a byte lost in every read. (A first run showed two REDs that were build failures, a variable the fault left unused; the two faults were rewritten to build and fail the test.) |
| 14 | `go test -race -count=3 ./backend/pkg/plugin/exec/ ./internal/shellenv/ ./internal/auditgate/`; the root audit tests (`TestPolicyMatchesGeneratedBindings`, `TestDangerousMethodsStayDenied`, `TestRegisteredEventNamesAreClassified`) | green (5.4 s, 1.6 s, 6.1 s); root ok |
| 15 | `task bindings`, `task check:bindings-check`; `tsc` for the app, the tests, the runtime and the kit | `check:bindings-check` exit 0; `tsc` clean (the legacy `{ cols: 0, rows: 0 }` still typechecks against `Launch`: every field is optional) |
| 16 | Lint in CI's form on the whole patch, after the second commit; `GOOS=windows CGO_ENABLED=0 go vet` of `backend/pkg/terminal` and `backend/pkg/plugin/exec` | **0 issues** (a first run found 8 in the new code: three shadowed errors, two redefinitions of a builtin, a magic number, an unused `nolint`, a deprecated x/sys constant; all fixed); Windows vet exit 0 |

## 5. Not verified

- **The real host.** I did not run the server build, a page, or the Wails transport: the claim that numbered calls restore the sent order over HTTP and IPC is the queue's tested behaviour under 32 callers with random jitter (1,000 operations, the device sees them in numbered order), not a measurement through Wails. The first thing to run: T1.md's `host-facts.mjs` unawaited-write and unawaited-resize cases twice, without `seq` (through `WriteSession`, they should still show inversions) and with `seq` through `WriteTerminal` and `ResizeTerminal` (0 expected); and the seam: create from a page, read the CLOSE payload, retire the page.
- The exec package on Linux and the whole module on Linux/Windows (CI).
- A native window (WKWebView): the in-place reload gap in 2.6.
- The legacy UI's behaviour at runtime (only its typecheck and its mocked tests); the new default size (80 x 24) replaces 72 x 27 for it, and it resizes after attach as before.
- The owner-ruling items through the real host: the login-environment test strips the test process's environment, it does not launch the app from the Dock (the restore at start, `shellenv.Restore`, is existing code that I read and did not change). Flow control with the real UI: nothing acknowledges yet (the Terminal tool's side); the host's side is tested with a sink that acknowledges and one that does not. `proc_info` on macOS versions other than this one (Darwin 27.0.0): the offsets are those of `<sys/proc_info.h>` (`proc_vnodepathinfo` is two vnode paths of 152 + 1,024 bytes). JetBrains' behaviour is cited from memory and marked [INFERENCE].
- `proc_info` is called directly (system call 336, which libproc's `proc_pidinfo` makes) so that the package stays free of cgo. Apple documents only libproc: a macOS that changed the call would break `GetCwd` until it moves to the cgo wrapper. Tested on this macOS only.
- `forwardSignals` (it swallows SIGQUIT in the host: B-90) is carried over unchanged.

## 6. Backend catalog (T1.md section 7 numbering; for the lead to add to `backend-catalog.md`)

| T1.md item | State |
|---|---|
| 1 foreground | **closed** (`IsBusy`) |
| 2 initial size and shell name | **closed** |
| 3 exit code and signal | **closed** |
| 4 order of input and resize | **closed** (queue always, `seq` for the transport's reordering); not measured through Wails (section 5) |
| 5 B-88 release with the window | **closed for terminals** (a), except the native in-place reload (2.6) |
| 6 events and buffers | **partly**: a read no longer pins its 20 KB buffer (the event gets a copy of `n` bytes; one buffer is reused), and the single forwarding goroutine and unbuffered channel are gone (each session's reader calls the sink itself; a slow `Emit` still blocks only that session's reads: HGO-34's backpressure is kept). Still open: one event per read (no coalescing), the SDK's ring that reallocates 1 MB on every append |
| 7 close leaves children | **closed as far as a host can**: SIGHUP to the foreground group and the shell, SIGKILL after 1.5 s for what ignored it (2.8.5); background jobs end with an interactive bash or zsh and survive in dash or when `nohup`ed: the shell's rule |
| 8 repeated id, `ResizeSession` of 0 | **closed** (both refused) |
| 9 wire backpressure, pause or credit | **closed for the pty side, opt-in**: `launch.flow` with `AckTerminal` (2.8.6); the Wails per-client mailbox itself is still unbounded and is only kept empty by the credit. The input side has a bound and a typed refusal |
| 10 attach has no byte offset | open |
| 11 environment, tab name | the tab name is `shell.name`; the environment is the login environment plus `TERM`, `COLORTERM`, `TERM_PROGRAM` and a UTF-8 locale (2.8.1, 2.8.2); the host's own `OMNIVIEW_*` variables still reach the shell (open) |
| HGO-34, -35, -36 (`optimisations.md` 4.4) | kept: one event per read with backpressure; the 1,000,000-byte replay buffer and attach-returns-the-buffer-only; the shell starts sized by `pty.StartWithSize` (and a pty the process cannot start with is closed), rows before columns (`stty size` after `ResizeSession(33, 117)` is `33 117`). The test that pinned the old 27 x 72 default is replaced by the size tests |

## 7. Decisions for the lead

1. **`CreateTerminal(opts, launch)`, not one new options type.** A host `Options` type would have orphaned `exec.SessionOptions` in the generated bindings (I ran it: the generator drops a type no bound method names, and the runtime's `exec.ts`, its hooks and the `exec` namespace plugins compile against need it). Keeping the SDK options first and adding the host's `Launch` (size, cwd, flow: every field optional) second keeps that type generated, keeps the legacy call one argument longer, and costs nothing.
2. A call from no window is refused. The UI agent's Node scripts (no page) can no longer start a terminal; a Playwright page can.
3. The default size is 80 x 24 (was 72 x 27 and hard-coded).
4. `seq` is optional: the UI may keep awaiting (correct without it) or number its calls and send them unawaited. The wait before a missing number is given up is 2 s: a longer wait stalls input behind a lost call, a shorter one refuses a late call.
5. The CLOSE payload of a local session changed from base64 text to an object. The legacy terminal ignores the payload (`Terminal.tsx` handles CLOSE without reading it).
6. `CreateSession("local", ...)` is refused: it started a shell with no owner.
7. Rule (a) for windows, and the native in-place reload gap (2.6): to close it, the host needs Wails' "runtime ready" for a native window, which I could not test.
8. Flow control is opt-in (`launch.flow`): the legacy terminal never acknowledges, so a host that paused unconditionally would freeze it after 1 MiB. The new UI turns it on and acknowledges as it writes into the emulator.
9. Close hangs up, then kills after 1.5 s (2.8.5). The host does not kill the process tree behind the shell's back, so background jobs follow the shell's own rule.
10. The login environment is not recomputed for each terminal: the host's restore at start (macOS) plus the shell's own `-i -l` are the source (2.8.1). A Linux host is not restored.

## 8. Dev tools

In `docs/ui-next/status/T1-go/` (`.txt`, drop the suffix): `red-queue.sh.txt` (runs each queue test against a pre-built test binary, one process each, 25 s cap), `mutations.sh.txt` and `mutations2.sh.txt` (the negative controls: a `sed` fault in a scratch copy of one file, `go test -overlay`, the worktree untouched). Throwaway, not kept: the pty probes (macOS and Linux) that decided the design (log below), and the naive queue stand-in (a 60-line file with the same methods).

## 9. Log

- 2026-11-22: read `AGENTS.md`, the UI agent's `T1.md` (sections 6 and 7), INV2 and INV3, the window realm, the metric registry's retirement hook (B-86), the exec controller and wrapper, creack/pty, the audit policy, `optimisations.md` 4.4.
- 2026-11-22: probed the real pty on macOS arm64 and Linux arm64: `TIOCGPGRP` on the master works on both; after the shell dies the master reads data then EOF (macOS) or EIO (Linux) at once, even with a background job holding the slave; **the master `os.File` creack hands back is blocking on both** (its own ioctls call `Fd()`), and on Linux a write blocked in the kernel is NOT woken when the process is killed (still blocked 8 s later) and only a close of a pollable master wakes it; a pollable master (dup the fd, non-blocking, `os.NewFile`) works on both and `Close()` interrupts a blocked read or write. Interactive `sh` and `bash` ignore SIGTERM and SIGQUIT (so the signal tests use SIGKILL, SIGHUP, and a shell that `exec`s into a program killed from outside).
- 2026-11-22: queue and manager written, tests first for the queue (red against the stand-in), controls for the rest after; the wrapper, the policy, the bindings, the legacy caller; Linux run found three prompt-dependent tests (fixed); the first whole-module run found the metric test that pins the old `CreateSession("local")` answer (fixed).
- 2026-11-22: OWNER RULING by message: a real login environment, `TERM_PROGRAM`, a `cwd` option, the cwd fact, hangup before kill, flow control, untouched bytes. Facts first: `shellenv.Restore` already gives a Dock-launched host the login environment and the terminal's `-i -l` runs the startup files on top. Wrote `env.go`, `flow.go`, `cwd_{linux,darwin,other}.go`, the hangup in `manager.go`, `login_test.go`; `Size` became `Launch`; `GetCwd` and `AckTerminal` are bound and denied in the audit policy.
