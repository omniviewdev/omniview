# SDK2: the exec lane. What is wrong, the target design (an interactive session and a bounded run on one lane), the local terminal, compatibility, steps

> **Copy for the terminal handoff** (2026-11-24). The lead's plan `SDK2-exec-lane.md` of 2026-11-22 (two passes), copied unchanged except its last paragraph (local scratch paths removed). Cross-references: `T-terminal-prior-art.md` is `prior-art.md` here; `T-terminal-bar.md`, `T1-go.md` and `T1.md` are in `../status/`; `SDK0`, `SDK1` and `proposals/` are private notes. **Status since it was written (2026-11-24):** X0 (plugin-sdk #89, tagged v0.22.1) is on `main`; X1 (#87), X2a (#88), X3a with the X2a repairs (#90) and X2b (#91) are merged on the branch `feature/exec-v2`, which is **not tagged**; X3b and X3c are PR #92 (open); X4a, X4b and every host and Kubernetes-plugin step (H1a-1 to H-run, K1a to K2) are not started. `README.md` in this folder has the table, and `exec-tag-gate.md` the conditions of the first tag. The owner's six questions of section 9 were answered by the lead under the owner's delegation: the answers are in `README.md`.
>
> **Corrections found in review of this copy** (the plan's text below is unchanged). (1) The Kubernetes provider example (`ExitTransport(0)` for client-go's `nil`; search for it below) and case (16) of the second pass ("a stream that ends with no status ends `Lost`, never `Exited{0}`") disagree, because client-go's `nil` is also what a Success status looks like. `exec-lane-k8s-proof.md`, section 4.4, measured it on a real cluster and settles it: `Exited{0, TRANSPORT}` ("ended normally, the command's status not known") for a `nil` or a read Success, never PROCESS for a Success; `Lost` only for a broken leg (FIN, RST, 1006) or a heartbeat that gives up. For the Kubernetes end, read that section, not case (16). (2) The nonce canary of the shell-integration work cannot cover raw `Output` frames: the integration script prints the nonce inside its own marks and the SDK forwards those bytes unchanged. The canary covers logs, spans, audit lines, errors and typed marks, not the raw output stream.

Agent `ExecLanePlan`, 2026-11-22. A plan: no code, no PR, no tag, nothing pushed. The only files written outside this note are scratch test harnesses in two throwaway worktrees (never committed; copied to `SDK2-exec-lane-assets/`).
Bases read: plugin-sdk `origin/main` 6885ca6 (v0.21.0 plus #82 #83 #84 #85); host `origin/main` 77ce06f8; host `feat/t1-go-terminal-signals` b7025fe5 (T1-go, two commits on 232abbab); host `wip/ui-next/t1-terminal` ee98530d (PR #660); Kubernetes plugin `origin/feature/ui-next` 8af576f (the shipped plugin is `main` v0.21.2 on SDK v0.20.0); the in-progress exec close-race PR C (worktree `exec-close-race`, branch `fix/exec-manager-close-race`, read only, not redone here). `docs/ui-next/status/T-terminal-bar.md` **does not exist** in any branch I could read; the terminal bar is taken from T1.md section 4 and the owner's ruling, and VS Code and JetBrains behaviour is cited from memory and marked [INFERENCE].
Marks: **[read]** I opened the code. **[ran]** I ran it. **[note]** from a recorded note. **[INFERENCE]** not run. Size scale as in SDK0 (S 1-3, M 3-6, L 6-10 engineer-days, whole row across repos, review and evidence included).

**Edit history.**
- **2026-11-22, first version** (`ExecLanePlan`): the plan as first written.
- **2026-11-22, second pass** (at `Main`'s request, after `T-terminal-prior-art.md`; section 6, mechanisms 14 and 15, ranks 3, 7, 8 and 11 and the five pitfalls folded in or rejected one by one, 2.7). **Contract (4.3, 4.4, 4.5, 4.6):** a `Lost` end that is never exit 0 and an `ExitSource`; marks with `command_id`, `command_line` and a `trust` level backed by a per-session nonce; an integration bootstrap for pods (an argv wrapper, with consent, never by default); `Link` health frames and a `mode_reset` string; `OutputCompleteness` on `Ended` and on every `Run` stream, with `OUTCOME_LOST` and a bound on the drain after the exit; an atomic attach reply (`Replay`: start, end, bytes, start size, size, modes) and an explicit `Detach` with a lease; `Capabilities.exit_report`, `stall`, `link_health`, `integration`. **One correction of my own (4.5, "Flow control"):** blocking the target's reader is the wrong rule for Kubernetes, where a blocked reader stalls the status channel too and the tail is lost; a target that declares `stall = LOSSY` is drained eagerly into the ring and what the ring overwrites is counted. **Steps (7):** X1 rewritten for dispatch; X3a, X3c, H1a-1, H1a-2, H1b, H-run, K1b, K2 and X5 gain items; X4 splits into X4a (scanners) and X4b (integration bootstrap); new H1c (the local provider adopts the scanner and the attach reply) and H-transport (an optional Wails transport spike). **Rejected with a reason (2.7):** a producer-vouched mark level, `resume_hint`, a helper binary in the pod, a file service. **Compatibility is unchanged:** everything new lives in the new service (6). Section 9 changed in question 4 only. **Checked:** client-go 0.37.2 sources, the host's use of `seq`, the plugin's `go.mod`, and the new proto under `buf build` [ran]; anything about a real cluster stays [INFERENCE].

Owner rulings this plan obeys (verbatim):
- 2026-11-21: "anywhere you see where an improvement to the SDK would make a drastic improvement to simplify or signal proper state/status (or just in general) do it there. do not try to infer consumer side when a producer side signal is optimal. you are fine to mean breaking changes".
- 2026-11-22, about exec: "if improvements could be made to the [SDK] to make it much easier for plugin authors, improve anything like performance or reliability or clean signaling, etc (including anything breaking) that should be done over trying to work around it ... especially if it helps unlock more powerful terminal integration and agent tool functionality later on".
- 2026-11-22, about the terminal: "you don't need to follow the mock exactly but it needs to be an exceptional functional terminal that does what you would expect in an ide".

## 0. The answer

1. **The exec lane is the one lane whose author contract was written around a mechanism, not a purpose.** An author gets a kernel pty slave (`*os.File`) that the SDK opened in the plugin process, a `stopCh`, a resize channel, and a rule nobody wrote down ("returning means started; send on `stopCh` when it ends"). The SDK reads the pty master, copies into a 1 MB buffer, and pushes frames through ONE gRPC stream shared by every session of the plugin (`manager.go:126-177`). The Kubernetes plugin needs 1,089 lines for it (862 for the terminal itself) plus 261 more for a non-interactive "Run Command" action. About half of the 862 and three quarters of the 261 are code every plugin that bridges a remote command would write again (section 1.4). I count 11 concepts an author must hold.
2. **What the host and the UI cannot get today, so they guess or go without (section 2.2):** an exit code or signal (a CLOSE frame carries the text "\nSession closed\n", `manager.go:588-593`), whether the remote side has a TTY (Kubernetes hard-codes `Tty: true`, `register.go:277`, and ignores `SessionOptions.TTY`), the initial size (hard-coded 27 x 72, `manager.go:27-30`; no size in `SessionOptions`), a resize acknowledgement, the target's identity and name, the program that actually ran, the foreground and the cwd, dropped-byte counts, an offset to join replay and live output, whether a session survives a reload or a restart, and the state of each container in a picker.
3. **Reliability, measured [ran] (section 3):** one session can stall the others: six resizes of a session whose handler does not drain stall another session's echo (p99 **460 ms**); a 1 MiB paste into a session whose remote stopped reading stops another session's keystroke from being accepted at all (**not accepted in 3 s, without bound**); one flooding session puts every other session's output behind up to 4,096 frames (another session's echo p50 **233 ms** at a 50 µs per-event host cost, **443 ms** at 100 µs). The last bytes before an end are lost in **12 to 29 of 60** runs on macOS and **48 to 54 of 60** on Linux (64-256 KiB outputs) because cleanup closes the pty master before the reader drained it; a 2 KiB command that ends at once is gone before the host can attach in **39 to 51 of 60** runs (attach answers NOT_FOUND, the whole output lost); a second `Stream()` after the first ended delivers **49-50%** of a flood; a stream that ends by EOF leaves **100 of 100** sessions running; `Close` races `CreateSession` (B-99, PR C, other agent).
4. **Performance, measured [ran]:** through SDK + gRPC (+ the host controller) the lane moves **10 to 35 MB/s on macOS and 23 to 27 MB/s on Linux arm64**, in 1,024-byte frames (macOS; the pty returns at most 1 KiB) or 4,081-byte frames (Linux), while a bare gRPC stream on the same machine moves **670 to 1,900 MB/s**. The lane burns **230 to 395 CPU-ms per MB** (macOS) and allocates **about 1,000 bytes per byte delivered** (macOS; 250 on Linux) because the "cyclic" output buffer reallocates its whole 1 MB on every append once full (`buffer.go:36-64`). A keystroke echo through SDK + gRPC + the host's controller is fine: **p50 37 µs, p95 61 µs** (unix socket, no Wails). The cost the user feels is not the echo; it is the flood, the shared queue, and the facts that are missing.
5. **The shape I recommend: one lane, two shapes, one author function.** The author writes ONE function, `ExecFunc(ctx, *Proc) (Exit, error)`: "run this command in this target with these stdio streams until it ends". `Proc` gives `Stdin io.Reader`, `Stdout`/`Stderr io.Writer`, a latest-wins `Resize <-chan Size`, the validated target and request, and `Started`. That is exactly the shape of `remotecommand.StreamWithContext`, of Docker's attach and of an SSH session, so the Kubernetes plugin's whole bridge becomes about 40 lines and has no pty, no `stopCh`, no goroutine. The SDK derives both shapes from it: **(A) an interactive session** (one gRPC stream per session; facts at open; typed End; offsets; replay; flow control from HTTP/2) and **(B) a bounded non-interactive run** (argv only, mandatory time and size bounds, typed outcome and refusals, counts of what was dropped). A model of the data plane [ran] holds **800-900 MB/s on macOS (3 GB/s on Linux), echo p95 44 µs, and a flooding or stuck session does not move another session's echo** (section 3).
6. **Agents:** a bounded "run a command in this Pod" tool already exists, but only as a Kubernetes-private resource action (`pod_exec_action.go`): bounded by that plugin's own constants (256 KiB a stream, 30 s default, 100 s maximum), "dangerous" only as a sentence in its description, audited without its arguments, and refused with a flattened "tool invocation failed". In the new design the plugin registers a target once and the **host builds the `run` tool from it, the way it already builds the logs tool** (`resource_tools.go:165-175`): the plugin writes no schema, no limits and no timeout code; the host enforces a per-connection exec grant that is **off by default and fails closed**, always asks for consent on exact arguments, clamps the bounds, and writes an audit record (argv digest and a redacted preview, env names only, exit, counts) before and after the call (section 4.6).
7. **The local terminal should implement the same contract as an in-process provider** (section 5). The host already imports the SDK's session types, T1-go already built what a plugin session lacks (typed End, foreground, cwd, ordered input, credit flow control), and the UI wants one feed. What moves into the SDK: the `End`, `Foreground`, `Directory` and facts types (JSON-identical to T1-go's, so the generated TS does not change). What stays in the host: the pty, the login environment, hangup and kill, window ownership, and the ordered-input queue and flow credit (they move UP one level, in front of every provider).
8. **Compatibility (section 6):** exec is a **mixed lane**: the create roots (`SessionOptions`, `ResourceSessionResponse`, `PlanNativeCommandResponse`) are strict, the stream and every other message are lenient. The new lane is a new gRPC service, so **everything in it is additive and needs no protocol bump**; an older plugin answers `Unimplemented` and the host stays on the legacy path with facts shown as unknown. Only the DELETION of the legacy lane (service, Go API, pty, host adapter) is bump-or-flip bound; I add it to SDK0's batch as one row (B7). The shipped Kubernetes plugin keeps working on the legacy lane until the flip.
9. **Steps (section 7), in order of value, none above M:** X0 (S) repairs the legacy lane where the baseline is indefensible and the host's local terminal shares the code (the ring buffer); X1 (M) lands the contract, the author API, `Describe` and `Options` (so the container picker can show real container states early) and the conformance skeleton; X2a (M) the lifecycle primitive and the engine core, X2b (M) `Run`; H1a-1 (M, host) the provider abstraction, the legacy adapter and typed events, so the terminal's next slice (Pod exec with a container picker) proceeds on one code path while facts are unknown, then H1a-2 (the local terminal as a provider) and H1a-3 (per-window release for plugin sessions); K1a, H-run and K1b the Kubernetes `Options`, the bounded agent `run` tool and the Kubernetes run target; X3a (M) `Open`, X3b (S) resize, signals and stdin EOF, X3c (M) replay, detach and lease; H1b and K2 the host's plugin provider and the Kubernetes sessions on the new lane; X4a (M) the scanners (marks with trust, terminal modes) and X4b (M) the integration bootstrap for remote shells; H1c (S-M) the local provider adopts the scanner and the attach reply; H-transport (M, optional) a Wails transport spike; X5, X6 and F1 the local-process helper, the registry in the other lanes and the flip deletions. Waves in 7.0.
10. **Not in the SDK (section 8):** the emulator and scrollback, window ownership, agent policy and consent and the audit sink, error sentences, the login environment, hidden probing commands inside targets (the one consented, visible integration bootstrap of 4.5 excepted), persistence beyond what a target gives, any shell-string builder.
11. **Open questions (section 9), six:** the default posture of the agent tool; whether the audit may record the agent's self-declared client name; the default detach window; shell integration injection in the local shell; the Windows local terminal; naming of the author API at the flip.

## 1. How the lane works today (the facts that bound the plan)

### 1.1 The SDK (plugin-sdk `origin/main` 6885ca6) [read]

| Part | What it is | Where |
|---|---|---|
| Wire | `ExecPlugin`: ten unary RPCs (`GetSupportedResources`, `GetSession`, `ListSessions`, `CreateSession`, `CreateResourceSession`, `PlanNativeCommand`, `AttachSession`, `DetachSession`, `CloseSession`, `ResizeSession`) and ONE bidirectional `Stream(stream StreamInput) returns (stream StreamOutput)` that multiplexes every session's input and output by `id`. Package `omniview.sdk.exec.v1`. A flat `proto/exec.proto` also exists with no importer. | `proto/v1/exec/exec.proto:169-184` |
| Input | `StreamInput{id, data}`. No signal, no EOF, no sequence, no resize (resize is a separate unary RPC). | `exec.proto:129-132` |
| Output | `StreamOutput{id, target STDOUT/STDERR, data, signal, error, seq}`. `signal` mixes process signals with lifecycle (`CLOSE`, `ERROR`, `SIGWINCH`); nothing ever sends a process signal. `seq` counts frames of stdout data only; CLOSE and ERROR frames carry none. | `exec.proto:134-167`, `stream.go:173-180` |
| Author contract | `Handler{Plugin, Resource, TargetBuilder, DefaultCommand, TTYHandler, CommandHandler, NativeCommandHandler, SupportsNativeCommand, HandlesResize}`. `TTYHandlerFunc(ctx, opts, tty *os.File, stopCh chan error, resize <-chan SessionResizeInput) error`. `CommandHandler` and `SessionHandler` are declared and never used by the manager. | `opts.go:49-63,105-135` |
| Session | `Manager` owns `sessions map[string]*sessionState`; each session has a real pty pair (creack/pty; slave in raw mode; opened 27 x 72), two goroutines (`handleStream`, `handleSignals`), a 1,000,000-byte output buffer, `Attached bool`, `nextSeq`. Output reaches the sink only while `Attached`; otherwise it is buffered. `createSession` calls the handler synchronously, then registers the session. | `manager.go:308-400,498-540`, `terminal_real_unix.go:53-85` |
| Streams | `Manager.Stream` creates the output channel (capacity 4,096 frames) and the sink **once**, from the first stream's context; one goroutine (`handleStreamInput`) serves the input and the resize of every session. | `manager.go:126-200` |
| Resize | `ResizeSession` RPC sends on an unbuffered `m.resize` channel (500 ms timeout); the loop then either resizes the local pty (`HandlesResize` false) or sends to the handler's channel (500 ms timeout). | `manager.go:179-200,687-713` |
| Errors | `StreamError{title, message, suggestion, retryable, retry_commands}` (English presentation text written by the plugin) from an `*ExecError`, or the raw `handlerErr.Error()` as stderr data and as the message. Session-level errors are `ExecSessionError` codes (not found, handler not found, closed, terminal error, exists). | `manager.go:544-594`, `errors.go`, `stream.go:147-170` |
| End | `StreamSignalClose` with the data "\nSession closed\n". No exit code, no signal, no cause. | `manager.go:587-593` |
| Detach/attach | `DetachSession` only clears `Attached` (output keeps buffering, 1 MB, forever); `AttachSession` returns the buffer bytes and sets `Attached`. No offset ties the buffer to the live stream. No timeout. | `manager.go:610-650` |
| Native plan | `PlanNativeCommand`: the plugin plans a LOCAL command (`kubectl exec ...`) that the host launches in an external terminal (macOS only). Separate feature. | `native_command.go` |
| Windows | `NewRealTerminalFactory` always fails off unix: **no plugin on Windows can open any exec session**. | `terminal_real_other.go:15` |
| Test helpers | `exectest`: a `Manager` with pipe-backed fake terminals and a recording sink. It does not cover gRPC, a real pty, ordering, flow, teardown or the host. No conformance suite for an author's own handler. The Windows CI leg runs only `go test ./pkg/v1/exec/...` on those fakes. | `exectest/*`, `.github/workflows/native-exec.yml` |
| Docs | A row in `docs/capabilities.md` and a section on native planning. There is no exec authoring guide. | `docs/capabilities.md:22,97-130` |

### 1.2 The host (omniview `origin/main` 77ce06f8) [read]

- `backend/pkg/plugin/exec/controller.go`: one `outputMux` channel (unbuffered, `:75`) and one `runMux` goroutine (`:232-254`) carry the output of **every session of every plugin**; `dispatchOutput` (`:188-230`) turns each frame into one Wails event (`core/exec/stream/<target>/<id>`; `core/exec/signal/CLOSE/<id>` with the fixed text; `core/exec/signal/ERROR/<id>` with the plugin's `StreamError`, raw). The forwarding goroutine of a plugin (`:377-406`) never restarts a broken stream, and `OnPluginStop` (`:439-455`) deletes the plugin's sessions from the index **without telling the window**. `ListSessions` fails if any one plugin's call fails (`:684-687`). `safeSend` recovers from a panic on a closed channel (`:150-161`).
- Argument orders: the SDK client takes `(rows, cols)`, the host `Provider` interface `(cols, rows)` (`provider.go:21`), the adapter swaps back (`adapter_v1.go:93-95`), the controller swaps again (`controller.go:864-869`), the service wrapper takes `(rows, cols uint16)` (`service_wrapper.go:210`) and `StreamResize` declares `Cols` before `Rows` (`stream.go:289-293`). Four conventions for one pair.
- The local terminal `backend/pkg/terminal` (main): `StartSession` with a hard-coded 27 x 72, CLOSE with the text "Session terminated", the exit status only in a log, a 20,480-byte buffer allocated per read, no cwd, no foreground, one global lock held across a pty write (`manager.go:27-31,110-191,255-303,306-323`). It reuses the SDK's `exec.Session`, `StreamOutput`, `StreamInput` and `OutputBuffer`, so the type vocabulary is already shared.
- **T1-go (`feat/t1-go-terminal-signals`, b7025fe5) closes most of that for the local shell** [read]: `CreateTerminal(opts, launch{cols, rows, cwd, flow})` answers `terminal.Session{id, pid, shell{path,name}, cwd, cols, rows, flow, limits}`; CLOSE carries a typed `End{reason: exited|signaled|closed|failed, exit_code, signal, signal_number, core_dumped, closed_by, failure{stage,message}}`, exactly one, after the last output; `IsBusy` answers `Foreground{idle|busy|unknown}`; `GetCwd`; an ordered input queue with optional `seq` and typed refusals (`INPUT_BACKLOG`, `SEQUENCE_STALE`); per-window release (`closed_by: window`); hangup before kill; opt-in credit flow control (`AckTerminal`); a login environment; UTF-8 passthrough. A plugin session answers `unknown/remote` to `IsBusy`. **That is the contract the plugin lane has to meet.**
- Per-window release (INV2/INV3, B-88): `WindowRealm.OnRetire` frees metric and graph sessions; **exec and terminal sessions of plugins are still not owned by a window** (`INV3.md`, table of per-window tables; the local terminal is released by T1-go).
- Redaction (SDK1, B-97): about 40 sites on the exec, logs, metric and networker lanes carry the plugin's raw error text to the page or the logs with no public-text gate; on exec: the `StreamError` event and the stderr data of an error (`controller.go:200-212`).

### 1.3 Agent tools today [read]

- The MCP relay (`internal/mcprelay`) builds tools from the catalog and from the host's own lanes. For a resource type that has a logs handler it adds a host-bound `logs` tool (`resource_tools.go:165-175`), read-only, answered by `ReadResourceLogs` (`resource_logs.go:15-17`, `logs/headless.go`). For each non-streaming resource action it adds an `action_<id>` tool with the plugin's descriptor, `Destructive: !readOnly` (so true), and the sentence "The provider marks this action dangerous" when `Dangerous` is set (`resource_tools.go:214-235,355-373,555`). **`Dangerous` is only that sentence.**
- **So an agent can already "run a command in this Pod and get stdout, stderr and the exit code": the Kubernetes plugin's `exec` action (`pkg/plugin/resource/resourcers/pod_exec_action.go`)**: argv only, no shell, no TTY, no stdin, 256 KiB per stream (head kept, the rest counted as "truncated"), default 30 s and at most 100 s, UTF-8 repaired, exit code from `CodeExitError`; on timeout the stream closes and "the remote process may keep running" (a sentence in the description). The bounds live in the plugin and are not declared anywhere the host can read.
- Authorisation: `Config.Listed`, `ConnectionAccess` (default **allowed** unless `BlockConnectionsByDefault`), presets (`read-only` excludes actions), per-tool overrides (`Enabled`, `Confirm`: a user override of `Confirm=false` removes the prompt), `Destructive` tools default to consent, consent is bound to the exact arguments (`Authority.Bind`), 2-minute confirmation timeout, 2-minute call timeout (`policy.go:29,59,189-197,232-288`, `server.go:35,815-1040`, `confirm.go:13`). H6 found that the per-connection policy is keyed by the connection id and **fails open** for an id it does not know.
- Audit: `AuditEvent{At, InvocationID, CredentialID, SessionID, PluginID, Tool, Operation, PolicyRevision, CatalogRevision, Outcome}` "deliberately excludes arguments, resource identity, raw provider errors, credential material and client-supplied metadata" and is written as one log line through the host logger (`audit.go:9-20`, `server.go:141-143`). The relay knows a credential and an MCP session, not a named agent: "a shared bearer proves possession of one credential, not a client name or a distinct person" (`authority.go` comment).
- Errors reach the agent as fixed words: any plugin failure becomes "tool invocation failed" (`server.go:1001,1007,1026`); the typed classes the plugin knew are lost.
- The SDK's tools lane (`pkg/v1/tools`, `docs/tools.md`) is the other way a plugin could offer "run a command": a custom `tools.Tool` with its own schema and handler, reached through `r.tools.CallTool` (`server.go:984`, host `tools/controller.go:352`). The host treats every custom tool as arbitrary native work: it always asks consent, even when a preset or override enables it, and it is never in the `read-only` preset because "annotations are provider hints, not host authority" (`policy.go:195-197,269-273`). A per-plugin custom `exec` tool would therefore repeat G1 to G8 in every plugin (schema, bounds, truncation, refusals) and still be the plugin's word for what it does; the host-built operation of 4.6 is the alternative. I read how the relay reaches the tools controller and what it decides before and after; I did not read `tools/controller.go` line by line.

### 1.4 What a plugin author writes today: the Kubernetes plugin on `feature/ui-next` 8af576f [read]

Interactive exec, non-test lines (`wc -l`): `register.go` 398, `node_handler.go` 214, `pod_attach.go` 111, `native_command.go` 227, `diagnostics.go` 65, `observability.go` 60, `client_provider.go` 14: **1,089**; without the separate native-plan feature (227) **862**. The non-interactive "Run Command" action: `pod_exec_action.go` **261**. Tests for the exec package: 1,901 lines.

| Concept an author must hold (11) | Where | Boilerplate every plugin repeats? |
|---|---|---|
| 1. `Handler` with 9 fields incl. three callbacks and `HandlesResize` | `register.go:28-61` | yes (34 lines) |
| 2. the 5-parameter `TTYHandlerFunc` and its unwritten rule "return = started" | `register.go:63-127`, `node_handler.go:33-50` | yes (~65 lines of entry and admission glue) |
| 3. `stopCh`: send the end of the session from a goroutine, mind `ctx.Done` | `register.go:263-293` | yes |
| 4. the resize channel and its adapter (`terminalSizeQueue`) | `pod_attach.go:21-41` | yes (21 lines) |
| 5. the pty slave as `*os.File`, including "never call `Fd()`" | `opts.go:105-113` | yes |
| 6. context lifetimes: `ctx.Context` is the session's after the handler returns | `register.go:81-95` | yes |
| 7. canonical target admission: provider, type, route, connection, reference scope, incarnation, tagged `ResourceData` map | `register.go:132-211` | **yes (83 lines)** |
| 8. stringly parameters (`container`, `mode`, `pod_uid`, `node_shell_image`, `node_shell_command`) with no schema | `register.go:96-112`, `node_handler.go:64-74` | yes (informal contract with the UI) |
| 9. error classification and presentation: text matching in the plugin plus English titles, suggestions, retry commands | `register.go:299-398` | the matching (~35 lines) is the plugin's; the presentation (~65) is the host's vocabulary |
| 10. spans and log fields per session | `diagnostics.go`, `observability.go` (125 lines) | yes (~100 lines) |
| 11. a non-interactive run: parameter decode, capped writers, UTF-8 trimming, timeout, result mapping | `pod_exec_action.go:54-261` | **yes (~190 of 261)** |

My count (by line range, a classification not a measurement): of the 862 interactive lines about 436 are repeated code (50%); of the 261 run lines about 190 (73%). What stays Kubernetes-specific and stays in the plugin: the request and executor build (~22 lines), the debug pod (~170), `waitForDebugContainer` (69), the classification table (~35), the default-container rule (18). After the change the exec code of the plugin is about 600 lines of which ~40 are the bridge, and 450 lines leave.

Two footguns the table hides, both [read]: (1) the node handler registers **without** `HandlesResize` (`register.go:33-38`, the pod handler sets it at `:51`), so for node shells the manager resizes a local pty nobody reads and the remote never learns any size [INFERENCE: not run against a cluster]; (2) `Tty: true` is hard-coded, so a non-interactive session with separate stderr is not expressible through the lane at all.

## 2. What is wrong or missing, with file:line

Rows are numbered so the steps can name them. Marks as above. "Class" is the wire class of the fix in SDK0's terms: **A** lenient and additive, **B** strict and additive in shape, **C** breaking by meaning or Go API; **N** new service (additive, no bump).

### 2.1 For plugin authors (SDK)

| ID | Where | What is wrong | Fix (producer-side) | Class |
|---|---|---|---|---|
| A1 | `opts.go:105-122`; `manager.go:356` then `:384`; containers plugin `register.go:134-152` | The contract does not say whether the handler returns at start or at end. A handler that blocks until the end (the containers plugin does) holds `CreateSession` for the whole session, and the manager registers the session only after the handler returns. | One function that returns when the command ends. The SDK owns start, run and end. | N |
| A2 | `manager.go:337`; `terminal_real_unix.go:53-85`; `terminal_real_other.go:15` | A kernel pty pair is allocated in the plugin process for every session, even though the process is remote: 2 fds, a kernel hop (a second copy, a scheduler wake-up per chunk), a raw-mode hack to avoid double echo (`:75`), and **no exec at all on Windows**. | Stdio as `io.Reader`/`io.Writer` owned by the SDK. A pty only for plugins that run a local process (helper, X5). | N |
| A3 | `opts.go:63`; `manager.go:189-199`; K8s `register.go:33-38` | `HandlesResize` is a flag the author must remember; forgotten, the remote never learns a size (the Kubernetes node handler forgot it). A handler that does not drain the channel loses sizes after 500 ms. | Resize always arrives through `Proc.Resize`, latest wins, never blocks the SDK, acknowledged. | N |
| A4 | `session.go:131-143`; `manager.go:27-30`; `terminal_real_unix.go:82` | No size in `SessionOptions`; the pty opens 27 x 72; the remote shell lays out its first prompt for it. | `Start.size`; the first value of `Proc.Resize`; `Request.Size`. | N |
| A5 | `stream.go:147-170`; `manager.go:573-581`; K8s `register.go:299-398` | Errors carry English presentation written by the plugin (`Title`, `Suggestion`, `RetryCommands`) and the raw error text as stderr data; the plugin matches text of its own API to choose a sentence. | The plugin maps its own failure to a closed class and reason plus bounded facts; the host writes the words. The matching stays in the plugin (it is its API), the sentences leave. | N |
| A6 | `manager.go:587-593`; K8s `register.go:362-366` | No exit status reaches the SDK's output; the Kubernetes plugin puts "Command exited with status N" in a message string. | `Exit{Code, Signal}` as the return value. | N |
| A7 | K8s `register.go:132-211` (83 lines); `session.go:131-143` | Every resource-backed plugin re-parses the canonical reference, route, scope and incarnation and the tagged `ResourceData` body. | The SDK admits and validates; the author receives `Request.Ref`, `Request.Selection`. | N |
| A8 | `pod_exec_action.go:54-261` | No non-interactive run exists in the SDK; each plugin writes capped writers, UTF-8 repair, timeouts and result mapping. | `Run` derived from the same function. | N |
| A9 | K8s `diagnostics.go`, `observability.go` | Per-plugin spans and log fields for the same session events. | The SDK emits the session span and fields (id, target type, outcome, exit, duration, bytes, drops). | N |
| A10 | `exectest/*` | Fake pipes only; no conformance suite an author runs against their own handler; no stress harness. | `exectest.Conformance` over the real engine and the real transport (X1-X3). | N |
| A11 | `docs/capabilities.md` | No authoring guide. | `docs/exec.md` with the author function, the capability table and the conformance recipe (X1). | |

### 2.2 For the host and the UI: every fact it cannot get or must guess

| ID | Fact | Today | Evidence | Producer signal |
|---|---|---|---|---|
| F1 | Exit code and signal | not carried; text only | `manager.go:587-593`; T1.md 6 "Exit" | typed `End` (`exited`, `signaled`), one, last |
| F2 | Who ended it | not carried | same | `Closed{by: request, host-shutdown, detach-timeout, idle-timeout, superseded, connection-retired, plugin-stopped, run-timeout}`; the host adds `window` |
| F3 | Whether the remote has a TTY | Kubernetes always true; `SessionOptions.TTY` ignored | K8s `register.go:244-246,277` | `SessionFacts.tty` (granted) |
| F4 | Initial size, and that a resize was applied | none; 27 x 72; `ResizeSession` returns when the size is queued | `manager.go:27-30,687-713` | `Start.size`; `Resized{seq, size, result}` |
| F5 | The target's identity and name | `Session` has id, command, labels, params only; the host index has plugin and connection | `session.go:20-27`; `controller.go:54-58` | `TargetFacts{provider, type, id, display_name, selection}` |
| F6 | The program that actually ran | `Command` echoes the request (empty for the default) | T1.md 6 "Create answer names no shell" | `Program{argv, name, path}` |
| F7 | Foreground busy | `unknown/remote` | T1-go 2.3 | capability `foreground_fact` none/pull/push; typed `Fact`; otherwise `unknown`, never probed |
| F8 | Current directory | none (OSC 7 in the bytes only) | T1-go 2.8.4 | capability `cwd_fact`; typed `Fact`; marks |
| F9 | Output dropped or truncated | silent: the buffer evicts, the sink drops | `buffer.go:36-64`; `sink.go:39-42` | `Dropped{stream, from_offset, bytes, reason}` and per-session counters in `Ended` |
| F10 | Where replay ends and live begins | no offset; about 370 lines differed in T1's attach-during-flood | T1.md 6 "Q6" | one byte offset per session on `Output` and on replay |
| F11 | Stream and session health | a broken stream leaves sessions "running" in the UI forever; the plugin's stop emits nothing | `controller.go:377-406,439-455` | a stream per session: its end IS the signal; typed `Failed{class: connection}` |
| F12 | Does a session survive a reload, a stream break, a host restart? | `Attached` flag only; unlimited, untimed | `manager.go:610-650` | declared `Capabilities.host_restart` and `SessionLimits.detach_timeout`; table in 4.5 |
| F13 | What each container can do now (a picker) | JSONPath over the Pod body; init and ephemeral containers absent; no state | K8s `register.go:53-60` | `Options` RPC: choices with `state` and `default` |
| F14 | What this target supports (resize, signals, stdin EOF, env, cwd, kill behaviour) | nothing declared | `ExecHandler` (`exec.proto:54-60`) has three fields | `Describe` + `Capabilities`, restated per session |
| F15 | Owner of a session | none (B-88) | `INV3.md` | opaque `labels` set by the host; release stays host-side |

### 2.3 Reliability

| ID | Where | What | Evidence |
|---|---|---|---|
| R1 | `manager.go:393` vs `:118` | `Manager.Close` races `CreateSession`: `m.wg.Go` against `m.wg.Wait` (B-99; `sdk-84-teardown-race.md` SHOULD 1; 4 of 5 `-race` runs, one `WaitGroup is reused` panic). **PR C is fixing it; not redone here.** The plan below makes the class impossible by construction (4.7). | [note] review |
| R2 | `manager.go:126-139`; `sink.go:39-42` | A second `Stream()` reuses the first call's sink and context; once that context is done `OnOutput` selects between a send and a closed `Done`: about half of all output is dropped. | [ran] **49.9% (macOS) and 50.5% (Linux) of 8 MiB delivered** |
| R3 | `plugin_server.go:340-341,355-361`; `manager.go:141-155` | The end of a stream has two exits: the context (cancels every session) and the closed input channel (does not); `close(multiplexer)` runs before `cancel()`. A client `CloseSend` therefore leaves every session running; a cancel cancels them. | [ran] EOF: **100 of 100 sessions still running**; cancel: 0 of 100 |
| R4 | `manager.go:141-177,596-607` | One goroutine serves the input AND the resize of every session. A pty write that blocks (the remote stopped reading) blocks them all; a resize of a handler that does not drain stalls them for 500 ms each. | [ran] 6 resizes: another session's echo **p99 460 ms, max 461 ms**; a 1 MiB paste into a stuck session: **another session's keystroke not accepted in 3 s (unbounded)** |
| R5 | `manager.go:544-594` | Cleanup closes the pty master first (`:548`); bytes the author wrote just before the end that the reader has not read are lost. | [ran] 64 KiB then end at once: **22 to 54 of 60 runs lost bytes** (375 to 5,249 bytes a run); the same with a 100 ms pause before the end: **0 of 60**, which proves the cause |
| R6 | `manager.go:610-650,540-566` | Output flows only after `AttachSession`; a session that ends first is gone, and its output with it. | [ran] a 2 KiB command that ends at once: **39 to 51 of 60 runs ended before the attach** (NOT_FOUND) |
| R7 | `plugin_client.go:37-260` | Every client call uses `context.Background()`: a wedged plugin hangs `CloseSession` and `ResizeSession` for ever. | [read] 8 sites |
| R8 | `plugin_client.go:289,310` | The sender goroutine blocks on `range in` after a stream failure until the host closes `in`; the receiver does an unselected `out <- ...`: a host that stops reading leaks it. | [read] |
| R9 | `buffer.go:36-64`; `manager.go:505` | Unbounded work per frame, see P1; a 4 KiB slice per read. | [ran] |
| R10 | `manager.go:610-650` | A detached session runs for ever and buffers 1 MB; nothing reclaims a session whose host went away. | [read] |
| R11 | `stream.go:259-286`; `exec.proto:129-132`; `terminal_real_unix.go:75` | No stdin EOF and no signal in the input direction: a non-tty run with stdin is not expressible and a Stop or Kill by signal does not exist. Ctrl+C in a tty works only because it is the byte 0x03 through the raw-mode pty; nothing else is delivered. | [read] |
| R12 | K8s `pod_exec_action.go:34`; `register.go:289-293` | Ending a non-tty exec only closes the stream; the remote process may keep running. That is a fact about the target, today a sentence. | [read] |
| R13 | `controller.go:377-406` (host) | A broken stream is never reopened; sessions are orphaned (F11). | [read] |
| R14 | `docs/resource-v2-contracts.md:145` | Exec sessions have "RPC-independent lifetime" and no tie to the connection generation: a retired connection leaves sessions on a dead client. | [read]; [INFERENCE: not run] |
| R15 | `manager.go:505,587-593`; `pod_exec_action.go:141-151` | Binary safety. The SDK passes bytes untouched (good), but frames are cut at the pty read size, so a multi-byte character or an escape sequence is cut between frames and nothing says where it continues (T1.md: 461 of 52,950 events ended inside a UTF-8 character); the legacy End writes control text into the output data stream after the output (data and signal share one channel); the Kubernetes run action repairs UTF-8 lossily in the plugin (`strings.ToValidUTF8`), so an agent cannot tell raw bytes from repaired text. | [read]; T1.md 6 "Q7" [note] |

### 2.4 Performance (measured, section 3)

| ID | What | Evidence |
|---|---|---|
| P1 | The "cyclic" output buffer allocates and copies its full 1 MB on every append once full: **about 1,000 B allocated per byte delivered (macOS), 250 (Linux)**; 230-395 CPU-ms/MB (macOS), 89-107 (Linux) | `buffer.go:36-64`; T1.md 7 item 6 saw it in the code |
| P2 | 1,024-byte frames on macOS (the pty read limit), 4,081 on Linux: 65,000 frames and events for 64 MiB | [ran] |
| P3 | Throughput 10-35 MB/s (macOS), 23-27 MB/s (Linux) against a bare gRPC stream at 670-1,900 MB/s on the same machine | [ran] |
| P4 | One shared FIFO (4,096 frames in the SDK, one unbuffered channel and one goroutine in the host) puts every session behind a flooding one: with the host's per-event cost at 50 µs another session's echo p50 is **233 ms**, at 100 µs **443 ms** | [ran] |
| P5 | Copies per byte: remote -> executor buffer -> pty slave write -> kernel -> master read -> buffer append -> frame -> proto marshal -> gRPC -> unmarshal -> channel -> controller -> Wails JSON/base64 | [read] |

### 2.5 Agents

| ID | What | Evidence |
|---|---|---|
| G1 | The run tool exists only for Kubernetes pods, as plugin code (261 lines); another plugin writes its own or has none | `pod_exec_action.go` |
| G2 | Its bounds (256 KiB, 30/100 s, no stdin, no env, no cwd) are private constants the host cannot read, clamp or show | same `:22-27` |
| G3 | `Dangerous` is a sentence in the description; no host rule depends on it | `resource_tools.go:369` |
| G4 | Authorisation is the general tool policy: default-allow per connection unless the user blocked by default; a `Confirm=false` override removes the prompt; the connection id changes at the H6 flip and the policy fails open for an unknown id | `policy.go:232-288`, H6 |
| G5 | Audit excludes the arguments by design: a run cannot be reconstructed (what ran, with what exit) | `audit.go:9` |
| G6 | Refusal classes are lost: FORBIDDEN by cluster RBAC, target gone, container not running, no shell in the image and a timeout all reach the agent as "tool invocation failed" | `server.go:1001,1007,1026` |
| G7 | Output is head-only; the middle and tail are cut, and the UTF-8 repair happens in the plugin, so the agent cannot tell raw bytes from repaired text | `pod_exec_action.go:118-166` |
| G8 | A timed-out run may keep running remotely; the agent is told in prose | `:34` |
| G9 | No streaming variant, so the UI's "run this in the container" action has no live output and no cancel | [read] |

### 2.6 Host-owned items found on the way (the facts are the host's; do not move)

| ID | Where | What and the fix |
|---|---|---|
| H1 | `controller.go:75,232-254` | the single `outputMux` FIFO and the inline Emit are the host's half of P4: per-session delivery (T1-go already did it for local sessions) |
| H2 | `controller.go:439-455` | a plugin's stop or crash must end each of its sessions with a typed End in the window |
| H3 | `controller.go:684-687` | `ListSessions` must not fail for all plugins when one fails |
| H4 | `controller.go:599-666` | plugin sessions are not owned by a window: store the owner at create, release on `WindowRealm.OnRetire` (as T1-go does for the local shell) |
| H5 | four argument orders | one type, `Size{cols, rows}`, everywhere |
| H6 | `internal/mcprelay` | the exec grant, consent, bounds and audit (4.6) are the host's trust boundary and stay there |

### 2.7 Second pass: what the prior-art study added, accepted with its evidence and rejected with its reason

Source: `T-terminal-prior-art.md` (section 6, mechanisms 14 and 15, ranks 3, 7, 8 and 11, and the five pitfalls). Where I could check a claim in code I did; the rest is marked [note] (taken from the study) and stays unverified. Each accepted row names the change (the wire is 4.3, the Go API 4.4, the semantics 4.5 and 4.6) and the step that carries it (7).

| # | The gap or defect | Evidence | Change and step |
|---|---|---|---|
| G10 | A stream that ends with no terminal status is reported as a clean exit 0: client-go returns nil for an empty error channel and for a Success status alike, and the plugin turns nil into a bare CLOSE | `errorstream.go:42-50` [read, client-go 0.37.2]; k/k#130885, exit 0 after a kubelet restart [note] | `End.lost`, `Exit.Lost`, `LostCause`, `OUTCOME_LOST`; X1 (wire), X3a (the end), K2 (a spike on telling the two apart) |
| G11 | The code has no stated source: Kubernetes exec has no signal field (a kill is folded into 128+n), attach reports no status at all, ssh reports a signal separately; a consumer cannot tell a process's own status from a transport's | the folding and the attach status [note]; today every end is a CLOSE with text (`manager.go:588-593` [read]) | `ExitSource`, `Capabilities.exit_report`, the `Exit` constructors; X1, K2 (declares `CODE` and `NONE`) |
| G12 | A typed mark has no command id, no command line and no trust: an agent cannot be given "the last command", and any program that prints an OSC 133 can forge a mark | VS Code's command record and the agent-host protocol carry the id and the line [note]; the forgery is a property of an in-band protocol | `Mark{command_id, command_line, trust, duration_ms, redraw}`, `MARK_INPUT_START`, a per-session nonce; X1 (wire), X4a (scanner), H1c (local) |
| G13 | A pod shell has no argv or env control for an rc file, so nothing could put the integration into a remote shell, and `FEATURE_MARKS` assumed it was already there | no such control in `PodExecOptions` [INFERENCE]; Warp's typed bootstrap recurs in its bug list [note] | `Start.integration{mode, consent}`, `Capabilities.integration`, `IntegrationFacts`, `Fact{INTEGRATION_TIER}`; X1 (wire), X4b (the wrapper and the scripts), K2 (declares) |
| G14 | The keepalive of 4.5 covers host to plugin only; nothing reports the plugin-to-target leg, and nothing remote restores the emulator's modes after a session died inside a full-screen program or a range was dropped | client-go pings every 5 s and exposes nothing (`websocket.go:57-65` [read]); Wave, Tabby and kitty write the reset by hand [note] | `Link`, `Capabilities.link_health`, `Ended.mode_reset`, `Dropped.mode_reset`, `ModeReset`; X1, X3a (frames), X4a (exact reset), H1b (forward) |
| G15 | A bounded run could say `truncated` for what policy dropped, but not "the stream ended abnormally, the output may be incomplete"; the drain after the exit has no bound | k/k#142376 (the server closes a stream whose reader is slow, so the tail is lost) and k/k#44371 (a background child holds the pipe) [note] | `OutputCompleteness` on `Ended` and on each stream's `OutputAccount`, `RunLimits.post_exit_drain_ms`; X1, X2b, H-run (the result) |
| G16 | The attach reply carried a start offset and a next offset and nothing else: no size, no modes, no explicit detach, no lease control | VS Code replays `{cols, rows, data}`; Wave's offset has a race [note] | `Opened.replay`, `Detach`, `Detached`, `SessionInfo.lease_expires_unix_ms`; X1, X3c, H1a-2 (local), H1c |
| R16 | **A flaw in my own first version:** it blocked the target's reader on every target. client-go's websocket executor reads all channels in one loop and writes into per-stream pipes that "can block", so a consumer that stops reading stalls the status channel too, and the tail is lost | `websocket.go:310-321` [read]; the server-side close [note] | `Capabilities.stall`; for `LOSSY` the SDK drains into the ring and counts what it overwrites (`EAGER_DRAIN_OVERFLOW`); 4.5; X3a, X2b, K2 |
| H7 | The host drops the legacy frame's `seq`, so no event carries a position | no `Seq` is read in `backend/pkg/plugin/exec` outside tests [ran: a grep at host `origin/main` 77ce06f8] | H1a-1 adds `offset` and `seq` to the output event and forwards the legacy value; H1a-2 fills the local provider's offsets exactly; H1b from `Output.offset` |
| K1 | The `IsUpgradeFailure` type break of client-go 0.37 | plugin `go.mod` at `origin/main` and `origin/feature/ui-next`: client-go and streaming v0.37.2, and both `NewFallbackExecutor` calls already pass `k8s.io/streaming/pkg/httpstream.IsUpgradeFailure` (`register.go:258`, `pod_exec_action.go:221`) [read, ran]; the study's "the plugin is on 0.35" does not hold for these refs | not a defect today; K1b and K2 add a forced-upgrade-failure test and a `depguard` rule so that a bump or a copy cannot regress it |
| K2 | The plugin classifies by text and has no `errors.As` in its exec path | `register.go:253-255,266-347` [read] | `errors.As` on `*StatusError`, `CodeExitError` and `UpgradeFailureError` before any text match; K1b, K2 |

**Where the five pitfalls land.** (1) The shell-start contract (a login shell started twice, the PATH order) is the host's, in `internal/shellenv`; the plan only makes sure X5's helper does not copy it. (2) Hidden-tab flow control: the SDK half is 4.5 (offsets, `ReadOutput`, a `LOSSY` target drained into the ring); the UI half is the terminal bar's. (3) xterm.js 6.0.0 paste, IME and WebGL: UI only, nothing here. (4) Reload and reattach on a ring without offset, modes or size: the atomic attach reply (X3c, X4a, H1a-2, H1c). (5) Integration meets `TERM_PROGRAM`, copyleft scripts and the pod lane: clean-room scripts, two trust tiers, a tier shown per terminal, and the pod bootstrap (X4a, X4b).

**Rejected, each with its reason.**
- **A producer-vouched mark level** (a third `MarkTrust`). Nothing in this plan produces one: the producer's own facts (`Ended`, a run's result, `Fact`) are typed fields, not marks, and a mark that the producer's own integration script vouches for is exactly the nonce case. The enum is extensible and a consumer reads an unknown value as `UNVERIFIED`; add `PRODUCER` together with its first producer.
- **`resume_hint`** on the end. It is derivable: after `Lost` or `Closed` a Restart is offered from `facts.target` and `facts.program`; after `Failed{TARGET_GONE}` or `Failed{TARGET_DENIED}` it is not. A field that restates two others can disagree with them. The retry hazard is a rule instead: a run that ended `LOST`, or whose `remote_may_survive` is true, is never retried by the host on its own (4.6, H-run).
- **A helper binary in the pod** (iTerm2's conductor, Wave's job manager). It needs a file-transfer path, a version handshake and a consent flow, none of which exists; the argv wrapper is the cheapest path that never types into the user's tty. Revisit together with a file service.
- **A file service, and a `file_ops` capability for it.** No producer and no consumer in this plan; links degrade to copy-path and URLs. A capability bit for a service that does not exist is a promise without an implementation; both arrive together, additively, later.
- **Wails `GoStream` inside this contract.** It is a transport under `Conn.Events`, not part of the contract; the optional host step H-transport measures it against a decision rule written first.
- **The study's UI-side items** (paste sanitising, IME, the WebGL context, search, accessibility, links, the tab model: ranks 6, 9, 10 and 12, pitfall 3). They need nothing from the SDK; they are the terminal bar's.

## 3. The baseline, measured: what the lane does today, and a model of what the design can do

Method. Three scratch harnesses (kept in `SDK2-exec-lane-assets/`, never committed; none changes product code):
- **SDK harness** (`zz_baseline_test.go.txt`, plugin-sdk `pkg/v1/exec/`): the real `exec.Manager` with a real pty behind a real gRPC server on a unix socket (go-plugin's transport; TCP loopback too), the real `PluginClient` the host dispenses, and a handler that bridges the pty slave the way an executor does (writes of 4 or 32 KiB for a flood; read-then-write for an echo, a "remote" with zero latency).
- **Host harness** (`host_zz_baseline_test.go.txt`, host `backend/pkg/plugin/exec/`): the same SDK behind the host's real exec controller (`OnPluginStart`, the forwarding goroutine, `outputMux`, `runMux`, `dispatchOutput`), the Wails emitter replaced by a recorder with a configurable cost per event. It leaves out Wails' own JSON, base64 and socket cost, which T1.md measured for the local shell (12-20 MB/s, 15,000 to 25,000 events/s; the page's own floor 15,000-23,000 events/s).
- **Ceiling and model** (`zz_baseline_test.go.txt` `TestBaselineCeiling`, `zz_model_test.go.txt`): a bare gRPC stream of the same generated messages; and a model of the proposed data plane (one gRPC stream per session, the author writing into an SDK-owned bounded byte queue, an output pump that sends whatever is queued, HTTP/2 flow control the only backpressure; no pty, no ring, no marks).
Machines: macOS (Apple M5 Max, 18 cores, macOS 27.0.1, Go 1.27.4; load average 2 to 16 during the runs, so ranges are given) and Linux arm64 (Docker Desktop linuxkit VM, kernel 7.0.14, 18 vCPU with `--cpus=8`, `golang:1.27.4-bookworm`, CGO off). Not run: Windows; a real cluster; the Wails transport; the native window. Raw output: `baseline-sdk-macos.txt`, `baseline-sdk-linux-arm64.txt`, `baseline-host-controller-macos.txt`, `model-newlane-macos.txt`, `model-newlane-linux-arm64.txt`.

### 3.1 Flood (64 MiB written into the handler's tty as fast as the pipeline accepts)

| | macOS | Linux arm64 |
|---|---|---|
| bytes per frame (pty read size) | 1,024 | 4,081 |
| frames for 64 MiB | 65,500 | 16,440 |
| MB/s through SDK + gRPC | **10 to 35**: CPU-bound, so it follows the machine's load (10-14 at load average 9, 15-17 at 5-8, 24-35 at 2-5; **28.7 through the host controller at load 2**) | **23 to 27** |
| CPU per MB | **230-395 ms** | **89-107 ms** |
| bytes allocated per byte delivered | **991-1,001** | **250** |
| a bare gRPC stream on the same machine (ceiling) | 670-1,219 MB/s, 2-5 ms/MB | 713-1,874 MB/s, 2-3 ms/MB |
| the model of the new data plane (256 MiB, 64 KiB frames) | **794-906 MB/s**, 2-3 ms/MB, 1.3-1.4 B/B | **2,971-3,218 MB/s**, 1 ms/MB |

The lane runs at 1 to 5% of the transport's ceiling. The cause is inside the SDK, not gRPC: the output buffer's `Append` allocates a fresh 1,000,000-byte slice and copies the old tail into it for every chunk once the buffer is full (`buffer.go:36-64`): 65,500 chunks times 1 MB is the 66 GB the macOS run allocated for 67 MB of payload.

### 3.2 Keystroke echo (one byte, one session, round trip, p50 / p95)

| Path | macOS | Linux arm64 |
|---|---|---|
| SDK + gRPC unix socket, idle | 36-38 µs / 53-65 µs | 70-89 µs / 116-164 µs |
| the same, typed (5 ms gap) | 59-127 µs / 95-230 µs | 154-184 µs / 318-351 µs |
| SDK + gRPC + the host controller (Emit = recorder) | **37 µs / 61 µs** (p99 86) | not run |
| the model | 17 µs / 44 µs | 6 µs / 31 µs |
| bare gRPC stream | 14-18 µs / 22-34 µs | 6-8 µs / 30-76 µs |

**The echo is not the problem.** The pty hop costs about 20 µs. T1.md's whole-host numbers (0.7 to 2 ms through Wails and a browser) are the transport and the page, which no SDK change touches.

### 3.3 Isolation: what one session does to another

| Case | macOS | Linux arm64 | Model |
|---|---|---|---|
| another session floods, the consumer keeps up | echo p95 232-492 µs | p95 534-583 µs | p95 262 µs |
| the consumer of the shared stream costs 25 µs a flood frame (the SDK-level shared consumer) | p50 200 µs, **p95 15 ms** (the consumer is near its capacity) | p95 786 µs | n/a: a stream per session |
| the same at 100 µs a frame | **p50 431 ms** | **p50 469 ms** | p95 206 µs even when the flood's consumer sleeps 5 ms a frame |
| host controller with Emit at 50 µs an event | **p50 233 ms** (flood 18 MB/s, 18,000 events/s) | not run | |
| host controller with Emit at 100 µs an event | **p50 443 ms** | not run | |
| 6 resizes of a session whose handler does not drain | another session's echo **p99 460 ms, max 461 ms** | p99 456 ms, max 501 ms | no stall (resize is a frame of its own session) |
| a 1 MiB paste into a session whose remote stopped reading | another session's keystroke **not accepted in 3 s (unbounded)** | same | p95 107 µs |

The mechanism of the 233-469 ms: the SDK's output channel holds 4,096 frames and the host's single `outputMux` and `runMux` serve all sessions, so a frame of a quiet session waits behind up to 4,096 frames of a loud one, times the consumer's cost per frame (4,096 x 57 µs = 233 ms). T1.md measured the host's real per-event cost for the local shell at about 40-65 µs (15,000-25,000 events/s for 12-20 MB/s), which is where the cliff starts.

### 3.4 Correctness under the same harness

| Case | macOS | Linux arm64 |
|---|---|---|
| a second `Stream()` after the first ended: bytes of an 8 MiB flood delivered | 49.9% | 50.5% |
| the end of a stream by `CloseSend`: sessions still running of 100 | **100** | **100** |
| the end of a stream by cancel: sessions still running of 100 | 0 | 0 |
| 64 KiB written, the handler reports its end at once: runs of 60 that lost bytes | 22 (375 B a run on average) | **54** (5,249 B a run) |
| 256 KiB, the same | 12 (204 B) | 48 (4,710 B) |
| 2 KiB, the same: runs that ended **before** the attach (NOT_FOUND, everything lost) | **51** of 60 | **47** of 60 |
| the same three with a 100 ms pause before the end report | 0 lost | 0 lost (so the cause is the race between the end and the drain) |

### 3.5 What the baseline says

1. Latency is fine; **throughput, CPU, isolation and three correctness classes are not**, and all five are properties of the mechanism (a shared stream, a pty hop, a ring that is not one, a close that does not drain, an attach step), not of any one plugin.
2. Bare gRPC and the model show the ceiling is two orders of magnitude above the lane. A design that deletes the mechanism does not need tuning.
3. The host's half (the single FIFO, the inline Emit) is real and is H1 in 2.6; with a stream per session it has nothing to queue behind.
4. After the lane is fast, the page's event rate is the next limit (T1.md: 15,000-25,000 events/s through the host, 15,000-23,000 in the page). A 64 KiB frame instead of a 1 KiB one is 64 times fewer events for the same bytes.

### 3.6 The proofs later steps run against these numbers (same harnesses, same machines; "flood" is 64 MiB unless said)

| Proof | Baseline | Threshold |
|---|---|---|
| flood throughput, SDK + gRPC, unix | 10-35 (macOS), 23-27 (Linux) MB/s | **>= 300 MB/s on both** (about a third of the macOS model, at least 10x the baseline) |
| frames for the flood | 65,500 / 16,440 | <= 4,100 (average >= 16 KiB) |
| CPU per MB | 230-395 / 89-107 ms | <= 15 ms |
| bytes allocated per byte | ~1,000 / 250 | <= 4 |
| echo idle, p95 | 53-65 / 116-164 µs | <= 150 / 250 µs (no regression against the model's 44 / 31) |
| echo while another session floods and its consumer costs 100 µs a frame | p50 431-469 ms | **p95 <= 2 ms** |
| echo while another session is pasted into and its author never reads | not accepted in 3 s | **p95 <= 2 ms** |
| six resizes of a session that does not drain | p99 456-460 ms | p99 <= 2 ms; each resize acknowledged or typed-ignored |
| tail after a 64 KiB command that ends at once | 22-54 of 60 lose bytes | **0 of 1,000** |
| a 2 KiB command that ends at once | 47-51 of 60 gone before attach | **0 of 1,000** (no attach step exists) |
| host events per second for the same flood (host step) | 65,500 events | <= 4,100 events |
| cancel of a run at its timeout | n/a | returns within timeout + 100 ms; remote-may-survive stated |

## 4. The target design: one lane, two shapes, one author function

### 4.1 The rules the design obeys

1. **A fact is stated once, typed, by the party that knows it.** An absent fact is `unknown`; a consumer shows nothing for it and never reconstructs it (SDK0 rule 2, the owner's rule).
2. **The author writes what is specific to the target** (open a stream to it, map its errors); the SDK owns what is the same for every plugin: sessions, ordering, backpressure, resize, replay, lease, teardown, bounds, typed errors, telemetry.
3. **A capability is declared, not guessed.** `Describe` declares it per target kind, `Opened` restates what this session got.
4. **No unbounded buffer, no unbounded wait, no silent drop.** Every bound is declared; every drop is counted and reported.
5. **Classes and facts cross the trust boundary, never free text.** The host writes the words (B-97).
6. **Safe by construction for a run:** argv only, time and size bounds mandatory, deny by default at the host.
7. **A session is a state machine with exactly one end,** and the end is the last thing it sends (4.7).
8. **One suite proves every provider:** the plugin engine, the host's local terminal and the host's legacy adapter pass the same cases (4.8).

### 4.2 What the author writes and what the SDK owns

| | The author | The SDK |
|---|---|---|
| Target | `Target{Plugin, Resource, Info, Exec, Options?, Classify?}` | routing, admission of the canonical reference and route against the registered type and the caller's connection, the connection lease |
| Running a command | `ExecFunc(ctx, *Proc) (Exit, error)`: copy between `p.Stdin`/`p.Stdout`/`p.Stderr` and the target, return the exit | the stdio queues (bounded, blocking), frames, coalescing, offsets, the replay ring, input ordering, EOF, flow control, resize (latest wins, acknowledged), signals, detach and lease, keepalive, `Started` and `Ended`, the typed End, cancellation and kill, the single end |
| Errors | map the target's own failure to `Error{Class, Reason, Facts}` in `Classify` | the vocabulary, the bounds, never sending raw text, the public-message gate, the in-stream and the RPC encodings |
| A run | nothing | `Run` and `RunStream`: capture with head and tail, counts, timeout, limits, concurrency, typed outcome and refusals |
| Container choices | `Options(ref)` returns the choices with a state and a default | the RPC, the bounds, the typed shape |
| Telemetry | nothing | session span and log fields, diagnostics metrics (sessions, bytes, drops, stalls) through the existing lifecycle diagnostics channel |
| Tests | `exectest.Conformance(t, target)` over the real engine and the real transport | the suite, the fake target, the stress harness |

### 4.3 The wire: `proto/exec/v2/exec.proto`, package `omniview.sdk.exec.v2`

A new service on the existing go-plugin capability `exec` (the same `Plugin.GRPCServer` registers both services; a plugin that serves only the legacy service answers `Unimplemented`). Requests are **strict** (an unknown field is `UNSUPPORTED`, as on the resource lane, because a request field can change what a command may do); frames are **lenient** (an unknown frame kind is ignored and counted). A request field that an older plugin may not know is sent only after `Describe` lists the feature that gates it, so strictness never breaks a pairing.

```proto
syntax = "proto3";
package omniview.sdk.exec.v2;
option go_package = "github.com/omniviewdev/plugin-sdk/proto/exec/v2;execv2";
import "proto/resource/v2/domain.proto";

service Exec {
  rpc Describe(DescribeRequest) returns (DescribeResponse);              // what this plugin can run commands in
  rpc Options(OptionsRequest) returns (OptionsResponse);                 // what a user can choose for one resource (containers), with state
  rpc Open(stream ClientFrame) returns (stream ServerFrame);             // ONE interactive session = ONE stream; first frame opens or attaches, last frame ends or detaches
  rpc Run(RunRequest) returns (RunResult);                               // one bounded command, one answer
  rpc RunStream(RunRequest) returns (stream RunEvent);                   // the same, with its output as it happens; cancel = cancel the call
  rpc ListSessions(ListSessionsRequest) returns (ListSessionsResponse);  // including recently ended ones (tombstones)
  rpc ReadOutput(ReadOutputRequest) returns (ReadOutputResponse);        // cursor read of the replay ring
  rpc EndSession(EndSessionRequest) returns (EndSessionResponse);        // end a session that has no attached stream
}

// ---------- shared ----------
message Size { uint32 cols = 1; uint32 rows = 2; }
message Target {
  omniview.resource.v2.ResourceReference reference = 1;  // canonical identity, incarnation included
  omniview.resource.v2.AccessRoute route = 2;            // the connection; must be the caller's
  map<string, string> selection = 3;                     // only the choices Options declared ("container": "app")
}
enum Stream { STREAM_UNSPECIFIED = 0; STREAM_TTY = 1; STREAM_STDOUT = 2; STREAM_STDERR = 3; }
enum Signal { SIGNAL_UNSPECIFIED = 0; SIGNAL_INT = 1; SIGNAL_QUIT = 2; SIGNAL_TERM = 3; SIGNAL_KILL = 4; SIGNAL_HUP = 5; SIGNAL_USR1 = 6; SIGNAL_USR2 = 7; }
enum FactMode { FACT_MODE_NONE = 0; FACT_MODE_PULL = 1; FACT_MODE_PUSH = 2; }
enum KillBehavior { KILL_UNSPECIFIED = 0; KILL_TERMINATES = 1; KILL_BEST_EFFORT = 2; KILL_CLOSES_STREAM_ONLY = 3; }  // what ending a session does to the remote process
enum Survival { SURVIVAL_NONE = 0; SURVIVAL_TARGET_PROCESS = 1; SURVIVAL_TARGET_SESSION = 2; }                     // after the host restarts: nothing / the process / process and scrollback
enum ExitReport { EXIT_REPORT_UNSPECIFIED = 0; EXIT_REPORT_NONE = 1; EXIT_REPORT_CODE = 2; EXIT_REPORT_CODE_AND_SIGNAL = 3; }  // what the target can say about how a command ended: nothing (attach), a code (Kubernetes exec), a code and a signal (a pty, ssh)
enum StallBehavior { STALL_UNSPECIFIED = 0; STALL_PROPAGATES = 1; STALL_LOSSY = 2; }  // what a reader that stops reading does to the target: slows the process (pty, ssh), or stalls every channel and loses the tail (Kubernetes, Docker)
enum IntegrationMode { INTEGRATION_MODE_OFF = 0; INTEGRATION_ARGV_WRAPPER = 1; }       // how shell integration reaches a target that has no argv or env control of its shell; a helper binary in the target is not offered
enum Feature { FEATURE_UNSPECIFIED = 0; FEATURE_MARKS = 1; FEATURE_REPLAY = 2; FEATURE_RUN_STREAM = 3; FEATURE_ENV = 4; FEATURE_CWD = 5; FEATURE_STDIN_EOF = 6; FEATURE_MODES = 7; FEATURE_INTEGRATION = 8; }
enum ErrorClass {                                            // the SDK's resource error vocabulary, the closed subset exec uses
  ERROR_CLASS_UNSPECIFIED = 0; ERROR_CLASS_FORBIDDEN = 1; ERROR_CLASS_UNAUTHORIZED = 2; ERROR_CLASS_NOT_FOUND = 3; ERROR_CLASS_CONFLICT = 4;
  ERROR_CLASS_UNAVAILABLE = 5; ERROR_CLASS_CONNECTION = 6; ERROR_CLASS_TIMEOUT = 7; ERROR_CLASS_INVALID_REQUEST = 8; ERROR_CLASS_UNSUPPORTED = 9;
  ERROR_CLASS_LIMIT = 10; ERROR_CLASS_CANCELLED = 11; ERROR_CLASS_INTERNAL = 12;
}
enum Reason {                                                // why, closed; the host words it
  REASON_UNSPECIFIED = 0; REASON_TARGET_DENIED = 1; REASON_TARGET_GONE = 2; REASON_TARGET_REPLACED = 3; REASON_NOT_RUNNING = 4;
  REASON_NO_SUCH_EXECUTABLE = 5; REASON_TTY_UNSUPPORTED = 6; REASON_TOO_MANY_SESSIONS = 7; REASON_TOO_MANY_RUNS = 8;
  REASON_INPUT_TOO_LARGE = 9; REASON_CONNECTION_RETIRED = 10; REASON_SESSION_EXISTS = 11; REASON_SESSION_UNKNOWN = 12;
  REASON_CONSENT_REQUIRED = 13;
}
message ErrorFacts { string program = 1; string selection_name = 2; string selection_value = 3; uint32 retry_after_ms = 4; }  // each <= 256 bytes

message Capabilities {
  bool tty = 1; bool separate_stderr = 2; bool resize = 3; bool initial_size = 4; bool stdin_eof = 5;
  repeated Signal signals = 6;            // the signals Signal() can deliver; empty = Close only
  KillBehavior kill = 7; bool env = 8; bool cwd = 9;
  FactMode cwd_fact = 10; FactMode foreground_fact = 11;
  Survival host_restart = 12;             // the window reload and the host-stream break are always survived while the plugin lives (SessionLimits.detach_timeout_ms)
  ExitReport exit_report = 13;            // a consumer must not expect Signaled from CODE, nor any status from NONE
  StallBehavior stall = 14;               // LOSSY: the SDK drains the target eagerly into the ring and counts what it overwrites, never blocking the target on the host
  bool link_health = 15;                  // the author reports the transport's health through Proc.Link; false = the consumer sees only the gRPC leg's health
  repeated IntegrationMode integration = 16;  // the modes the target accepts; never applied without the host's consent flag
}
message SessionLimits { uint32 max_sessions = 1; uint32 max_input_frame = 2; uint32 replay_bytes = 3; uint32 max_replay_bytes = 4; uint32 detach_timeout_ms = 5; uint32 max_detach_timeout_ms = 6; uint32 max_dimension = 7; }
message RunLimits { uint32 default_timeout_ms = 1; uint32 max_timeout_ms = 2; uint32 default_output_bytes = 3; uint32 max_output_bytes = 4; uint32 max_stdin_bytes = 5; uint32 max_concurrent = 6; uint32 max_argv_bytes = 7; uint32 max_env_bytes = 8; uint32 post_exit_drain_ms = 9; }
message TargetInfo { string provider = 1; string type = 2; string display_name = 3; repeated string default_argv = 4; Capabilities capabilities = 5; SessionLimits session = 6; RunLimits run = 7; }  // absent session = Run only; absent run = sessions only
message DescribeRequest {}
message DescribeResponse { uint32 contract_version = 1; repeated Feature features = 2; repeated TargetInfo targets = 3; }
message OptionsRequest { Target target = 1; }
message Choice { string value = 1; string display_name = 2; ChoiceState state = 3; string detail = 4; bool is_default = 5; string kind = 6; }  // detail and kind: closed codes (^[a-z0-9_.-]{1,40}$), never prose
enum ChoiceState { CHOICE_STATE_UNKNOWN = 0; CHOICE_STATE_READY = 1; CHOICE_STATE_STARTING = 2; CHOICE_STATE_STOPPED = 3; }
message Option { string name = 1; repeated Choice choices = 2; bool required = 3; }       // name is the selection key ("container")
message OptionsResponse { repeated Option options = 1; int64 observed_at_unix_ms = 2; }

// ---------- (A) the interactive session ----------
message IntegrationRequest { IntegrationMode mode = 1; bool consent = 2; }  // consent: the host asserts the user agreed to send bootstrap code to this target; any mode but OFF without it is INVALID_REQUEST / CONSENT_REQUIRED
message Start {
  Target target = 1;
  repeated string argv = 2;               // empty = the target's default; never a shell string
  bool tty = 3;
  Size size = 4;                          // initial size; with tty, zero means 80 x 24 and the facts say so
  map<string, string> env = 5;            // only if capabilities.env; names only in any audit
  string cwd = 6;                         // only if capabilities.cwd
  map<string, string> labels = 7;         // opaque, bounded; never authority
  uint32 detach_timeout_ms = 8;           // the lease: 0 = the target's default; <= max_detach_timeout_ms
  uint32 replay_bytes = 9;                // 0 = the default; <= max_replay_bytes
  repeated Feature features = 10;         // FEATURE_MARKS: typed Mark frames from OSC 133/633/7, bytes untouched; FEATURE_MODES: terminal-mode tracking for the attach reply
  IntegrationRequest integration = 11;    // only if Describe lists FEATURE_INTEGRATION and the target lists the mode; default OFF
}
message Attach { string session_id = 1; uint64 from_offset = 2; }   // take over a session (the older stream, if any, ends "superseded")
message OpenRequest { string session_id = 1; oneof kind { Start start = 2; Attach attach = 3; } }  // session_id: client-chosen, <= 128 bytes, in use = CONFLICT/SESSION_EXISTS

message ClientFrame {
  oneof frame {
    OpenRequest open = 1;                 // the first frame, once
    bytes input = 2;                      // <= max_input_frame; ordered with every other client frame
    Resize resize = 3;
    Signal signal = 4;                    // only a signal capabilities.signals lists
    CloseInput close_input = 5;           // stdin EOF
    Query query = 6;                      // pull a fact
    Close close = 7;                      // DESTROY the session
    Detach detach = 8;                    // leave the session running and end THIS stream; a stream that just breaks is an implicit Detach
  }
}
message Resize { uint32 seq = 1; Size size = 2; }
message CloseInput {}
enum CloseMode { CLOSE_MODE_GRACEFUL = 0; CLOSE_MODE_KILL = 1; }
message Close { CloseMode mode = 1; }
message Detach { uint32 lease_ms = 1; }   // 0 = the session's detach_timeout_ms; above max_detach_timeout_ms is clamped and Detached says what was applied
enum FactKind { FACT_KIND_UNSPECIFIED = 0; FACT_KIND_FOREGROUND = 1; FACT_KIND_CWD = 2; FACT_KIND_INTEGRATION_TIER = 3; }
message Query { uint32 id = 1; FactKind kind = 2; }

message ServerFrame {
  oneof frame {
    Opened opened = 1;                    // always first
    Output output = 2;
    Resized resized = 3;
    Mark mark = 4;
    Fact fact = 5;
    Dropped dropped = 6;
    Notice notice = 7;
    Ended ended = 8;                      // the session is over; nothing follows it; the stream then ends with status OK
    Started started = 9;                  // the target says the command is running: the facts refined by what the producer knows now
    Link link = 10;                       // the transport's health changed (only if capabilities.link_health)
    Detached detached = 11;               // the answer to Detach, the last frame of THIS stream; the session lives on
  }
}
// The attach reply is atomic: `replay` describes exactly the bytes that follow as Output frames [start, end), and the live stream continues at `end`
// with no byte lost or repeated (the SDK takes the ring snapshot and registers the stream under one lock). A new session has start = end = 0.
message Opened { SessionFacts facts = 1; Replay replay = 2; }
message Started { SessionFacts facts = 1; }  // sent when the author calls Started (program resolved, pid, tty and size really granted, this session's kill behaviour); a session whose author never calls it gets none
message Detached { int64 lease_expires_unix_ms = 1; }
message TargetFacts { string provider = 1; string type = 2; string id = 3; string display_name = 4; map<string, string> selection = 5; }
message Program { repeated string argv = 1; string name = 2; string path = 3; }   // what runs as the producer knows it (the default shell resolved), not what was asked
enum IntegrationTier { INTEGRATION_TIER_UNSPECIFIED = 0; INTEGRATION_TIER_NONE = 1; INTEGRATION_TIER_BASIC = 2; INTEGRATION_TIER_RICH = 3; }  // OBSERVED, not promised: none = no marks seen, basic = prompt only, rich = prompt, input, start and end with the nonce
message IntegrationFacts {
  IntegrationMode mode = 1;               // what was applied, never more than asked
  string nonce = 2;                       // SECRET: the per-session value the integration script echoes inside its marks; for the host and the UI to verify marks parsed from bytes; never logged, audited, put in a span or shown to a model
}
message SessionFacts {
  string session_id = 1; TargetFacts target = 2; Program program = 3;
  bool tty = 4; Size size = 5;            // granted; the size applied at start (zero: not applied)
  Capabilities capabilities = 6; SessionLimits limits = 7;
  int64 created_at_unix_ms = 8; uint32 pid = 9;     // pid: when the producer has one (a local process), else 0
  bool attached_existing = 10;
  string transport = 12;                  // closed code of the channel to the target ("k8s-ws-v5", "k8s-spdy", "local-pty"); "" = unknown
  string term = 13;                       // the TERM the target really applied; "" = unknown
  IntegrationFacts integration = 14;
}
message TerminalModes {
  bool known = 1;                         // false: not tracked (FEATURE_MODES not requested); every other field is then meaningless
  bool alt_screen = 2; bool bracketed_paste = 3; bool application_cursor = 4; bool focus_events = 5; bool cursor_hidden = 6;
  uint32 mouse_tracking = 7;              // bit set: 1 = click (?9, ?1000), 2 = drag (?1002), 4 = any motion (?1003)
  uint32 mouse_encoding = 8;              // 0 = X10, 1 = UTF-8 (?1005), 2 = SGR (?1006), 3 = urxvt (?1015)
  repeated uint32 kitty_keyboard = 9;     // the flag stack, bottom first, at most 16 entries
}
message Replay {
  uint64 start = 1;                       // offset of the first replayed byte: a ground-state boundary (not inside an escape sequence or a UTF-8 sequence); start > from_offset means bytes were dropped in between
  uint64 end = 2;                         // the live stream continues here
  uint64 bytes = 3;                       // end - start
  Size start_size = 4;                    // the size the bytes at `start` were produced for: the emulator replays at this size, then resizes
  TerminalModes start_modes = 5;          // the modes in force at `start`
  Size size = 6;                          // the size now
  TerminalModes modes = 7;                // the modes now
}
message Output { Stream stream = 1; uint64 offset = 2; bytes data = 3; }   // offset: position of data[0] in the session's single output sequence (all streams, arrival order)
enum ResizeResult { RESIZE_RESULT_APPLIED = 0; RESIZE_RESULT_IGNORED = 1; RESIZE_RESULT_FAILED = 2; }
message Resized { uint32 seq = 1; Size size = 2; ResizeResult result = 3; }
enum MarkKind { MARK_KIND_UNSPECIFIED = 0; MARK_PROMPT_START = 1; MARK_INPUT_START = 2; MARK_COMMAND_START = 3; MARK_COMMAND_END = 4; MARK_CWD = 5; }
enum MarkTrust { MARK_TRUST_UNVERIFIED = 0; MARK_TRUST_NONCE = 1; }   // unknown values read as UNVERIFIED; a producer-vouched level is added with its first producer
message Mark {
  MarkKind kind = 1; uint64 at_offset = 2;
  optional int32 exit_code = 3; string cwd = 4;
  string command_id = 5;                  // SDK-assigned, unique and monotonic in the session; the same id on the prompt, input, start and end marks of one command
  string command_line = 6;                // unescaped, <= 4 KiB, only with trust NONCE; content: never logged, audited or put in a model prompt without a gate
  MarkTrust trust = 7;
  uint64 duration_ms = 8;                 // on COMMAND_END: between the start and end marks, by the SDK's monotonic clock
  bool redraw = 9;                        // the prompt is redrawn (a resize), not a new prompt
}
enum ForegroundState { FOREGROUND_UNKNOWN = 0; FOREGROUND_IDLE = 1; FOREGROUND_BUSY = 2; }
enum UnknownReason { UNKNOWN_REASON_UNSPECIFIED = 0; UNKNOWN_UNSUPPORTED = 1; UNKNOWN_QUERY_FAILED = 2; UNKNOWN_REMOTE = 3; }
message Foreground { ForegroundState state = 1; string name = 2; uint32 pgid = 3; UnknownReason reason = 4; }
message Directory { string path = 1; UnknownReason reason = 2; }
message Fact { uint32 query_id = 1; FactKind kind = 2; oneof value { Foreground foreground = 3; Directory cwd = 4; IntegrationTier tier = 5; } }   // query_id 0 = pushed
enum DropReason { DROP_REASON_UNSPECIFIED = 0; DROP_REPLAY_FULL = 1; DROP_DETACHED_OVERFLOW = 2; DROP_EAGER_DRAIN_OVERFLOW = 3; }
message Dropped { Stream stream = 1; uint64 from_offset = 2; uint64 bytes = 3; DropReason reason = 4; bytes mode_reset = 5; }   // mode_reset: bytes for the UI's emulator (never the target) because a dropped range may hold a mode change
enum NoticeKind { NOTICE_KIND_UNSPECIFIED = 0; NOTICE_ENV_IGNORED = 1; NOTICE_CWD_IGNORED = 2; NOTICE_FEATURE_IGNORED = 3; NOTICE_SIZE_DEFAULTED = 4; NOTICE_INTEGRATION_IGNORED = 5; }
message Notice { NoticeKind kind = 1; }
enum ClosedBy {
  CLOSED_BY_REQUEST = 0; CLOSED_BY_PLUGIN_SHUTDOWN = 1; CLOSED_BY_DETACH_TIMEOUT = 2; CLOSED_BY_IDLE_TIMEOUT = 3;
  CLOSED_BY_SUPERSEDED = 4; CLOSED_BY_CONNECTION_RETIRED = 5; CLOSED_BY_RUN_TIMEOUT = 6; CLOSED_BY_CANCELLED = 7;
}
enum FailureStage { FAILURE_STAGE_UNSPECIFIED = 0; FAILURE_START = 1; FAILURE_RUN = 2; FAILURE_STREAM = 3; }
enum ExitSource {
  EXIT_SOURCE_UNSPECIFIED = 0;
  EXIT_SOURCE_PROCESS = 1;                // the target relayed the process's own status (a Kubernetes error-channel Status, ssh exit-status, Docker ExecInspect, a local wait status)
  EXIT_SOURCE_SIGNAL_FOLDED = 2;          // a death by signal the target folded into 128+n: exit_code is 128+n and the SDK claims no signal
  EXIT_SOURCE_TRANSPORT = 3;              // the transport said the stream ended OK or failed; the process's own status was not relayed (Kubernetes attach, or exec with an empty error channel); a code, if any, is not the command's
  EXIT_SOURCE_HOST = 4;                   // a bounded run we ended (timeout, cancel): a code, if any, is the aftermath of our kill
}
enum LostCause { LOST_CAUSE_UNSPECIFIED = 0; LOST_NO_STATUS = 1; LOST_LINK_DEAD = 2; }
enum OutputCompleteness { OUTPUT_COMPLETENESS_UNKNOWN = 0; OUTPUT_COMPLETE = 1; OUTPUT_TRUNCATED = 2; }   // UNKNOWN is the zero value: never read as complete
message Exited { int32 exit_code = 1; ExitSource source = 2; }
message Signaled { string signal = 1; int32 signal_number = 2; bool core_dumped = 3; ExitSource source = 4; }
message Closed { ClosedBy by = 1; }
message Failed { ErrorClass class = 1; Reason reason = 2; ErrorFacts facts = 3; FailureStage stage = 4; string public_message = 5; }  // public_message: <= 512 bytes, UTF-8, reviewed classes only
message Lost { LostCause cause = 1; }     // the connection to the target ended with no terminal status: the process may be running, may have exited with any code, may have been killed. Never exit 0.
message End { oneof kind { Exited exited = 1; Signaled signaled = 2; Closed closed = 3; Failed failed = 4; Lost lost = 6; } bool remote_may_survive = 5; }
message Ended {
  End end = 1; bool started = 2; uint64 duration_ms = 3; uint64 bytes_out = 4; uint64 bytes_in = 5; uint64 dropped_bytes = 6;
  OutputCompleteness output = 7;          // COMPLETE only when every byte the command wrote was read and delivered; TRUNCATED when the ring overwrote counted bytes; UNKNOWN when the SDK cannot prove it
  uint64 last_offset = 8;                 // one past the last output byte
  bytes mode_reset = 9;                   // for the UI's emulator (never the target): restores the input modes (alt screen, mouse, bracketed paste, application cursor, kitty stack); exact with FEATURE_MODES, the fixed full reset otherwise; empty without a tty
}
enum LinkState { LINK_STATE_UNSPECIFIED = 0; LINK_GOOD = 1; LINK_DEGRADED = 2; LINK_STALLED = 3; }
message Link { LinkState state = 1; uint32 silent_ms = 2; }   // sent on a change, not on a timer

// ---------- sessions, replay ----------
message SessionInfo { SessionFacts facts = 1; bool attached = 2; bool ended = 3; Ended ended_with = 4; uint64 next_offset = 5; uint64 replay_start = 6; int64 last_activity_unix_ms = 7; LinkState link = 8; int64 lease_expires_unix_ms = 9; }
message ListSessionsRequest {}
message ListSessionsResponse { repeated SessionInfo sessions = 1; }
message ReadOutputRequest { string session_id = 1; uint64 from_offset = 2; uint32 max_bytes = 3; }
message ReadOutputResponse { repeated Output chunks = 1; uint64 replay_start = 2; uint64 next_offset = 3; bool ended = 4; }
message EndSessionRequest { string session_id = 1; CloseMode mode = 2; }
message EndSessionResponse {}

// ---------- (B) the bounded run ----------
enum TruncatePolicy { TRUNCATE_HEAD_TAIL = 0; TRUNCATE_HEAD = 1; TRUNCATE_TAIL = 2; }
message OutputLimits { uint32 max_stdout_bytes = 1; uint32 max_stderr_bytes = 2; TruncatePolicy policy = 3; }   // 0 = the target's default; above the maximum = INVALID_REQUEST, never silently clamped
message RunRequest {
  string request_id = 1;                  // correlation for the host's audit; echoed
  Target target = 2;
  repeated string argv = 3;               // REQUIRED, argv[0] non-empty; there is no command-string field
  bytes stdin = 4;                        // <= max_stdin_bytes
  map<string, string> env = 5; string cwd = 6;
  uint32 timeout_ms = 7;                  // 0 = the target's default; above the maximum = INVALID_REQUEST
  OutputLimits output = 8;
  map<string, string> labels = 9;
}
enum Outcome { OUTCOME_UNSPECIFIED = 0; OUTCOME_EXITED = 1; OUTCOME_SIGNALED = 2; OUTCOME_TIMED_OUT = 3; OUTCOME_CANCELLED = 4; OUTCOME_LOST = 5; }   // a refusal is the RPC's typed status, not an outcome; LOST: no terminal status, the command may have run
message OutputAccount {
  uint64 total_bytes = 1; uint64 kept_bytes = 2; uint64 dropped_bytes = 3; bool truncated = 4; uint32 head_bytes = 5; uint32 tail_bytes = 6; bool valid_utf8 = 7;
  OutputCompleteness completeness = 8;    // COMPLETE: read to end of stream, kept + dropped == total, nothing lost in transit; TRUNCATED: policy dropped counted bytes; UNKNOWN: the stream ended abnormally, or the post-exit drain hit its bound (total_bytes is then what arrived)
}
message RunResult {
  string request_id = 1; Outcome outcome = 2;
  optional int32 exit_code = 3; string signal = 4; int32 signal_number = 5;
  bytes stdout = 6; bytes stderr = 7;     // raw bytes; the middle is elided under HEAD_TAIL and counted in the account
  OutputAccount stdout_account = 8; OutputAccount stderr_account = 9;
  uint64 duration_ms = 10; bool started = 11; bool remote_may_survive = 12;
  TargetFacts target = 13; Program program = 14;
  ExitSource exit_source = 15;            // whose status exit_code is; HOST for TIMED_OUT and CANCELLED
}
message RunEvent { oneof event { RunStarted started = 1; Output output = 2; RunProgress progress = 3; RunEnded ended = 4; } }
message RunStarted { TargetFacts target = 1; Program program = 2; }
message RunProgress { uint64 elapsed_ms = 1; uint64 bytes_out = 2; }
message RunEnded { RunResult result = 1; }   // the result without the payloads (they were streamed); counts and flags only
```

A refusal before the command starts (`Open` and `Run`) is the RPC's gRPC status with `ErrorInfo` (class as reason, the domain `omniview.sdk.exec.v2`, the facts as metadata, bounded as in SDK0 S2) and, for a reviewed class, the bounded `LocalizedMessage` of #79. A failure after the start is `Failed` in `Ended`.

**Checked [ran]:** the text above (as revised in the second pass), saved as `SDK2-exec-lane-assets/exec_v2.proto.txt` and identical to it, is accepted by `buf build` against the SDK's own `proto/resource/v2/domain.proto` (a throwaway copy under `proto/exec/v2/`, removed afterwards), and the three Go blocks of 4.4 parse (`gofmt -e`; the registration statement of the second block is wrapped in a function for the check, as it is a statement and not a declaration). `buf lint` with default rules reports naming and layout only (enum value prefixes and `_UNSPECIFIED` zero values, service and RPC message names including one request type shared by `Run` and `RunStream`, the `proto/` directory layout), as it does for the legacy `exec.proto`; X1 renames to the lint rules before the descriptor digest freezes the file (a zero value such as `FACT_MODE_NONE` becomes `FACT_MODE_UNSPECIFIED` and is read as none).

### 4.4 The Go author API (`pkg/v1/exec`, new files; names chosen not to collide with the legacy ones that live until the flip)

```go
// Registration: PluginOpts gains Targets; Handlers is the legacy field and is deleted at the flip.
type PluginOpts struct {
	Handlers []Handler // legacy
	Targets  []Target
}

// A Target is one kind of thing a command can run in: a Pod, a container, a host, a VM.
type Target struct {
	Plugin, Resource string       // routing key, as Handler's: Plugin + "/" + Resource ("k8s:/pods")
	Info             TargetInfo   // static: capabilities, defaults, limits
	Exec             ExecFunc     // required
	Options          OptionsFunc  // optional: what a user can choose for one resource, with state
	Classify         ClassifyFunc // optional: map this target's own errors to a class and reason
}

// ExecFunc runs one command in the target and returns when it has ended. It must honor ctx: the SDK cancels it
// to close, kill, time out, retire the connection or shut the plugin down. Return (Exit, nil) when the command
// ended, whatever its status; return a non-nil error when the command could not run or the target failed.
type ExecFunc func(ctx context.Context, p *Proc) (Exit, error)
type OptionsFunc func(ctx *types.PluginContext, ref resourcev2.ResourceReference) ([]Option, error)
type ClassifyFunc func(err error) (*Error, bool) // false: not this target's error; the SDK classifies context, net and gRPC errors itself

// Proc is the command's world, owned by the SDK.
type Proc struct {
	Context *types.PluginContext // admitted and connection-bound
	Request Request
	Stdin   io.Reader   // nil when the request has no stdin; EOF after CloseInput or when the session ends
	Stdout  io.Writer   // the only output for a TTY; with Capabilities.Stall = Propagates, Write blocks while the host is slow (backpressure reaches the target); with Lossy it is never blocked for more than 50 ms and the SDK counts what it overwrites; it fails once the session ended
	Stderr  io.Writer   // nil for a TTY
	Resize  <-chan Size // latest wins, never blocks the SDK; the first value is Request.Size for a TTY; closed at the end
	Started func(Started) // never nil; call it once, when the command is running (program resolved, pid, tty granted, size applied, kill behaviour)
	Link    func(LinkState) // never nil; report a change of the transport's health (only if Capabilities.LinkHealth); the SDK sends a Link frame on a change
}

type Request struct {
	Ref       resourcev2.ResourceReference // validated: provider, type, route and connection match; incarnation present when the host sent one
	Selection map[string]string            // exactly the choices Options declared
	Argv      []string                     // never empty: TargetInfo.DefaultArgv is filled in
	TTY       bool
	Size      Size
	Env       map[string]string // only if Capabilities.Env
	Cwd       string            // only if Capabilities.Cwd
	Labels    map[string]string
}

type Size struct{ Cols, Rows uint16 }
type Exit struct {
	Code         *int       // the status the target reported
	Signal       string     // a signal the target reported (only if Capabilities.ExitReport is CodeAndSignal)
	SignalNumber int
	Source       ExitSource // whose status this is; the zero value is SourceProcess
	Lost         LostCause  // non-zero: the stream ended with no terminal status; Code and Signal are then ignored
}
func ExitCode(n int) Exit                     // the process's own status, relayed by the target (SourceProcess)
func ExitSignal(name string, number int) Exit // killed by a signal the target reported (SourceProcess)
func ExitFolded(n int) Exit                   // a code the target folded from a death by signal, 128+n (SourceSignalFolded): the SDK claims no signal
func ExitTransport(n int) Exit                // the transport said the stream ended; the process's own status was not relayed (SourceTransport)
func ExitLost(cause LostCause) Exit           // the process's fate is unknown: never exit 0

type ExitSource int      // SourceProcess (zero), SourceSignalFolded, SourceTransport; the SDK sets SourceHost itself for a bounded run it ended
type LostCause int       // LostNoStatus, LostLinkDead
type LinkState int       // LinkGood, LinkDegraded, LinkStalled
type IntegrationMode int // IntegrationOff, IntegrationArgvWrapper

// Error is what the author returns when it knows why. Err stays local (logged, never sent).
type Error struct { Class ErrorClass; Reason Reason; Facts ErrorFacts; Message string; Err error }
func NewError(class ErrorClass, reason Reason, err error) *Error

type TargetInfo struct {
	DisplayName  string
	DefaultArgv  []string
	Capabilities Capabilities  // TTY, SeparateStderr, Resize, InitialSize, StdinEOF, Signals, Kill, Env, Cwd, CwdFact, ForegroundFact, HostRestart, ExitReport, Stall, LinkHealth, Integration
	Session      SessionLimits // zero value: no interactive sessions (Run only)
	Run          RunLimits     // zero value: no Run
}
type Option struct { Name string; Required bool; Choices []Choice }
type Choice struct { Value, DisplayName, Kind, Detail string; State ChoiceState; Default bool }
type Started struct { Program Program; PID uint32; TTY bool; Size Size; Kill KillBehavior; Term, Transport string } // Kill: optional, refines Capabilities.Kill for this session (a tty shell ends when its stream closes; a non-tty command may not); Term: the TERM the target applied; Transport: a closed code such as "k8s-ws-v5"

// What the HOST calls. The SDK's gRPC wrapper (PluginClient.V2()), the host's local terminal and the host's
// legacy adapter implement it; exectest.RunClientSuite proves each of them.
type Client interface {
	Describe(ctx context.Context) (*Description, error)
	Options(ctx context.Context, t Target) ([]Option, error)
	Open(ctx context.Context, req OpenRequest) (Conn, error)
	Run(ctx context.Context, req RunRequest) (*RunResult, error)
	RunStream(ctx context.Context, req RunRequest) (RunConn, error)
	Sessions(ctx context.Context) ([]SessionInfo, error)
	ReadOutput(ctx context.Context, id string, from uint64, max int) (*Replay, error)
	End(ctx context.Context, id string, mode CloseMode) error
}
type Conn interface {
	Facts() SessionFacts
	Events() <-chan Event // ordered; closed after Ended; the consumer's pace is the backpressure
	Input(ctx context.Context, data []byte) error
	Resize(ctx context.Context, seq uint32, size Size) error
	Signal(ctx context.Context, s Signal) error
	CloseInput(ctx context.Context) error
	Query(ctx context.Context, kind FactKind) (Fact, error)
	Close(ctx context.Context, mode CloseMode) error // end the session
	Detach(lease time.Duration) (time.Time, error)   // leave it running for the lease (0 = the session's default) and end this stream; returns when the lease expires
}
```

The Kubernetes pod target in full, as the author writes it (the bridge is 25 lines; `newExecutor` is the SPDY plus WebSocket fallback that `streamPod` and the action both build today, 12 lines, written once):

```go
func podExec(ctx context.Context, p *exec.Proc) (exec.Exit, error) {
	clients, err := kubeClients(p.Context)
	if err != nil { return exec.Exit{}, err }
	req := clients.Clientset.CoreV1().RESTClient().Post().Resource("pods").
		Name(p.Request.Ref.Address.ID).Namespace(namespaceOf(p.Request.Ref)).SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: p.Request.Selection["container"], Command: p.Request.Argv,
			Stdin: p.Stdin != nil, Stdout: true, Stderr: p.Stderr != nil, TTY: p.Request.TTY,
		}, scheme.ParameterCodec)
	executor, err := newExecutor(clients.RestConfig, req)
	if err != nil { return exec.Exit{}, err }
	if !p.Request.TTY {
		p.Started(exec.Started{}) // a tty reports it when sizeQueue is first polled, which happens once the streams exist
	}
	err = executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin: p.Stdin, Stdout: p.Stdout, Stderr: p.Stderr, Tty: p.Request.TTY,
		TerminalSizeQueue: sizeQueue(ctx, p), // 10 lines: Next() reads p.Resize, whose first value is Request.Size (so the queue is primed the way kubectl primes it), and calls p.Started(exec.Started{TTY: true}) on its first poll
	})
	var code utilexec.CodeExitError
	switch {
	case errors.As(err, &code):
		if code.Code > 128 && code.Code < 160 { return exec.ExitFolded(code.Code), nil } // 128+n: a death by signal the node folded, or a plain exit; the two cannot be told apart
		return exec.ExitCode(code.Code), nil
	case err == nil:
		return exec.ExitTransport(0), nil // client-go returns nil for a Success status and for an empty error channel alike (errorstream.go:42-50); until K2's spike can tell them apart, the 0 is the transport's word
	default:
		return exec.Exit{}, err // Target.Classify maps "no such file", RBAC 403, "container not running"
	}
}

// registration
exec.RegisterPlugin(plugin, exec.PluginOpts{Targets: []exec.Target{{
	Plugin: pluginid.ResourceProvider, Resource: "k8s:/pods",
	Info: exec.TargetInfo{
		DisplayName: "Pod", DefaultArgv: []string{"/bin/sh"},
		Capabilities: exec.Capabilities{TTY: true, SeparateStderr: true, Resize: true, InitialSize: true, StdinEOF: true,
			Kill: exec.KillClosesStreamOnly, HostRestart: exec.SurvivalNone,
			ExitReport: exec.ExitReportCode, Stall: exec.StallLossy, Integration: []exec.IntegrationMode{exec.IntegrationArgvWrapper}},
		Session: exec.DefaultSessionLimits, Run: exec.RunLimits{DefaultTimeout: 30 * time.Second, MaxTimeout: 5 * time.Minute},
	},
	Exec: podExec, Options: podOptions, Classify: classifyPodExec,
}}})
```

### 4.5 Interactive session semantics

**Open is create and attach in one step.** The first client frame opens (a new command) or attaches (an existing session). The SDK admits the request (limits, id, route against the caller's connection, the registered type), sends `Opened{facts, replay}` (what it knows before the author runs: the target, the capabilities, the requested program and size, and for an attach the description of the replay that follows) and, for a new session, only then starts the author's function with the stdio already wired; when the author calls `Started` the SDK sends a `Started{facts}` frame with the facts refined by what the target says (the resolved program, a pid, the tty and size really granted, this session's kill behaviour). Output can no longer be produced before anyone listens, so the "ended before the attach" class (R6) cannot exist, and there is no attach step to forget.

**One stream per session.** HTTP/2 gives each session its own flow-control window and its own order; there is no shared FIFO, no shared input goroutine, no multiplexing by id. A stalled stream does not stall its neighbours: **measured** in the model (an echo's p95 was 206 µs while another stream's consumer slept 5 ms a frame) [ran]; the reason is that grpc-go replenishes the connection-level window as data arrives and only the per-stream window waits for the application [INFERENCE: from its transport design, not re-read; the model is the evidence]. The end of a stream is the signal that its host went away (F11).

**Order and offsets.** All client frames of a session are ordered with each other (a resize before a paste stays before it). Output carries a byte `offset` in one sequence per session (stdout and stderr in arrival order for a non-tty). Replay and live output join exactly by offset; a gap is a `Dropped` frame or `replay.start > from_offset`, never silence. The host still orders what the page sends (T1.md: unawaited calls reorder); that queue stays in the host and moves up (section 5).

**Flow control, both directions, no credit protocol; and one rule per kind of target.** Output: the author's `Write` goes into a bounded queue (256 KiB), the output pump sends whatever the queue holds (up to 64 KiB a frame, no timer: while a frame is in flight the next one grows, so an idle echo costs one byte and a flood costs one 64 KiB frame), and when the stream's window is full the pump blocks and the queue fills. What happens next is declared by the target (`Capabilities.stall`). **`STALL_PROPAGATES`** (a local pty, ssh with its per-channel windows): `Write` blocks, the executor stops reading its stream and the remote process blocks in its own write; nothing is lost, and this is the right rule. **`STALL_LOSSY`** (Kubernetes, Docker): a reader that stops reading is not safe. client-go's websocket executor reads every channel in one loop that writes into per-stream pipes and "can block" (`websocket.go:310-321` [read, client-go 0.37.2]), so one consumer that stops reading stalls the status channel too, and the server closes the stream regardless, which loses the tail (k/k#142376, open [note: the prior-art study, not re-read]). **The first version of this plan blocked the target's reader on every target; for these targets that was wrong.** Now the SDK never lets the host's pace reach such a target: the author's `Write` goes into the replay ring instead of the blocking queue and is never blocked for more than 50 ms, the pump reads the ring at the host's pace, and when the host falls behind by more than the ring (1 MiB by default) the oldest unsent bytes are overwritten and counted (`Dropped{EAGER_DRAIN_OVERFLOW}`, `Ended.dropped_bytes`, `Ended.output = TRUNCATED`). The host's credit watermarks therefore sit on the ring's read cursor, never on the remote socket, and a hidden tab that stops reading never stops the pod. An overflow is repaired by the consumer, not hidden: it reads the gap back with `ReadOutput` while it is still in the ring, or resyncs by attach. (The UI half is the study's pitfall 2: acknowledge on receipt into a bounded UI buffer, not on the emulator's parse, and resync by offset when that buffer overflows, instead of holding and dropping the oldest chunks; the SDK's part, offsets and `ReadOutput`, exists.) Input: the SDK stops receiving when `Stdin`'s queue (256 KiB) is full, the window closes, and the host's `Input` returns a typed backpressure error that the host's ordered queue turns into `INPUT_BACKLOG` (T1-go). The host's UI credit (`AckTerminal`) is the same mechanism one hop up: stop reading `Conn.Events`. Detached, a session cannot block the remote on a reader that is not there: its output goes to the ring and the oldest bytes are dropped and counted (`DROP_DETACHED_OVERFLOW`). Bounds, all declared in `SessionLimits`: input frame 64 KiB, stdio queues 256 KiB, replay ring 1 MiB (grows on demand, at most `max_replay_bytes`), 32 sessions a plugin.

**Resize.** Initial size is `Start.size` and the first value on `Proc.Resize`; later sizes are `Resize{seq, size}` frames. The SDK keeps only the newest pending size, never blocks, delivers it to the author's channel, and answers `Resized{seq, size, result}` (`APPLIED` when the author consumed it, `IGNORED` when the target has no resize capability, `FAILED` typed). A resize storm therefore costs one delivery.

**Signals and stdin EOF.** Ctrl+C in a tty is the byte 0x03 through `Input`, as in every terminal. `Signal` is an explicit action ("Stop", "Kill") and only for the signals `Capabilities.signals` lists; otherwise the host offers only Close. `CloseInput` is stdin EOF (a non-tty run with stdin, `Ctrl+D` semantics for pipes). `Close{graceful}` cancels the author's context and waits a declared grace; `Close{kill}` skips the grace. What ending does to the remote process is `Capabilities.kill` and `Ended.remote_may_survive`, typed facts instead of the sentence in a description.

**Errors and the end.** Every failure the author knows is `Error{Class, Reason, Facts}`; the SDK adds its own (limits, cancellation, lease). `Ended` is the last frame of a session and carries the typed `End` (`exited`, `signaled`, `closed{by}`, `failed{class, reason, stage}`, `lost{cause}`), `started`, the duration, the counts, `output` completeness, `last_offset` and `mode_reset`. T1-go's `End` is the same shape with the same JSON names; the SDK adds the `closed_by` values only a plugin can know (`detach-timeout`, `idle-timeout`, `superseded`, `connection-retired`, `plugin-shutdown`, `run-timeout`, `cancelled`); the host adds `window`. **`lost` is new, and it is an end that is not a status:** the connection to the target ended with no terminal status (`LOST_NO_STATUS`: the stream closed with nothing on the status channel; `LOST_LINK_DEAD`: the transport's keepalive gave up), so the process may be running, may have exited with any code, or may have been killed. A consumer never shows `lost` as exit 0, never as `failed` (the command did not fail; we do not know), and never retries a command because of it; `remote_may_survive` is true for it. **`ExitSource` says whose status the code is** (`PROCESS`: the target relayed the process's own status; `SIGNAL_FOLDED`: a death by signal the target folded into 128+n, so the SDK reports the code and claims no signal; `TRANSPORT`: the transport said the stream ended and the process's own status was not relayed), and `Capabilities.exit_report` says in advance what a target can ever say (`NONE`: Kubernetes attach; `CODE`: Kubernetes exec; `CODE_AND_SIGNAL`: a pty, ssh), so the UI never waits for, and never invents, a `signaled` the target cannot produce. A session that fails to start is `Failed{stage: start}` with `started: false`; `started` becomes true when the author calls `Started`, when the first output arrives, or when the command exits with a status. `Ended.output` is `COMPLETE` only when every byte the command wrote was read and delivered, `TRUNCATED` when the ring overwrote counted bytes, and `UNKNOWN` otherwise (a `lost` end, a drain that hit its bound); the zero value is `UNKNOWN`, so a producer that forgets the field never claims completeness. `Ended.mode_reset` and `Dropped.mode_reset` are bytes for the emulator, never for the target: after a session ends inside a full-screen program, or after a dropped range that may have held a mode change, nothing remote restores the alt screen, the mouse modes, bracketed paste, application cursor keys or the kitty keyboard stack (Wave, Tabby and kitty each write them by hand [note: the prior-art study]); with `FEATURE_MODES` the string resets exactly the modes that were set, without it the SDK sends the fixed full reset (a golden test pins the bytes), and the host's local provider emits the same string.

**Replay, reattach, lease: the attach reply is atomic, and detach is not destroy.** The SDK keeps a replay ring per session, trimmed in whole chunks (64 KiB) so that its front is always a position at which the scanner (X4a) is in the ground state, never inside an escape sequence or a UTF-8 sequence. Every output frame carries its `offset`. A host whose stream broke, or one that wants bytes it no longer has, calls `Open{attach{session_id, from_offset}}` (the older stream, if any, ends "superseded"). The reply is `Opened{facts, replay}` with `replay = {start, end, bytes, start_size, start_modes, size, modes}`, and it describes exactly the `Output` frames that follow, `[start, end)`; the live stream continues at `end` with no byte lost and none repeated, because the SDK takes the snapshot and registers the stream under one lock. `start > from_offset` says that bytes were dropped in between; `start_size` is the size the replayed bytes were produced for (the emulator replays at that size and then resizes, as VS Code does with `{cols, rows, data}` [note]); `start_modes` and `modes` are the terminal modes at `start` and now (exact with `FEATURE_MODES`; `known = false` before X4a). What the emulator does with a replay (mute the replies to queries that were already answered, bounce the size so the program redraws) is the UI's; the contract gives it the size and the modes it needs to do that exactly. The unary `ReadOutput(from, max)` is a cursor read of the same ring (also the agent's "what did session X print"). **Detach is a verb, separate from destroy:** `Detach{lease_ms}` ends this stream and keeps the session (`Detached{lease_expires}` is the last frame of the stream); a stream that just breaks is an implicit `Detach` with the session's default lease; `Close` and `EndSession` destroy. The lease is `detach_timeout` (default 5 minutes; the host may ask for up to `max_detach_timeout` at start or when it detaches): at its end the session is closed with `Closed{detach-timeout}`, so a reload or a reconnect is survived and a host that never came back does not leak a remote shell. An ended session stays in `ListSessions` and `ReadOutput` as a tombstone for 60 seconds, so a late reader gets the final bytes and the End instead of NOT_FOUND. The session's lifetime is bound to its connection generation: a retired connection ends its sessions with `Closed{connection-retired}` (R14).

**What can and cannot be promised, per target kind** (a declared capability, not a guess; the Kubernetes row is from the code and the Kubernetes behaviour [INFERENCE: not run against a cluster] where marked):

| Target | Window reload | Host stream broke, plugin alive | Plugin or host restarted | What the UI may say |
|---|---|---|---|---|
| Kubernetes Pod exec, tty | yes (ring, offsets) | yes, within the detach window | **no**: the SPDY stream closes, the pty closes, the shell gets SIGHUP [INFERENCE] | "Ended when Omniview closed" is true; never offer Reattach after a restart |
| Kubernetes Pod exec, no tty (a run) | n/a | n/a | no; **the remote process may keep running** (`remote_may_survive`) | say so in the result |
| Kubernetes attach (ephemeral or main process) | yes | yes | the **process** survives, a new session reaches it, the scrollback does not (`SURVIVAL_TARGET_PROCESS`) | "Reconnect to the process", not "Resume" |
| Kubernetes node shell (debug pod) | yes | yes | no, and the privileged debug pod must carry an `activeDeadlineSeconds` so a crash does not leak it (plugin hardening, K2) | |
| Docker exec | yes | yes | no [INFERENCE] | |
| SSH | yes | yes | no, unless the command is `tmux new -A` (then `SURVIVAL_TARGET_SESSION`, declared by that target) | |
| The host's local shell | yes (the host holds it) | n/a | no (T1-go: ended with the window) | |

**Shell integration (OSC 133, 633, 7): bytes are primary, typed events are secondary, and a mark says how far it can be trusted.** The bytes always pass through untouched and in order, because the places that use a mark need a screen position (a decoration on a row, "jump to the previous command", sticky scroll) and only the emulator knows rows; VS Code does its handling in the renderer's xterm parser and JetBrains in its own parser [INFERENCE, from memory]. The producer states as typed events what it knows natively and cheaply and a screen is not needed for: the process exit (`Ended`), the command end of a run, the cwd where it can read it (`Fact`), the foreground where the OS gives it (`Fact`). For consumers that have no emulator (an agent reading a transcript, a "command finished" notification, command history) the SDK offers ONE opt-in scanner (`FEATURE_MARKS`, X4a) that turns OSC 133/633/7 in the output into `Mark{kind, at_offset, exit_code, cwd, command_id, command_line, trust, duration_ms, redraw}` frames while leaving the bytes alone; the host's local terminal imports the same scanner. A consumer with an emulator ignores the marks and reads the bytes; nothing is parsed twice on the same side. The kinds are prompt start (`A`), input start (`B`), command start (`C`), command end (`D`) and cwd; the scanner tolerates `D` without `C`, a repeated `A`, and the 133 that p10k, starship and oh-my-zsh emit on their own. `command_id` is assigned by the SDK, unique and monotonic in the session, and equal on the marks of one command (a nesting id from the shell, when present, lets a consumer close inner commands when an outer `ssh` dies); `command_line` comes from OSC 633 `E`, unescaped and bounded to 4 KiB, and is **content**: never logged, audited or put in a model prompt without a gate. **Trust:** a mark parsed out of a byte stream can be forged by any program that prints (`cat` of a file that contains an OSC 133), so when integration is on the SDK generates a per-session nonce, gives it only to the integration script, and marks as `MARK_TRUST_NONCE` the marks that carry it; every other mark is `UNVERIFIED`, and a consumer treats the `command_line`, `cwd` and `exit_code` of an unverified mark as a hint, never as authority (never for an approval, never as a fact in an agent's prompt). The nonce is also given to the host (`facts.integration.nonce`) so that the UI's own parser applies the same two tiers to the bytes; it is a secret, never logged, audited, put in a span or sent to a model (a canary test, as for `Error.Err`). It is not a defence against a program in the same container that reads its own environment or `/proc`, and with an argv bootstrap it is visible to `ps` inside the container: it is single-use and low-value, and the plan says so [INFERENCE: argv visibility is the nature of argv; not measured in a pod]. A producer-vouched trust level is not added now (2.7): the integration script is the producer's own code, and the nonce is how it vouches.

**Getting integration into a remote shell: consent only, never by default.** A pod shell offers no argv or env control for an rc file, so `FEATURE_MARKS` alone assumed that the remote prints marks. The contract adds one opt-in path: `Start.integration{mode: ARGV_WRAPPER, consent: true}`. With it the SDK, not the author, rewrites the command to `[sh, -c, <bootstrap>, --, <the requested argv...>]`: a clean-room bootstrap script embedded in the SDK (the nonce in the same argv) loads the integration for bash (zsh and fish where present) and then `exec`s the requested shell, so the user's session is the process they asked for; nothing is ever typed into the user's tty (a typed bootstrap is what recurs in Warp's bug list: warp#7099, #15653, #16630 [note]). The author declares which modes its target accepts (`Capabilities.integration`) and may fall back (an image with no `sh`, a read-only filesystem: `NOTICE_INTEGRATION_IGNORED`, tier NONE). The result is observed, not promised: `Fact{INTEGRATION_TIER}` pushes NONE, BASIC (prompt marks only) or RICH (prompt, input, start and end with the nonce) as the scanner sees them, so the UI and an agent know what they have. The default is OFF everywhere; the host sends `consent: true` only when the user asked for this terminal (open question 4 keeps remote injection to "only if asked"), and the SDK refuses a mode without the flag (`INVALID_REQUEST / CONSENT_REQUIRED`). A helper binary in the pod is not offered (2.7).

**Options: the container picker is a producer fact.** `Options(ref)` returns `Option{name: "container", choices}` with each choice's `state` (ready, starting, stopped), a closed-code `detail` (`terminated`, `crash-loop`, ...), `kind` (`container`, `init`, `ephemeral`) and the default (the `kubectl.kubernetes.io/default-container` rule, today in `pod_exec_action.go:99-116`). It replaces the JSONPath `TargetBuilder` evaluated by the UI over the Pod body (`$.spec.containers[*]`: no state, no init or ephemeral containers) and the "container not running" error after the fact. It is the data the terminal's next slice (Pod exec with a container picker) needs, and it ships in X1, before `Open` exists.

**Stream health, keepalive and link health.** Two legs, two signals. The plugin sets gRPC keepalive enforcement on its server and the host sets client keepalive (30 s ping, 10 s timeout, pings allowed without a stream), so a dead plugin is found by the transport in seconds and every session's stream ends at once with a typed `Failed{class: connection}` the host turns into an End in the window (H2). The plugin-to-target leg is the author's to report: `Capabilities.link_health` says it can, and `Proc.Link(state)` becomes a `Link{state, silent_ms}` frame on a change (GOOD, DEGRADED, STALLED), with Wave's thresholds as the guide (a probe after 10 s idle, stalled after 10 s unanswered [note]); client-go's websocket executor pings every 5 s and gives up after 61 s without a pong (`websocket.go:57-65` [read]) but exposes neither, so the Kubernetes target declares `link_health = false` until K2 finds an honest probe, and the UI shows no health it does not have. A stalled link that ends the session ends it as `Lost{LINK_DEAD}`, never as a clean exit. A failure between the plugin and the target is the session's own `Failed{stage: stream}`; the plugin does not reconnect to a target (Kubernetes cannot resume an exec stream), and the UI offers a new session ("Restart") built from `facts.program` and `facts.target`, with a visible separator, and labels pod terminals as not persistent.

### 4.6 The bounded run (B): for agent tools and for "run this command in the container"

**Safe by construction.**
- **argv only.** `RunRequest` has no command-string field. A shell is `["sh", "-c", script]`, visible as such to consent, policy and audit.
- **Bounds are mandatory and declared.** `timeout_ms` and the output limits default to the target's `RunLimits`; a value above the maximum is `INVALID_REQUEST`, never silently clamped (the host clamps before the call, the SDK refuses after it: defence in depth). Stdin is at most `max_stdin_bytes` (default 64 KiB, at most 1 MiB), env and argv are bounded, concurrent runs are limited (typed `LIMIT/TOO_MANY_RUNS`).
- **No unbounded buffer; completeness is stated.** Output is captured into a head and tail window (`HEAD_TAIL` by default: an error is usually at the end), the middle is counted, never stored; `OutputAccount{total, kept, dropped, truncated, head, tail, valid_utf8, completeness}` is exact; bytes are raw and untouched (the plugin no longer repairs UTF-8; the host's tool boundary decides text or base64 from `valid_utf8`). `completeness` is `COMPLETE` (the stream was read to its end, nothing was lost in transit and `kept + dropped == total`), `TRUNCATED` (policy dropped counted bytes) or `UNKNOWN` (the stream ended abnormally, or the drain after the exit hit `post_exit_drain_ms`: a background child can hold the pipe open forever, k/k#44371 [note]; `total_bytes` is then what arrived). **An agent never reads `UNKNOWN` as complete and never reads `OUTCOME_LOST` as success.**
- **Cancel, timeout and the end are real and typed.** Cancelling the call or reaching the timeout cancels the author's context; `outcome` is `TIMED_OUT` or `CANCELLED`, and any `exit_code` then carries `exit_source = HOST` (the aftermath of our kill, not the command's status); `remote_may_survive` says whether the target can promise the process stopped (for a pod it cannot: cancel is detach), and the call returns within the timeout plus 100 ms. A stream that ends with no terminal status is `OUTCOME_LOST`: the command may have run, and the host never retries it on its own. A run uses a **non-TTY** exec (stderr separate, no echo, no ANSI; a TTY merges stderr into stdout, `v2.go:81` [read]) and its stdin is empty unless given.
- **Typed refusals, four distinct families** (an agent and the UI can tell them apart; none is a sentence): **forbidden by the target's own authorisation** `FORBIDDEN / TARGET_DENIED` (cluster RBAC on `pods/exec`); **denied by host policy** (host-only classes the plugin cannot produce or forge: `exec off for this connection`, `consent denied`, `consent timed out`, `pattern not allowed`, `limit exceeded`); **target gone** `NOT_FOUND / TARGET_GONE`, `CONFLICT / TARGET_REPLACED` (incarnation changed), `UNAVAILABLE / NOT_RUNNING`; **no shell in the image** `NOT_FOUND / NO_SUCH_EXECUTABLE` with `facts.program` (what was not found); plus `UNSUPPORTED / TTY_UNSUPPORTED`, `LIMIT / TOO_MANY_RUNS`, `TIMEOUT`, `CANCELLED`. The plugin's `Classify` may match its own API's error text (it is the producer); only the class and reason leave the plugin.
- **Streaming variant.** `RunStream` sends `RunStarted`, `Output` chunks, `RunProgress` and `RunEnded` (counts only); cancel is cancelling the call. The UI's "run this in the container" action uses it; MCP maps it to progress notifications if it wants to (the relay's 2-minute call cap still applies).

**How it becomes a tool almost for free, and where the host enforces.**
1. The plugin registers a `Target` for a resource type (the same registration that powers the terminal). `Describe` says it supports runs.
2. The host's relay builds the tool from the exec lane exactly as it builds the logs tool from the logs lane (`resource_tools.go:165-175`): a new host-bound operation `exec.Run` for each route and type whose target declares `Run`, with a schema the HOST writes (`reference`, `argv`, `stdin?`, `env?`, `cwd?`, `timeoutSeconds?`, `maxOutputBytes?`), never the plugin's descriptor. `ReadOnly: false`, `Destructive: true`, never in the `read-only` preset, never a user override that removes consent.
3. **The host enforces before any call reaches the plugin, and fails closed:**
   - `ConnectionPolicy` gains `Exec ExecPolicy{Mode, Allow, MaxTimeoutSeconds, MaxOutputKiB, MaxConcurrent, MaxPerMinute}`. The default and the value for any connection id without an entry is **off**: the tool is not listed and a call is refused `POLICY_DENIED / EXEC_OFF`. This does not depend on `BlockConnectionsByDefault`, so the H6 fail-open (a connection id the policy does not know) cannot reach exec.
   - `Mode: confirm` asks the user for every call on the **exact argv, env names, cwd and bounds** (`Authority.Bind` already ties approval to the exact arguments); `Mode: allow` asks unless the argv matches an allowed pattern (literal prefix, glob per element, never a regex or a joined string; a later step). A `Confirm=false` override is ignored for this tool.
   - The host clamps `timeout` and the limits to policy and the relay's 2-minute cap, and passes them; the SDK refuses anything above its own maximum.
   - Consent unavailable, policy revision changed during the call (the existing fence cancels accepted work), audit not writable: refused, never "implicitly allowed".
4. **Audit, written by the host in two phases** (intent before the call, outcome after; a crash in between leaves the intent): `ExecAudit{at, invocation_id, credential_id, session_id, declared_client (the MCP client's self-declared name and version, labelled unverified: open question 2), plugin, connection_id and name, target {type, id, scope}, argv_sha256 of the exact argv, argv_preview (argv[0] verbatim; each argument at most 256 bytes and the whole at most 2 KiB; values that follow secret-shaped flags or match secret shapes replaced by «redacted», by the host's redactor), argc, env_names (never values), cwd, stdin_bytes and sha256, requested and effective timeout and limits, consent result, policy revision, outcome (exited code, signaled, timed out, cancelled, refused: class and reason), stdout and stderr counts and flags, duration}`. **Never** env values, stdin content or output content. The record goes to the existing audit sink and to an append-only local file (0600, size-rotated); both through the redacting logger's rules, with canary tests (4.8).
5. **The result the agent sees** is structured: `{runId, status (exited, signaled, timed_out, cancelled, lost), exitCode, exitSource (process, signal_folded, transport, host), signal, stdout, stderr (text when valid UTF-8, else base64 plus a flag), stdoutAccount, stderrAccount (each with completeness), durationMs, remoteMayStillRun}` and a refusal is a fixed-word message plus its typed class (no more "tool invocation failed"). The host adds no `ok` of its own: the agent reads `status`, `exitCode` and the two completeness values, and the tool's description says what `transport` and `lost` mean. Anti-hang defaults are the HOST's policy, sent as `env` only to a target that takes env (`NO_COLOR=1`, `TERM=dumb`, `PAGER=cat`, `GIT_PAGER=cat`, `GIT_TERMINAL_PROMPT=0`, `DEBIAN_FRONTEND=noninteractive` and an agent marker such as `AI_AGENT=1`; the set Codex and Gemini use [note]); a target with no env field (Kubernetes) refuses `env` for a run as `UNSUPPORTED`, never silently ignoring it, and its author may declare `env` and prefix `env K=V --` to the argv (the cost: no `env` binary in the image is `NO_SUCH_EXECUTABLE`).
6. The Kubernetes `exec` action (`pod_exec_action.go`, 261 lines) is deleted in K1 **after** the host's `exec.Run` lands, so an agent never sees two tools for one thing.

### 4.7 One session-lifecycle primitive, so the teardown-race class cannot recur

The log lane's #84 and the exec `Close` race (B-99) are the same bug: a `sync.WaitGroup` member added from outside while `Wait` may be returning. PR C (another agent, in progress) removes it for exec and logs with `internal/producers.Group` (a count and an end STATE decided under the lock that admits members) and a `closed` flag on the exec manager. That fixes two instances. The class recurs while every lane keeps its own session map, its own end rules and its own "emit the end" code. The design therefore asks for ONE primitive that owns the whole lifecycle, built on `producers.Group`, and a rule that nothing else is allowed:

```go
// internal/session (new; X2): the lifecycle of the sessions of one lane. Admission, end and shutdown are states
// under one lock; there is no WaitGroup in it and none is allowed beside it.
type Registry[S any] struct{ /* map, closed flag, producers.Group for the sessions */ }

func (r *Registry[S]) Admit(parent context.Context, id string, init func(ctx context.Context) (S, error)) (*Entry[S], error)
        // typed ErrClosed once Close has begun; typed ErrExists for a live id; the entry's context is cancelled by End and by Close
func (e *Entry[S]) Go(fn func()) bool            // start one producer of this session; false once the session has ended
func (e *Entry[S]) End(c Cause) (first bool)     // the first call wins, cancels the context, records the cause; later calls change nothing
func (e *Entry[S]) Done() <-chan struct{}         // closed when the last producer returned: the only moment the lane sends the End frame
func (r *Registry[S]) Close(ctx context.Context) error // refuse new admissions, End every entry, wait for all; idempotent and safe concurrently
func (r *Registry[S]) Snapshot() []Info
```

Rules it enforces by construction: (1) **no Add-after-Wait**: membership is a state, not a counter handed to the runtime; (2) **exactly one end, last**: `Admit` starts one ender goroutine that waits for `Done()` and then calls the lane's single `sendEnded`; no other code path emits `Ended`; (3) **no goroutine outlives its session**: every goroutine of a session is started with `e.Go`; (4) **shutdown is a state**: `Close` sets `closed` under the admitting lock, so a start that loses the race is refused with a typed class and never admitted; (5) **the connection**: `Admit`'s parent context is the connection lease, so a retired connection ends its sessions with a typed cause (R14).

Enforcement, so a new lane or a new author cannot reintroduce it: a pattern for `sync.WaitGroup` on the `forbidigo` linter the SDK already enables (`.golangci.yml:210`), applied to `pkg/v1/**`, with a reasoned `//nolint:forbidigo` on the two function-local fan-out groups the review judged safe (`logs/manager.go:750`, `metric/manager.go:526`: the `Add` precedes the goroutines and the `Wait` is in the same function) [INFERENCE: forbidigo matches identifiers, so a field and a local variable cannot be told apart; the nolint is the price]; a shared **lifecycle hammer** in `internal/lifecycletest` that every lane's manager runs (create, update, end and `Close` from many goroutines for 30 seconds, plain and `-race`, the invariant of 4.8); and the registry's own tests (both interleavings of every crossing forced with `Freeze`, as the group's tests do). Logs, metric and networker adopt the registry in their own later PRs (X6); exec v2 uses it from the first line.

### 4.8 The conformance suite and the stress harness (`exectest`, extended; the old fake-pipe harness stays until the flip)

- `exectest.FakeTarget`: a scriptable `Target` (output with chunk sizes and delays; exit, signal or error at a chosen point; blocks on stdin; ignores resize; a slow writer; a stuck mode; a panic mode).
- `exectest.Conformance(t, target)`: a plugin author runs it against THEIR `Target` through the real engine over a real unix-socket transport, in their own `go test`. Cases that need a real target are skipped under `-short`.
- `exectest.RunClientSuite(t, newClient, caps)`: provider-neutral; run against (a) the SDK's gRPC client over the engine with a `FakeTarget`, (b) the host's local terminal provider (host repo), (c) the host's legacy adapter (asserting the unknown path).
- The cases: (1) `Opened` is first and its facts agree with `Describe`, no capability is claimed that was not declared; (2) input and resize frames reach the author in order (10,000 frames); (3) output offsets are contiguous and monotonic and the bytes are untouched (all 256 byte values, every UTF-8 sequence cut at every boundary); (4) a slow consumer bounds memory; with `STALL_PROPAGATES` it blocks the author's `Write` and nothing is dropped while attached (the `STALL_LOSSY` rule is case 18); (5) isolation: a stuck, slow or flooding session does not move another session's echo p95 beyond the bound of 3.6; (6) resize: a storm delivers at most two sizes, the last `seq` is acknowledged, an unsupported resize is typed-ignored, the initial size arrives first; (7) signals only as declared, an undeclared one is a typed refusal, `Close` graceful and kill, `remote_may_survive` agrees with the capability; (8) stdin EOF; (9) the end: exactly one `Ended`, last, typed for exit 0, exit n, signal, a failure at start, a failure mid-run, close by request, detach-timeout, superseded and connection-retired, `started` as defined, counts exact; (10) detach and reattach: replay plus live equals one uninterrupted transcript byte for byte, a dropped range is reported, a tombstone is readable after the end; (11) the lease ends a detached session at the (fake-clock) timeout; (12) limits: too many sessions, input too large, env or cwd unsupported are typed; (13) errors: class, reason and facts round-trip and **a canary string placed in `Error.Err` appears in no frame, status or header**; (14) a retired connection ends its sessions; (15) `Run`: empty argv or a NUL is `INVALID_REQUEST`, bounds mandatory, a timeout returns `TIMED_OUT` within timeout + 100 ms, cancel, capture accounting as a property test (random chunking and caps: `kept + dropped == total`, head and tail exact), `valid_utf8`, concurrency limit.
- **The same operation against itself (pair tests, each a differential oracle):** P1 `Run(argv)` equals `Open(argv, tty=false)` collected to the end (same bytes per stream, same exit); P2 `Open` then detach then `attach(from_offset)` equals one uninterrupted `Open` (bytes and offsets); P3 the engine over gRPC equals the engine in process; P4 the host's local provider equals the engine with a pty-backed fake on the same script (the same observable facts and End); P5 ending twice, ending after the exit and ending during the start give the same final `Ended`; P6 legacy adapter over the legacy lane equals the new lane on the same fake remote for the bytes (the facts differ by design: unknown).
- **Stress with an end-state invariant** (generalises #84's hammer): N workers each loop {open, input, resize, signal, detach, attach, end, close-stream, run, cancel} with random timing for 30 s plain and 30 s `-race` (Linux) and a 5 s version on the three-OS matrix; at rest: goroutines back to the baseline within 2 s; the registry empty; `Close` returned within its bound and later `Admit` refused `ErrClosed`; every admitted session emitted exactly one `Ended` and nothing after it; for every session `delivered + dropped == written` with no byte twice; every `Run` returned exactly one result with `kept + dropped == total`; no panic (`WaitGroup is reused`, `send on closed channel`, `close of closed channel`); for the pty-backed provider, open file descriptors back to the baseline.
- **Cases added in the second pass:** (16) `lost`: a target whose stream ends with no status ends the session with `Lost`, never `Exited{0}`, and a run ends `OUTCOME_LOST`; (17) exit source and report: `ExitCode`, `ExitFolded` and `ExitTransport` round-trip as `PROCESS`, `SIGNAL_FOLDED` and `TRANSPORT`, and a `Signaled` from a target that declared `exit_report = CODE` is a contract violation (logged, reported as `Exited`); (18) completeness: a `STALL_LOSSY` target whose host stops reading for 5 s loses nothing the ring can hold, reports the exact `dropped_bytes`, `Ended.output = TRUNCATED` and `EAGER_DRAIN_OVERFLOW`, and the target's writer is never blocked past 50 ms; a `STALL_PROPAGATES` target blocks instead and ends `COMPLETE`; a run whose post-exit drain hits its bound is `UNKNOWN`; (19) marks: the scanner properties of X4a (a mark with the right nonce is `NONCE`, one with none or a wrong one `UNVERIFIED`, `command_id` stable across the marks of one command, `D` without `C`, a foreign 133), and **the nonce appears in no log, span, audit line, error or frame except `facts.integration.nonce`** (canary); (20) integration: no `ARGV_WRAPPER` without `consent`; with it the wrapper runs the requested shell, tier RICH on a bash fixture and NONE on a shell-less one; (21) attach is atomic: attached at random moments under a flood, `replay.bytes == end - start`, replay plus live equals the uninterrupted transcript, `start_size` is the size in force at `start`, and `replay.start` is a ground-state offset; (22) detach: `Detach{lease}` ends the stream and not the session, `Detached` is last, the lease follows the fake clock and is clamped to the maximum, `Close` and `EndSession` destroy; (23) link: `Link` is sent on a change only, and a stalled link that ends the session ends it `Lost{LINK_DEAD}`; (24) `mode_reset`: the bytes are the golden string, and with `FEATURE_MODES` they reset exactly the modes that were set. The stress invariant gains: every session ends with exactly one of `Exited`, `Signaled`, `Closed`, `Failed`, `Lost`, and `Ended.output == COMPLETE` implies `dropped_bytes == 0` and `delivered == written`.

### 4.9 What an IDE terminal expects, and the producer fact that makes each exact

| Expected behaviour | Fact it needs | Source in this design |
|---|---|---|
| the first prompt laid out for the real size | initial size at open | `Start.size`, first value of `Proc.Resize`, `facts.size` |
| tab title "zsh" or "bash - pod/container", a name that survives reload | shell and program name, target display name | `facts.program`, `facts.target.display_name` |
| "Exited with code N", "Terminated by SIGKILL", "Closed by you", "Connection lost" | typed End | `Ended.end` |
| the close question asks only when something runs | foreground idle, busy or **unknown** (unknown asks) | `Fact`, capability `foreground_fact` |
| "New terminal here" | cwd | `Fact` (local: pull), marks |
| scrollback survives a panel hide, a reload, a stream break | replay by offset, no gap hidden | ring, `ReadOutput`, `Opened.replay`, `Dropped` |
| Ctrl+C interrupts; Stop and Kill buttons only where they work | named signals, kill behaviour | tty byte, `Capabilities.signals`, `kill`, `remote_may_survive` |
| no wrong size after a resize drag | seq, coalescing, acknowledgement | `Resize`, `Resized` |
| a big paste does not freeze; a flood (`cat big.log`) does not freeze the UI or the host | backpressure end to end, few large events | HTTP/2 windows, 64 KiB frames, host credit |
| one stuck terminal does not stop another | per-session isolation | a stream per session |
| command decorations, jump to previous command, exit-status gutter | OSC 133/633 bytes untouched; typed marks for consumers with no emulator | bytes primary, `FEATURE_MARKS` secondary |
| "command finished" notification | the command-end mark or the End | marks, `Ended` |
| Restart on an ended session | what to rebuild: target, argv, size, selection | `facts.target`, `facts.program`, `Start` |
| a clear sentence when it fails ("no shell in this image", "you may not exec in this Pod") | class, reason, facts; the host writes the words | `Failed{class, reason, facts}` |
| screen-reader announcement of the end | the typed End | `Ended` |
| what can be promised after a restart | declared survival | `Capabilities.host_restart` |
| "connection lost, the command may still be running" (never "exited with code 0") | an end that is not a status; what a target can report | `End.lost`, `Capabilities.exit_report`, `ExitSource` |
| a stalled link shown as stalled, not as a frozen screen | the plugin-to-target link state | `Link`, `Capabilities.link_health` |
| the terminal is usable after a session died inside vim or `less` | the modes to restore | `Ended.mode_reset`, `Dropped.mode_reset` |
| a reload restores screen, size and modes without answering old queries twice | size and modes at the replay start, an atomic reply | `Opened.replay` |
| "last command", jump to it, copy its output, re-run it | command id, command line, trust | `Mark{command_id, command_line, trust}` |
| a pod terminal with decorations, only when the user asked | integration tier, consent | `Start.integration`, `Fact{INTEGRATION_TIER}` |

## 5. The local terminal: the same contract, as an in-process provider

**Recommendation: yes.** The host's own shell implements the SDK's `exec.Client` and `exec.Conn` as an in-process provider named `local`; the exec controller holds providers, and the UI has one feed, one set of facts, one End, one picker and one replay mechanism. Reasons: the host already imports the SDK's session types (`terminal/manager.go` reuses `sdkexec.Session`, `StreamOutput`, `OutputBuffer`); T1-go already built, for the local shell, every fact the plugin lane lacks, in shapes the UI is being written against (T1.md "the producer's side": every fact optional, one path for "the producer that knows" and "the one that does not"); and two surfaces for one kind of thing (`CreateTerminal` vs `CreateSession(plugin, connection, ...)`, a CLOSE payload that is an object for one and base64 text for the other, `IsBusy` answering `unknown/remote`) is exactly the kind of fork the owner's rule forbids.

**What moves, and what does not**

| Piece | Today | After | Lives in |
|---|---|---|---|
| `End`, `Foreground`, `Directory`, program (`Shell`), session facts | host `backend/pkg/terminal/types.go` (T1-go) | SDK `exec`, **JSON names unchanged** (`reason`, `exit_code`, `signal`, `signal_number`, `core_dumped`, `closed_by`, `failure{stage,message}`, `state`, `name`, `pgid`) so the generated TS models do not change; the host aliases them | SDK |
| the output ring | SDK `OutputBuffer` (the host's local terminal calls `sdkexec.NewDefaultOutputBuffer`) | SDK ring with offsets (X0 fixes the append cost for both at once) | SDK |
| ordered input queue, optional `seq`, `INPUT_BACKLOG`, `SEQUENCE_STALE` | `backend/pkg/terminal/ordered.go` | the exec controller, **in front of every provider** (the page reorders unawaited calls whatever the provider) | host |
| credit flow control (`flow`, `AckTerminal`) | local only | the controller: stop reading `Conn.Events` until acknowledged; for a plugin session that is the whole backpressure chain | host |
| pty, login environment, cwd, hangup then kill, foreground and cwd queries, window `Owner`, `CloseOwned` | `backend/pkg/terminal` | stay; wrapped as `LocalProvider` (capabilities: resize, all signals, cwd pull, foreground pull, kill terminates, `host_restart` none) | host |
| per-window release | local by T1-go; plugin sessions none (B-88) | the controller stores the owner at create for both and closes on `WindowRealm.OnRetire` | host |
| Wails surface | `CreateTerminal(opts, launch)`, `IsBusy`, `GetCwd`, `WriteTerminal`, `ResizeTerminal`, `AckTerminal`, and `CreateSession(plugin, connection, opts)` | **one**: `CreateTerminal(target, opts, launch)` with `local` or `{plugin, connection}`; the other calls become provider-neutral (T1-go's names kept so the UI in flight does not move); the CLOSE payload and `terminal.Session` have one shape; the old `CreateSession` stays only for the legacy UI until the flip | host |
| the legacy lane | `CreateSession(plugin, ...)` | a `LegacyProvider` adapter over protocol-1 plugins: capabilities all false, facts `unknown`, End `unknown` (deleted at the flip) | host |

**What the local provider must expose identically (prior-art study 6.4).** The same scanner (one implementation, X4a's, imported by the host, never a second one), the same offsets on every event, the same atomic attach reply (`Opened.replay`), `Detach` separate from `Close`, and `Dropped` and `Ended` with `output`, `last_offset` and `mode_reset`; what is local-only is a **capability, stated as one**: pull-mode cwd and foreground, all signals, `kill = terminates`, `exit_report = CODE_AND_SIGNAL`, `stall = PROPAGATES`, `host_restart = none`. T1-go's `End`, `Foreground` and `Directory` JSON names are the ones the SDK adopts, so merge order does not matter; `lost` has no producer locally (a local pty cannot lose a connection), and the UI handles it as it does for plugins. Steps: H1a-2 (offsets, the atomic attach, detach, ordered input and credit in front of every provider) and H1c (the scanner, the modes, marks). **The shell-start contract is not part of this:** the study's pitfall 1 (a login shell started twice and the PATH order) belongs to `internal/shellenv` and the host; X5's helper starts one process with a cleaned environment and `IUTF8` on the master and does not copy it.

What differs between a local shell and a plugin session is capability, not code path: foreground (local pull; plugin none or push), cwd, signals, survival, the pid. The UI reads the capability and shows or hides; for an `unknown` it shows nothing and asks where it must (T1 decision 3). `terminal.Session` is composed by the host from the SDK's facts plus the host's own limits (queue bounds, flow marks), so the SDK carries no host transport detail.

**Two details to get right.** (1) T1-go is on a branch and not merged at the time of writing; the SDK types adopt its JSON names precisely so that the merge order does not matter. (2) The T1-go `End.closed_by` has `request`, `window`, `shutdown`; the SDK adds the values only a plugin can know and the host keeps `window`; a consumer treats any value it does not know as "closed" (never an error).

## 6. Compatibility

### 6.1 Which lane is exec: lenient or strict? Both, by message

| Message or RPC | Reader | New field | Evidence |
|---|---|---|---|
| `SessionOptions` (create), `ResourceSessionResponse`, `PlanNativeCommandResponse` | **strict**: unknown field is `UNSUPPORTED` through the strict transport envelope; legacy `CreateSession` rejects fields 6-12 | breaks an older peer | `utility_transport.go:strictUtilityRoot`, `transport.go:ValidateLegacyExecWire`, `resource_options.go:validateExecOptionWire`; utility wire `ResourceSessionWireVersion = 2` (`resource_session.go:9`) |
| `StreamInput`, `StreamOutput`, `StreamError`, `Session`, `GetSession*`, `ListSessions*`, `Attach*`, `Close*`, `Resize*`, `ExecHandler`, `GetSupportedResourcesResponse` | default protobuf: **lenient** | ignored by an older peer; a new `StreamSignal` value decodes to `NONE` (an empty-data frame) | `exec.pb.go`; `NewStreamSignalFromProto` (`stream.go:117-144`) |
| the new `omniview.sdk.exec.v2` service | requests strict, frames lenient, gated by `Describe.features` | additive by design | 4.3 |

So adding `size`, `cwd` or `env` to the legacy `SessionOptions` is a breaking change for an older plugin, which is why the design does NOT extend the legacy lane: a new service is the only way to add exec features without the bump.

### 6.2 What is additive now and what needs the bump (add to SDK0 section 3.3)

**Additive, no bump, ride tag T2** (SDK0's additive batch): the whole of `exec.v2` (X1-X4b: the service, `Describe`, `Options`, `Open`, `Run`, `RunStream`, replay, detach and lease, the scanners, the integration bootstrap), the `exectest` additions, the lifecycle primitive, the legacy repairs (X0: a ring, one sink per stream, deterministic stream end, drain before close; behaviour fixes in the SDK that a plugin gets when it rebuilds). An older host never calls the new service; an older plugin answers `Unimplemented` and the host stays on the legacy lane with `unknown` facts, which is the rule SDK0 already states (a consumer treats absence as unknown and never reconstructs). The second pass added fields and enum values only inside the new service, so this paragraph is unchanged in substance; the host's typed-event additions are optional fields.

**Deleted only at the flip (add to the batch as one row, B7):**
- B7a SDK: the legacy `ExecPlugin` service (ten unary RPCs and `Stream`) and its messages; the flat `proto/exec.proto`; Go API `Provider`, `Handler`, `TTYHandlerFunc`, `CommandHandler`, `SessionHandler`, `SessionOptions`, `Session`, `SessionResizeInput`, `StreamInput`, `StreamOutput`, `StreamSignal`, `StreamError`, `StreamResize`, `ExecError`, `ExecSessionError` and its codes, `OutputBuffer`, `OutputSink`, `ChannelSink`, `Terminal`, `TerminalFactory`, `NewRealTerminalFactory` and the pty code, the legacy `Manager`, `ResourceSessionWireVersion` (utility wire 2 for exec), `ValidateLegacyExecWire`, the exec entries of `strictUtilityRoot`, and the fake-pipe `exectest` harness.
- B7b rider: `PlanNativeCommand` stays as an independent additive RPC until then; at the flip it moves into the new service unchanged (a move, not a redesign).
- B7c host: `AdapterV1`, `LegacyProvider`, the legacy `CreateSession(plugin, ...)` Wails method, `outputMux`, `case 1` of `dispenseProvider` widened to `1, 2` in S0's plumbing and then collapsed.
- B7d plugins: the legacy `Handlers` registration (Kubernetes K2 removes it on `feature/ui-next` well before).
This is SDK0's rule ("the bump adds, the flip deletes") applied to exec: nothing about exec needs the protocol number to move; the number moves for the resource lane, and the exec deletion rides the same release because the floor then makes every plugin a v2 plugin.

### 6.3 What the shipped Kubernetes plugin keeps doing

v0.21.x on SDK v0.20.0 serves the legacy lane and nothing else. A host on the T2 pin calls `Describe`, receives `Unimplemented`, and uses the `LegacyProvider`: terminals open and run as today, with the shipped defects (the ones X0 fixes are in the SDK build the plugin is compiled with, so the shipped plugin does not get them), facts shown as unknown, the close question asking every time, and a picker that is the plugin's own declared `TargetBuilder` evaluated over the Pod body exactly as today: choices without state (unknown), deleted with the legacy lane. The feature channel installs `feature/ui-next` builds, which adopt the new lane first (K1, K2), so the new UI meets legacy plugins only in local or dev workspaces.

### 6.4 The typed `incompatible` refusal (host PR #659)

It is about a whole plugin whose protocol the host cannot run. It does not apply to a plugin that lacks the exec v2 service: that is a lane-level absence, answered by the legacy path. It does matter at the flip: when the feature or stable floor moves to protocol 2, no protocol-1 plugin loads, so no plugin is legacy-only and B7c is safe to delete in the same host PR. Contract-version skew inside `exec.v2` (a future 1.1) is handled by `Describe.features`, never by `incompatible`.

### 6.5 Tags and risks

Tags: X0 to X4b are additive and ride the next tag cut after they merge (T2 if they are in by then, else a later MINOR); none forces a tag of its own; F1 rides T3 with the cohort. Host consumption of each additive step is its own pin-and-delete PR (SDK0 3.5 hops). Risks: (1) a host pinned on T2 and a plugin on T3 pair in the dual-read window: the new service is the same in both, so nothing breaks; (2) two lanes in one binary for months: the SDK registers the legacy service only if the plugin supplies legacy `Handlers` and the new one only if it supplies `Targets`, so a rebuilt plugin pays for one; (3) the `exec.v2` proto is public the moment it is tagged: freeze it behind the descriptor-digest test (SDK0 V2) from X1 on; (4) a stream per session multiplies HTTP/2 streams on go-plugin's single connection: grpc-go's server has no stream limit by default [INFERENCE: from memory] and the model ran two concurrent streams only, so **the 64-session case is a measured proof in X3, not an assumption**; (5) a plugin that never calls `Started` and writes no output reads as "not started" until it exits: documented, and the Kubernetes target calls `Started` when its size queue is first polled (tty) or before streaming (no tty).

## 7. The steps, ordered by value to the terminal and to agents (each a ready-to-dispatch brief)

### 7.0 Waves, dependencies and what each unblocks

| Wave | Steps (parallel inside a wave; file-disjoint) | Needs | User-visible result |
|---|---|---|---|
| 1 | **X0** SDK legacy repairs; **X1** SDK contract (wire, Go types, validators), `Describe`, `Options`, conformance skeleton | X0 waits for PR C to merge (same files); X1 none | X1: the host and the plugin can write against real types, including the lost end, the exit source, marks with trust, integration, link health and the attach reply; the container picker's data exists |
| 2 | **X2a** SDK lifecycle primitive and engine core; **H1a-1** host provider abstraction, legacy adapter, typed events (with `offset` and `seq`), `GetTargetOptions`; **K1a** Kubernetes `Options` | X1 | the terminal's next slice (Pod exec with a container picker showing real container states) on ONE code path, facts unknown for legacy plugins; the host no longer drops `seq` |
| 3 | **X2b** SDK `Run`; **X3a** SDK `Open` core; **H1a-2** the local terminal as a provider (offsets, atomic attach, detach); **H1a-3** per-window release for plugin sessions | X2a; H1a-1 | one feed for local and plugin sessions; the bounded run exists in the SDK; plugin terminals isolated |
| 4 | **H-run** the agent `run` tool and the UI run action; **K1b** Kubernetes `Exec` for runs; **X3b** control frames; **X3c** replay, detach and lease | X2b; X3a | a bounded, audited, fail-closed `run` tool for Kubernetes first and any plugin next, with a result that can say `lost` and `output unknown` |
| 5 | **H1b** host v2 plugin provider; **K2** Kubernetes sessions on the new lane; **X4a** scanners (marks with trust, terminal modes, ground-state replay start); UI consumes facts | X3a, X3b, X3c (X4a needs X3c) | exit codes with their source, a lost end that is never exit 0, initial size, typed errors, replay by offset with size and modes, isolation, Windows plugin exec |
| 6 | **H1c** the local provider adopts the scanner; **X4b** integration bootstrap for remote shells; **X5** local-process helper; **X6** registry in logs, metric, networker; **F1** the flip deletions; **H-transport** (optional spike) | X4a (H1c: H1a-2, X3c and X4a); F1 needs the cohort | decorations and command history from one scanner for the local shell and, when the user asks, for pod shells; legacy gone |

Sizes (SDK0 scale, whole row across repos): X0 S; X1 M; X2a M; X2b M; X3a M; X3b S; X3c M; X4a M; X4b M; X5 S; X6 three PRs of S-M; H1a-1 M; H1a-2 M; H1a-3 S; H1b M; H1c S-M; H-run M; H-transport M (optional); K1a S; K1b S-M; K2 M; F1 M: **no step above M**. Critical path on the SDK side is X1 (about 5 days: the contract grew in the second pass, and nothing in it runs), X2a (4), X3a (5), X3c (4), then K2 (4): about 22 engineer-days; the host and plugin rows run beside it, and X4a runs beside K2. **Rules for every brief** (as SDK0 section 4): a worktree from `origin/main` of the SDK and the host and from `origin/feature/ui-next` of the plugin; Go with `GOWORK=off GOTOOLCHAIN=local`; tests first and seen red, with the fault removed to show the test is sensitive (rule 28); lint in CI's form (golangci-lint v2.15.0); one commit and one push per PR (save work on a `wip/` branch with no PR until then); every review comment answered in thread; do not merge; never create a tag; never push to the plugin's `main`; no backticks inside double-quoted shell strings; one status file `docs/ui-next/status/SDK2-<step>.md` per step with a Dev tools section.

### X0. Legacy-lane repairs (SDK, S)

**Why first:** four defects the baseline proves, each a few lines, each helping the shipped plugin's next SDK build and the host's local terminal (it calls `sdkexec.NewDefaultOutputBuffer`). **Not here:** the head-of-line blocking (R4) and the attach race (R6): the new lane removes them by construction, and the plan states the residual risk for the shipped plugin.
**Branch/base:** `fix/exec-legacy-repairs` on SDK `origin/main` **after PR C merges** (it edits `manager.go`, `plugin_server.go`, `plugin_client.go`, `session.go`, `export_test.go`).
**Files owned:** `pkg/v1/exec/{buffer.go,buffer_test.go,sink.go,sink_test.go}`, the `Stream` and `cleanupSession` sections of `manager.go`, the `Stream` of `plugin_server.go`, new `pkg/v1/exec/legacy_repairs_test.go`. **Not:** the proto, `exectest`, the resource lane.
**Contract:** (1) `OutputBuffer` becomes a real ring: one backing array, `Append` costs O(len(data)) and allocates nothing after warm-up, `GetAll` copies once, a `Total()` counter; the API is unchanged. (2) `Manager.Stream` binds delivery to the stream that called it (a sink per stream; the previous one is retired): a second stream gets all of the output. (3) The end of a stream by EOF, error or cancel cancels the sessions it served once, in one place. (4) `cleanupSession` closes the slave side, drains the master to EOF (bounded 500 ms), then closes it; the CLOSE frame follows the last data.
**Tests first (red on `origin/main`):** `TestSecondStreamDeliversAllOutput`, `TestStreamEndByEOFCancelsItsSessions`, `TestTailIsDeliveredBeforeClose` (64 KiB then an immediate end, 200 runs), `TestRingAppendDoesNotAllocate` (`testing.AllocsPerRun` and a `-benchmem` benchmark), each taken from the baseline harness.
**Proof (same harness, same machines):** bytes allocated per byte delivered <= 4 (from ~1,000 on macOS, 250 on Linux); CPU <= 25 ms/MB (from 230-395 / 89-107); flood throughput >= 3x; second stream 100% (from 50%); EOF leak 0 of 100 (from 100); tail 0 of 1,000 (from 22-54 of 60).
**Deletes:** nothing consumer-side. The release note says the behaviour changes (a stream end now cancels its sessions deterministically).

### X1. The contract (SDK, M)

**Branch/base:** `feat/exec-v2-contract` on SDK `origin/main`. **Additive; no runtime beyond `Describe` and `Options`.** The whole step reads as: the proto, the Go types and validators, the skeleton of the conformance suite.
**Files owned:** `proto/exec/v2/exec.proto` (the text of 4.3, saved as `SDK2-exec-lane-assets/exec_v2.proto.txt`, checked with `buf build`) and its generated Go (`buf generate`); `pkg/v1/exec/{target.go,proc.go,request.go,facts.go,limits.go,errors_v2.go,describe.go,options.go,client.go,register_v2.go,transport_v2.go,plugin_server_v2.go,modereset.go,secret.go}`; `exectest/{faketarget.go,conformance.go,clientsuite.go}` (the suite with every case of 4.8, numbered 1-24, named and skipped with the step that fills it); `docs/exec.md` (the authoring guide: the function, the capability table, the conformance recipe, the Kubernetes example); `.golangci.yml` (the `forbidigo` pattern for `sync.WaitGroup` in `pkg/v1/**`, 4.7); the descriptor-digest golden entry (SDK0 V2, shared with S4); `testdata/compat-v0.21.0/exec/**` (recorded legacy frames). **Not:** any legacy file, `pkg/resource/**`, the scanner and the bootstrap (X4a, X4b), any behaviour of `Open` or `Run`.
**Contract:** the proto of 4.3 and the Go API of 4.4 exactly. The second-pass additions are listed so a reviewer can tick each one:
1. **The end.** `End` holds exactly one of `exited`, `signaled`, `closed`, `failed`, `lost{cause}`; `Exited` and `Signaled` carry `ExitSource`; `Ended{output, last_offset, mode_reset}`. Go: `Exit{Code, Signal, SignalNumber, Source, Lost}` with `ExitCode`, `ExitSignal`, `ExitFolded`, `ExitTransport`, `ExitLost`; a validator that rejects an `Exit` with both a code and `Lost` and reports an empty `Exit{}` as `Failed{INTERNAL}`, never as exit 0.
2. **Capabilities.** `exit_report`, `stall`, `link_health`, `integration` beside the earlier ones; registration refuses a target with a `Session` whose `exit_report` or `stall` is UNSPECIFIED, so an author declares a behaviour instead of inheriting one.
3. **Marks and integration.** `Mark{kind, at_offset, exit_code, cwd, command_id, command_line, trust, duration_ms, redraw}` with `MARK_INPUT_START`; `MarkTrust`; `IntegrationRequest{mode, consent}`, `IntegrationMode`, `IntegrationFacts{mode, nonce}` where the Go type of the nonce prints `«secret»` from `String`, `GoString`, `MarshalJSON` and `slog.LogValuer`; `IntegrationTier`, `Fact{tier}`, `Reason CONSENT_REQUIRED`, `Notice INTEGRATION_IGNORED`, `FEATURE_MODES`, `FEATURE_INTEGRATION`.
4. **Attach, detach, link.** `Opened{facts, replay}` with `Replay{start, end, bytes, start_size, start_modes, size, modes}` and `TerminalModes{known, ...}`; `Detach{lease_ms}`, `Detached`; `SessionInfo.{link, lease_expires_unix_ms}`; `Link{state, silent_ms}`; `Dropped.mode_reset` and `DROP_EAGER_DRAIN_OVERFLOW`. Go: `Conn.Detach(lease time.Duration)`, `Proc.Link(LinkState)`, `Started{Term, Transport}`.
5. **Run.** `OUTCOME_LOST`, `OutputAccount.completeness`, `RunResult.exit_source`, `RunLimits.post_exit_drain_ms`.
6. **`ModeReset`.** The fixed full-reset string (alt screen off, mouse tracking and encodings off, bracketed paste off, application cursor off, focus events off, cursor shown, kitty keyboard stack popped) as an exported constant with a golden test, for the host's local provider to use too.
7. **Registration and serving.** `PluginOpts.Targets` validated (duplicate routing keys, a missing `Exec`, unknown integration modes); `Plugin.GRPCServer` registers the v2 service when a target exists; `Describe` and `Options` served (`Options` is admitted like any utility call: the connection lease and the route check through `resourcev2.WithUtilityConnection`; it runs the author's callback, bounded: <= 256 choices, `detail` and `kind` match `^[a-z0-9_.-]{1,40}$`); strict admission of `Start`, `RunRequest` and `Target` (sizes, NUL, ids, env names, argv; a non-OFF `integration` without `consent`; `FEATURE_INTEGRATION` and `FEATURE_MODES` only after `Describe` lists them); `Open`, `Run`, `RunStream`, `ListSessions`, `ReadOutput`, `EndSession` answer `Unimplemented` and `Describe.features` is empty until a later step lists a feature; `PluginClient.V2()` returns a `Client` whose calls on a legacy-only plugin fail with typed `UNSUPPORTED`.
**Tests first:** (a) wire, both directions over a real socket: a frozen v0.21.0 client against the new server (every legacy RPC byte-identical), the new client against a frozen v0.21.0 server (`Describe` is typed `UNSUPPORTED`, no crash); (b) strictness: an unknown request field is `UNSUPPORTED`, an unknown frame kind is ignored and counted, and **an unknown enum value** in `MarkTrust`, `ExitSource`, `LostCause`, `LinkState`, `OutputCompleteness` or `IntegrationTier` decodes without error and reads as the safe value (UNVERIFIED, never NONCE; UNKNOWN, never COMPLETE; never a verified PROCESS status); (c) admission tables and a decode fuzz of `Start` and `RunRequest` (no panic, bounded allocation); (d) `buf breaking` against v0.21.0 clean under FILE, WIRE_JSON and WIRE; (e) the descriptor digest changes only with an edit of the contract version; (f) an exhaustive table that every `End` kind, `ExitSource`, `LostCause`, `MarkTrust` and `OutputCompleteness` maps both ways between Go and the wire and that no Go value maps to an UNSPECIFIED wire value; (g) the secret type: `fmt` (`%v`, `%+v`, `%#v`), `slog` and `json` of an `IntegrationFacts` print no nonce (canary); (h) the golden bytes of `ModeReset`; (i) the skeleton lists cases 1-24 of 4.8 as skipped.
**Proof:** vet, lint, the three-OS exec job; `buf build` of the proto in CI; a throwaway Kubernetes plugin branch compiles `podOptions` and `podExec` against it, including the exit switch of 4.4 (no behaviour).
**Unblocks:** H1a-1 (host types), K1a (Options), the UI's picker, the conformance skeleton every later step fills.

### X2a. The lifecycle primitive and the engine core (SDK, M)

**Branch/base:** `feat/exec-v2-engine` on SDK `origin/main` after X1. No RPC beyond X1's.
**Files owned:** `internal/session/**` (the registry of 4.7 on `internal/producers`), `internal/lifecycletest/**`, `pkg/v1/exec/{engine.go,pipes.go,classify.go,telemetry.go}`, `exectest/stress.go` and extensions of `faketarget.go`. **Not:** X1's proto, legacy files.
**Contract:** the registry; the supervisor (`Admit`, the author's function in a goroutine owned by the entry, the bounded stdio pipes (the output pipe's full policy follows `Capabilities.stall`: `Write` blocks when full for `STALL_PROPAGATES`, drop-oldest with counted drops for `STALL_LOSSY`; Read returns what is queued), cancellation, exit and error mapping through `Classify` and the SDK's classifiers for context, net and gRPC errors, `Started` semantics, the typed End, session span and log fields, diagnostics metrics); the connection lease and its retirement; an in-process entry point the next steps and the tests drive.
**Tests first (red; the registry's also red against a naive `WaitGroup` stand-in, as T1-go did for its queue):** the registry with both orders of every crossing forced with `Freeze` (admit vs close, end vs last producer, `Go` after end); the lifecycle hammer; conformance 9 and 14 at engine level; pair P5; the canary (a string in `Error.Err` never leaves the process).
**Proof:** stress 30 s plain and 30 s `-race` clean with the invariant of 4.8; 1,000 sessions opened and ended leave 0 goroutines; the pipes carry >= 1 GB/s in process and `Write` blocks at the bound.
**Unblocks:** X2b, X3a.

### X2b. `Run` and `RunStream` (SDK, M)

**Branch/base:** `feat/exec-v2-run` after X2a.
**Files owned:** `pkg/v1/exec/{capture.go,run.go,run_server.go,run_client.go}`, `exectest/conformance_run.go`. **Not:** the engine files.
**Contract:** 4.6 exactly: argv validation, mandatory bounds, head and tail capture with exact `OutputAccount`, `valid_utf8`, timeout, cancel, concurrency limit, `remote_may_survive` from `Capabilities.kill`, `RunStream`; `Describe.features` lists `RUN_STREAM`; the typed refusals as gRPC status with facts.
**Tests first:** the capture property test (random chunking and caps: `kept + dropped == total`, head and tail exact, a multi-byte sequence cut at the cap); conformance 13 and 15; pairs P1 and P3.
**Proof:** `Run` of 64 MiB with a 256 KiB cap: heap flat (<= cap + 1 MiB by `ReadMemStats`), at the transport's rate (>= 300 MB/s); a timeout returns within timeout + 100 ms; 64 concurrent and 1,000 sequential runs leave 0 goroutines and 0 descriptors; the short stress on the three-OS matrix.
**Unblocks:** H-run, K1b.

### X3a. `Open`: the core of the interactive session (SDK, M)

**Branch/base:** `feat/exec-v2-open` after X2a.
**Files owned:** `pkg/v1/exec/{session_v2.go,frames.go,open_server.go,open_client.go,keepalive.go}`, the SDK's server and client keepalive options in `pkg/sdk`, `exectest/conformance_open.go` (cases 1-5, 9, 12, 13). **Not:** legacy files.
**Contract:** a stream per session; `Opened`, `Started`, `Output` (64 KiB frames, adaptive batching, offsets as a counter), `Notice`, `Ended`; ordered input; flow control both ways; limits and typed refusals; keepalive (server enforcement policy and client parameters set together, because a client that pings faster than the server's policy allows is told to go away with `ENHANCE_YOUR_CALM` [INFERENCE: grpc-go's documented default, not run]); `Client.Open` and `Conn` for these frames; `Describe.features` lists the interactive features implemented so far.
**Tests first:** conformance 1-5, 9, 12, 13 (each red until written); the baseline defects rewritten as by-construction tests (tail, short command, second connection, stream end); the stress with the invariant; the whole suite on the Windows leg (no pty).
**Proof (3.6):** flood >= 300 MB/s and <= 4,100 frames, CPU <= 15 ms/MB, <= 4 B/B; echo p95 <= 150 / 250 µs; both isolation cases p95 <= 2 ms; tail 0 of 1,000; no attach race 0 of 1,000; the same suite green on macOS, Linux and Windows, throughput on the first two.
**Added in the second pass:** `Capabilities.stall` is honoured (4.5): for `STALL_LOSSY` the output queue becomes drop-oldest and never blocks the author's `Write` for more than 50 ms (the queue is the ring's precursor: X3c makes the queue and the replay ring one structure), an overwritten range is `Dropped{EAGER_DRAIN_OVERFLOW}` and `Ended.output` is `TRUNCATED`; `Proc.Link` becomes `Link` frames on a change; `Ended.last_offset`; the typed `Lost` end when the author returns `ExitLost` or the stalled link gives up (`LOST_LINK_DEAD`). Tests: cases 16-18 and 23 of 4.8 and the stress additions. Proof: a `STALL_LOSSY` fake whose consumer sleeps 5 s in the middle of a flood loses nothing the queue holds, reports the exact count, and its writer is never blocked past 50 ms (the legacy lane blocks the executor without bound).
**Unblocks:** X3b, X3c, H1b.

### X3b. Resize, signals, stdin EOF, fact queries (SDK, S)

**Branch/base:** `feat/exec-v2-control` after X3a. **Files owned:** `pkg/v1/exec/{resize.go,signals.go,facts_query.go}` and the matching cases of `exectest/conformance_open.go` (6, 7, 8). **Contract:** 4.5's resize (latest wins, never blocks, `Resized{seq, size, result}`, initial size first), signals only as declared and a typed refusal otherwise, `CloseInput`, `Close` graceful and kill with the declared grace, `Query` and `Fact` for the capabilities that declare them. **Proof:** six resizes of a non-draining session: another session's echo p99 <= 2 ms and every resize acknowledged or typed-ignored (baseline p99 456-460 ms); `Close` kill ends a stuck author within its grace; `remote_may_survive` agrees with the capability. **Unblocks:** K2.

### X3c. Replay, reattach, lease, tombstone (SDK, M)

**Branch/base:** `feat/exec-v2-replay` after X3a. **Files owned:** `pkg/v1/exec/{ring.go,replay.go,lease.go}`, the unary `ListSessions`, `ReadOutput`, `EndSession`, and cases 10, 11, 21 and 22 of `exectest/conformance_open.go`. **Contract (4.5 "Replay, reattach, lease"):** the byte ring in whole 64 KiB chunks with absolute offsets, a size log (every applied resize with the offset it applied at, bounded to the ring) and `Dropped` accounting (detached overflow and eager-drain overflow drop the oldest chunk and count it; an attached `STALL_PROPAGATES` session never drops); **the atomic attach reply**: `Open{attach}` answers `Opened{facts, replay{start, end, bytes, start_size, size, modes{known: false}}}`, then exactly the bytes `[start, end)`, then the live stream, with the snapshot and the registration of the stream under one lock and the older stream superseded; **detach separate from destroy**: `Detach{lease_ms}` answers `Detached{lease_expires}` as the last frame of the stream, a broken stream is an implicit `Detach` with the default lease, `Close` and `EndSession` destroy; the lease with its default (5 minutes) and maximum, `SessionInfo.lease_expires_unix_ms`; `ReadOutput` cursor reads; the 60-second tombstone; `FEATURE_REPLAY` listed. `start_modes` and `modes` stay `known = false` and the replay start is a chunk boundary until X4a adds the ground-state rule and the tracker. **Tests first:** pair P2 (attach after detach equals one uninterrupted open, bytes and offsets, under a flood, with an attach at 1,000 random moments: `bytes == end - start` every time, no byte twice, none missing); a dropped range reported exactly; `start_size` equals the size in force at `start` (a resize storm during the flood); the lease ends a detached session at its fake-clock timeout and a `Detach{lease_ms}` above the maximum is clamped and reported in `Detached`; a tombstone read after the end; `Detach` then `Close` and `Close` then `Detach` reach the same final state. **Proof:** **64 concurrent sessions on one connection** (a measured proof, not an assumption) at the same per-session numbers; a 1 MiB ring under a 64 MiB flood allocates nothing after warm-up. **Unblocks:** H1b, H1c, K2 (reload), X4a.

### X4a. Scanners: marks with trust, terminal modes, a ground-state replay start (SDK, M; after X3c)

**Branch/base:** `feat/exec-v2-scanner` after X3c. **Files owned:** `pkg/v1/exec/scan/{scanner.go,marks.go,modes.go,nonce.go}` (an importable package: the host's local provider uses the same code, never a second scanner), the hook in `session_v2.go`'s output path and a field in `ring.go`'s chunk (the only edits to X3a and X3c files), `exectest/conformance_scan.go`.
**Contract:** ONE streaming tokenizer (ground, ESC, CSI, OSC, DCS/APC/PM strings, UTF-8; BEL and ST terminators; a sequence cut across frames; bounded state; malformed input ignored) feeding three opt-in consumers that never change a byte: (1) **marks** (`FEATURE_MARKS`): OSC 133 `A`, `B`, `C`, `D`, OSC 633 `E` and `P;Cwd`, OSC 7, into `Mark{kind, at_offset, exit_code, cwd, command_id, command_line, trust, duration_ms, redraw}`, tolerating `D` without `C`, a repeated `A` and the 133 that p10k, starship and oh-my-zsh emit on their own; **two trust tiers**: `NONCE` only when the session's nonce verifies (compared in constant time, never copied into a mark, a log or a span), `UNVERIFIED` otherwise; `command_id` assigned per session and equal on the marks of one command; `command_line` at most 4 KiB and only with trust; (2) **modes** (`FEATURE_MODES`): alt screen (`?1049`, `?1047`, `?47`), bracketed paste, application cursor, focus events, cursor visibility, mouse tracking and encoding, the kitty keyboard stack, kept per ring chunk so `Replay.start_modes` is exact and `modes` is current, and `Ended.mode_reset` and `Dropped.mode_reset` reset exactly what was set; (3) the **ground-state boundary**: the ring trims only to a chunk boundary at which the tokenizer is in the ground state, so `replay.start` never lands inside an escape sequence or a UTF-8 sequence (an OSC longer than the ring is the one case where the front waits for its end). `Fact{INTEGRATION_TIER}` is pushed when the observed tier changes (NONE, BASIC, RICH).
**Tests first:** property and fuzz tests (no byte changed, no panic, bounded memory, a split at every offset gives the same marks); a table of foreign sequences; a forged mark in a file that is `cat`-ed into the session is `UNVERIFIED`, the same with the right nonce is `NONCE`, with a wrong one `UNVERIFIED`; the mode tracker against what real full-screen programs emit (vim, less, tmux, htop, recorded as fixtures); a replay that starts after a dropped range begins at a ground boundary and `start_modes` equals what a fresh tracker computes over the dropped prefix; the nonce canary (it appears in no log, span, error or frame but `facts.integration.nonce`).
**Proof:** scanner throughput >= 1 GB/s; the flood proof of X3a does not regress with all three consumers on (still >= 300 MB/s and <= 15 ms/MB); memory per session grows by tens of bytes per chunk. **Unblocks:** H1c, X4b, K2's decorations.

### X4b. Integration bootstrap for remote shells (SDK, M; after X4a)

**Branch/base:** `feat/exec-v2-integration` after X4a. **Files owned:** `pkg/v1/exec/integration/{bootstrap.go,embed.go,scripts/bash.sh,scripts/zsh.sh,scripts/fish.sh}`, the admission of `Start.integration` in `open_server.go`, `exectest/conformance_integration.go`.
**Contract:** (1) **clean-room scripts**, written from the protocol and not copied: iTerm2's, Ghostty's and kitty's scripts are copyleft, and iTerm2's own zsh script does nothing unless `TERM_PROGRAM` is empty, `iTerm.app` or tmux [note: the prior-art study, section 5, pitfall 5]; each emits the nonce inside its marks, drops the variable after reading it where the shell allows, and coexists with `bash-preexec`, p10k, starship and oh-my-zsh (no duplicated marks, no flicker); (2) `Bootstrap(argv, nonce) []string` builds `[sh, -c, <script>, --, <the requested argv...>]` with the script and the nonce in argv (never typed into the user's tty: a typed bootstrap is what recurs in Warp's bug list, warp#7099, #15653, #16630 [note]); the script then `exec`s the requested shell, so the session is the process the user asked for; (3) admission: a mode other than OFF needs `consent` and a target that lists it (`CONSENT_REQUIRED`, `UNSUPPORTED`); the author never sees the nonce, `Request.Argv` is the wrapped argv and `Request.Integration.Mode` says so; an image with no `sh` or a read-only filesystem falls back to the plain program with `NOTICE_INTEGRATION_IGNORED` and tier NONE; (4) **one script set**, shared with the host: the terminal bar's local injection (T5: `ZDOTDIR`, `--rcfile`, `XDG_DATA_DIRS`) imports `exec/integration/scripts`; if T5 lands first, this step moves its scripts into the SDK in the same bytes; two copies are not allowed.
**Tests first:** a bash fixture container: tier RICH, `command_line` and `exit_code` right, the user's own `PROMPT_COMMAND` preserved, nothing of its own printed on the tty; an `ash` fixture and a distroless fixture: tier NONE and no crash; no `consent`: refused; a corrupted payload leaves a working shell; the nonce canary. **Proof ([INFERENCE] today: nothing here was run in a pod; a one-day spike before the step is sized):** on kind, `kubectl exec -it` with the wrapper reaches the first prompt within one extra exec round trip and the first prompt carries a mark; the argv is visible in `ps` inside the container (documented and accepted for a single-use nonce). **Unblocks:** K2 declares `Capabilities.integration`; the UI's opt-in pod decorations.

### X5. Local-process helper (SDK, S) and X6. The registry in logs, metric, networker (SDK, M)

X5: `exec.LocalProcess(ctx, p, cmd)` runs an `*exec.Cmd` on a pty (unix) with size, resize, hangup then kill and typed exit or signal: for plugins that run a local process and for a real-pty conformance rig. **Added in the second pass (agents and the shell start):** the child is a session leader in its own process group; a timeout or a cancel sends `SIGTERM` to the group, waits a short grace (50-200 ms, a parameter), then `SIGKILL` to the group (Codex and Gemini do this [note]; the host's local terminal takes 1.5 s today); the drain of the pipes after the exit is bounded (`post_exit_drain_ms`) because a grandchild can hold them open; `IUTF8` on the master and one start of the program with a cleaned environment (no login shell re-run; the host's shell-start contract, pitfall 1 of the study, belongs to `internal/shellenv` and is not copied here). Tests: a grandchild that holds the pipe cannot keep a run past its bound; a child that moved to a new session is still killed with the group; 200 start-and-kill cycles leave 0 processes and 0 descriptors. Windows ConPTY later (open question 5). X6: three PRs, one for each lane, each adopting `session.Registry`, each running the lifecycle hammer, the `forbidigo` rule then turning strict; PR C's `producers.Group` stays the primitive underneath.

### H1a-1. Host: the provider abstraction, the legacy adapter, typed events, `GetTargetOptions` (host, M; after X1)

**Branch/base:** `feat/terminal-providers` on host `origin/main`.
**Files owned:** `backend/pkg/plugin/exec/{controller.go,provider.go,legacy_provider.go,events.go,service_wrapper.go}` (the legacy `CreateSession` stays beside the new surface), the bound methods in `internal/auditgate/policy.json`, regenerated bindings, `packages/omniviewdev-runtime/src/{exec.ts,models.ts}`, `docs/ui-next/status/SDK2-H1a-1.md`. **Not:** `ui-next/**` (TerminalTool's), `backend/pkg/terminal/**` (T1-go's), `backend/pkg/plugin/resource/**`.
**Contract:** the controller holds providers behind one interface (the SDK's `exec.Client` shape; `legacy` now, `local` in H1a-2, `v2` in H1b); `LegacyProvider` over protocol-1 plugins (capabilities all false, facts and End `unknown`); a plugin's stop or crash ends each of its sessions with a typed `End` in the window (H2); delivery per session with no shared FIFO for non-legacy providers (a legacy plugin still shares its SDK stream: stated); `ListSessions` tolerant of one failing plugin (H3); every exec error through the public-text gate (B-97); `GetTargetOptions(plugin, connection, reference)` calling `Options` (typed choices with state, or the plugin's own `TargetBuilder` choices with state unknown for a legacy plugin); one `Size{cols, rows}` (H5).
**Tests first:** `RunClientSuite` against `LegacyProvider` (asserting the unknown path); a plugin stop yields one typed End per session; a failing plugin does not fail `ListSessions`; a B-97 canary (a hostile string in a plugin's `StreamError` and stderr reaches no event, log or span); pair P6 (the legacy adapter equals the new lane on the same fake remote, for the bytes).
**Proof:** `check:bindings-check`; the seam in both engines; the host baseline harness shows the legacy path unchanged (the number is stated, not improved).
**Added in the second pass (the host stops dropping `seq`):** no `Seq` is read anywhere in `backend/pkg/plugin/exec` outside tests at `origin/main` 77ce06f8 [ran: a grep], so no event can carry a position today. This step adds `offset` (bytes, uint64) and `seq` to the output event and fills them: for the legacy adapter `seq` is the legacy frame's own and `offset` is the adapter's running count, documented as "delivered so far", not a producer position, because the legacy buffer drops silently; H1a-2 fills both exactly for the local provider from the SDK ring (X0's `Total()`); H1b from `Output.offset`. The typed events also gain the optional fields `end.source`, `end.lost`, `end.output`, `mode_reset`, `link`, `replay` and the capabilities `exit_report`, `stall`, `link_health`, `integration`, which the legacy adapter leaves at their unknown values. Tests: a golden of the event JSON (T1-go's names kept, the new ones added); a legacy frame with `Seq` N arrives with `seq` N; offsets are contiguous across a reconnect of the fake. Proof: `check:bindings-check`.
**Unblocks:** the terminal's next slice on one code path; the picker's data in the window.

### H1a-2. Host: the local terminal as a provider; ordered input and credit flow moved up (host, M; after H1a-1)

**Branch/base:** `feat/terminal-local-provider`, on T1-go once it has merged.
**Files owned:** `backend/pkg/terminal/provider.go` (the `LocalProvider`), `backend/pkg/plugin/exec/input.go` (the ordered queue and flow credit, moved from `backend/pkg/terminal/{ordered,flow}.go`), `service_wrapper.go`, bindings, `docs/ui-next/status/SDK2-H1a-2.md`.
**Contract:** section 5: `LocalProvider` implements the SDK's `Client` and `Conn` over T1-go's manager (capabilities: resize, all signals, cwd pull, foreground pull, kill terminates, `host_restart` none); `CreateTerminal(target, opts, launch)` provider-neutral with T1-go's names kept; the ordered queue, `seq`, `INPUT_BACKLOG` and credit flow in front of every provider; the SDK's `End`, `Foreground`, `Directory` types aliased in place of the host's (JSON unchanged, so the generated models do not change).
**Tests first:** `RunClientSuite` against `LocalProvider`; pair P4 (local equals the engine with a pty-backed fake on the same script); T1-go's own tests green and moved with their code; the ordering and flow tests unchanged by the move.
**Proof:** the host baseline harness: echo while another local session floods with Emit at 100 µs: p50 from 443 ms to <= 2 ms; events for the 64 MiB flood <= 4,100 (events of 16-64 KiB; the UI already takes 64 KiB slices).
**Added in the second pass:** the local provider fills `offset` exactly and answers `Attach{from_offset}` with the atomic reply of 4.5 (`start`, `end`, `bytes`, `start_size`, `size`; `modes` unknown until H1c) and `Detach{lease}` separate from `Close`, so that the terminal's reload slice (T2) can treat a window loss as a detach as soon as the UI is ready; until then retiring a window still ends its shells (T1-go's rule is unchanged). Tests: the attach and detach cases (21, 22) of the suite against `LocalProvider`; T1.md's measured race ("about 370 lines differed") becomes a test: attach at random moments under `yes`, replay plus live equals the transcript.
**Unblocks:** the UI's one feed for local and plugin sessions.

### H1a-3. Host: per-window release for plugin sessions (host, S; after H1a-1)

Store the owner (the window identity, as T1-go does) at create for every provider and end the session on `WindowRealm.OnRetire` with `closed_by: window` (B-88 closed for plugin sessions). Tests first: 100 sessions across 20 pages with a fake provider, all 20 retired: 0 sessions left, one `End` each, the 21st page's sessions untouched, the index holding exactly those; a retirement racing a create (25 pages retired at random moments of their own create calls) leaves none. Files: `backend/pkg/plugin/exec/{controller.go,release.go}` and tests.

### H1b. Host: the v2 plugin provider (host, M; after X3a and X3c)

`V2Provider` over `PluginClient.V2()`: client keepalive dial options, a stream per session, host credit mapped to "stop reading `Conn.Events`", ordered input with typed backpressure, reattach and `ReadOutput` for a window reload (offsets join exactly), `Describe` cached and its capabilities mapped to the UI's facts. Tests: `RunClientSuite` against it with the SDK's `FakeTarget` over a real socket; a plugin kill ends every session within the keepalive bound; reload mid-flood: replay plus live equals the uninterrupted transcript.
**Added in the second pass:** the v2 provider forwards `Ended.{end.lost, end.exited.source, end.signaled.source, output, last_offset, mode_reset}`, `Dropped.mode_reset`, `Link` and `Opened.replay` into the typed events unchanged; the UI never infers an end from a closed stream; `lost` is shown as "connection lost, the command may still be running" with Restart, never as exit 0; an `Ended` with `output = UNKNOWN` marks the transcript incomplete. Tests: a plugin kill (every session ends within the keepalive bound as `Failed{connection}`) and a fake target that loses its stream (`Lost`).

### H1c. Host: the local provider adopts the scanner and the atomic attach (host, S-M; after H1a-2, X3c and X4a)

**Branch/base:** `feat/terminal-local-scanner`. **Files owned:** `backend/pkg/terminal/provider.go` (the scanner and the mode tracker in the local output path), `backend/pkg/plugin/exec/events.go` (marks and modes in events), bindings, `docs/ui-next/status/SDK2-H1c.md`.
**Contract:** the local provider imports the SDK's `exec/scan` (never a second scanner), generates its per-session nonce and hands it to the shell integration it injects (T5's scripts, the same bytes as X4b's), emits typed marks, fills `modes` in the attach reply and sends `Ended.mode_reset`; the per-command record of the study (command id, line, trust, exit, cwd, output offsets) is kept in Go from the marks, so "last command" for the UI or an agent is a read of that record and never of rendered rows.
**Tests first:** the marks and modes cases of `RunClientSuite` against `LocalProvider`; the same scripted session through the local provider and through the engine gives the same marks (P4, extended); a forged mark printed by `cat` is `UNVERIFIED`. **Proof:** local flood throughput does not regress with the scanner on (the baseline harness number is stated). **Unblocks:** T2's reload with the screen state restored, "last command" for agents.

### H-run. Host: the bounded agent `run` tool and the UI run action (host, M; after X2b)

**Branch/base:** `feat/agent-run-tool`. **Files owned:** `internal/mcprelay/{exec_tool.go,exec_policy.go,exec_audit.go,resource_exec.go}` plus the `ExecPolicy` field in `policy.go` and the dispatch case in `server.go`; `backend/pkg/plugin/exec/run.go` (`controller.Run`, shared by the tool and the UI action); tests; `docs/ui-next/status/SDK2-Hrun.md`. **Not:** `resource/**` (the credential track's), the plugin.
**Contract:** 4.6 items 2 to 5 exactly: the host-built `exec.Run` operation beside the logs one, the host's own schema, `ReadOnly: false`, never in `read-only`; `ExecPolicy` off by default and for any unknown connection id; confirm on exact argv; a `Confirm=false` override ignored; clamps; two-phase audit with an argv digest and a redacted preview, env names only; typed refusals and fixed words; refused when consent or audit is unavailable.
**Tests first (each with a negative control: the fault removed shows the test red, the assertion removed shows the fault undetected):** not listed when off; refused with no entry, when blocked, when the connection id matches nothing (the H6 case); consent required, denied, timed out, unavailable; clamps; each plugin refusal class mapped; audit intent then outcome, intent only after a cancel, audit failure refuses; **canary secrets** (`--token=CANARY`, an env value, stdin, stdout) in no log, span, audit line or MCP error; a policy revision during an accepted call cancels it; pair: the UI action and the agent tool give the same result for the same bounds.
**Proof:** the seam with a fake exec provider; a real kind cluster with K1b (known output and exit code, a timeout, an output over the cap, a Pod without a shell, RBAC denied).
**Added in the second pass:** the result carries `status` (exited, signaled, timed_out, cancelled, **lost**), `exitCode`, `exitSource`, both streams' `completeness`, `runId` and `remoteMayStillRun` (4.6 item 5); a `lost` result or an `UNKNOWN` completeness is rendered as such and never as success, and the host never retries a run that ended `lost` or whose `remote_may_survive` is true; the audit adds `exit_source` and both completeness values; an allow-pattern (a later step) matches argv elements and is **never persisted for a shell or an interpreter** (`sh -c`, `bash -c`, `env`, `python -c`, `node -e`: consent every time); the anti-hang `env` defaults and the agent marker are the host's policy and go only to a target that takes `env`. Tests: a fake provider that returns `LOST` and an `UNKNOWN` completeness gives a tool result that says so and no retry; the audit line carries the new fields and no content.
**Unblocks:** K1b deletes the plugin's `exec` action.

### H-transport. Host: a Wails transport spike for pty bytes (host, M; **optional**; after H1a-2 and X3a)

**Question:** does moving pty output off events plus base64 onto a binary stream (Wails 3.1.0's `GoStream`, with bounded queues, a blocking `Send` as back-pressure and a reload-aware lease [note: the prior-art study, section 1.4 and rank 11; not run here]) buy anything that the contract's own changes (64 KiB events, offsets, credit) have not already bought, and does it close the in-place reload gap of #658 section 2.6?
**Method, no product code:** a harness in the host's seam beside T1.md's: one local session and one plugin session (the SDK's `FakeTarget`), each flooding 64 MiB into a page that writes into xterm.js and acknowledges. For both transports at event sizes 4, 16 and 64 KiB measure: MB/s to the emulator, host CPU ms/MB, page CPU, bytes allocated per byte (Go and JS), echo p50 and p95 under the flood, resident memory with a stalled page (the bound), and what a window reload does to a live session (events lost, whether the page can resume by offset).
**Decision rule, written before the run:** adopt the stream only if it is at least 2x on MB/s or at most half the host CPU per MB at 64 KiB events, or if it removes the reload gap; otherwise keep events and close the question. **Not here:** any change to the contract (the transport sits below `Conn.Events`). **Evidence home:** `docs/ui-next/status/SDK2-Htransport.md` with the raw outputs.

### K1a, K1b, K2. The Kubernetes plugin (feature/ui-next)

- **K1a (S; after X1):** `Options` for pods (regular, init and ephemeral containers with state and the default-container rule) and the `TargetInfo`; no other change. The picker shows real states.
- **K1b (S-M; after X2b and H-run):** `Exec` for runs (`podExec`, `newExecutor` shared), `Classify` (the ~35 lines that match its own API's errors), and **delete the `exec` action** (`pod_exec_action.go` 261 lines) once the host's `exec.Run` is live. Proof on kind: known output and exit, timeout, cap, no shell, RBAC denied.
- **K2 (M; after X3a, X3b and X3c):** interactive pods and nodes on the new lane: delete `terminalSizeQueue`, `stopCh`, `ExecCmd` and `streamPod`, the duplicated diagnostics, the presentation half of `classifyExecError`, the legacy `Handlers`; the node debug pod's cleanup is a `defer` in `Exec` and the pod carries `activeDeadlineSeconds` so a crash does not leak a privileged pod; the node shell gets a size (the missing `HandlesResize` disappears with the flag). Tests: `exectest.Conformance` over a fake clientset; kind: `stty size` correct at the first prompt, the exit code of `exit 3`, no shell, RBAC denied, 100 open and close cycles leak nothing, the debug pod gone after a close and after a plugin kill. About 450 lines leave.
- **K1b and K2, second pass:** (1) **Errors by type before text:** `Classify` and the exit mapping use `errors.As` on `*apierrors.StatusError`, `utilexec.CodeExitError` and `*httpstream.UpgradeFailureError` before any text match; text matching stays only for the post-upgrade runtime errors that arrive as a bare string (`v4.go:124` [note]); the plugin has no `errors.As` in its exec path today (it string-matches `err.Error()`, `register.go:253-255,266-347` [read]). (2) **The `IsUpgradeFailure` type break:** client-go 0.37 returns the `k8s.io/streaming` type; the plugin is on client-go and streaming v0.37.2 at both `origin/main` and `origin/feature/ui-next` [ran: `git show` of `go.mod`], and both `NewFallbackExecutor` calls (`register.go:258`, `pod_exec_action.go:221`) already pass `k8s.io/streaming/pkg/httpstream.IsUpgradeFailure` [read]; the study's "the plugin is on 0.35" does not hold for these refs. The step keeps it that way: a test that forces a WebSocket upgrade failure and asserts that the SPDY fallback runs (red against a fake that returns the old apimachinery type), and a `depguard` rule against importing `k8s.io/apimachinery/pkg/util/httpstream` in the plugin. (3) **Exit mapping:** `CodeExitError` becomes `ExitCode`, except 129-159, which becomes `ExitFolded` (a signal death the node folded into 128+n cannot be told from a plain exit); a nil error becomes `ExitTransport(0)`; attach declares `exit_report = NONE`, exec declares `CODE`, and both declare `stall = LOSSY`. (4) **A spike with a stop condition, before K2 is sized: can the plugin tell a `Success` status from an empty error channel?** client-go returns nil for both (`errorstream.go:42-50` [read]; k/k#130885 reports exit 0 after a kubelet restart [note]). Try in order: observe the status frame through a transport wrapper; a local copy of the v4 error-channel handler (about 150 lines). If neither works within two days the plugin ships `ExitTransport(0)` for nil and the UI says "ended", never "exited with code 0"; if one works, an empty channel is `ExitLost(NoStatus)`. Acceptance on kind (a test, not a claim): restart the kubelet in the node container during an exec: the result is `Lost` or an error, never `Exited{0, PROCESS}`. (5) **Prime the `TerminalSizeQueue`** with `Request.Size` before its first poll (kubectl does, `exec.go:399-409` [note]); today the plugin's queue is fed only by UI resizes, so the first prompt can be laid out at the wrong size [INFERENCE]; the SDK's `Proc.Resize` is latest-wins and replaces the oldest (kubectl's own queue drops the newest when full, `resize.go:74-77` [note]). (6) **Runs are non-TTY and cancel is detach:** `remote_may_survive = true`, the UI wording for a pod is "detach", not "terminate", and the post-exit drain is bounded by `post_exit_drain_ms`. (7) **Integration:** K2 declares `Capabilities.integration = [ARGV_WRAPPER]` for tty targets with a shell and does nothing else; whether a user ever gets marks in a pod is the UI's consent, default off. (8) `link_health = false` until an honest probe exists; the tail of a Kubernetes stream is protected by `stall = LOSSY`, because the SDK drains eagerly.

### F1. The flip (SDK T3, host, plugins; M)

B7a to B7d of 6.2 in one cohort: the SDK deletes the legacy lane, the host deletes the adapter and the legacy Wails method in the pin PR, the Kubernetes plugin has long since left the legacy `Handlers`. Gate: the descriptor digest, the release table row, the conformance cases in both directions, the floor words ("this plugin needs the new exec lane" is the existing `incompatible` cause: no new word).

## 8. What I would NOT put in the SDK, and why

| Item | Why it stays out |
|---|---|
| terminal emulation, screen state, scrollback rendering, selection, links, search | the emulator is the UI's; the SDK hands it bytes and offsets and never parses a screen. The scanners (marks, terminal modes) read escape sequences only to report facts and to give a replay its size and modes, never to render |
| window ownership and release | the trusted window identity is the host's (`window_realm.go`); the SDK's `labels` and `RequesterID` are diagnostic and must never become authority (SDK0 H4). The SDK gives `End` and the lease as primitives |
| agent policy, consent, allow-lists, the audit sink, redaction of what reaches logs | the trust boundary: "consent, pinning, epoch fencing, call binding: never move" (SDK0 section 5, host AGENTS rule 9). The SDK declares bounds and refuses above them; the host decides who may call |
| the words for errors | the producer supplies class, reason and facts; the host owns vocabulary and recovery (SDK0 H13). The bounded `public_message` is optional and gated |
| the local shell's login environment, shell resolution, default cwd, hangup then kill of the HOST's processes | host-local policy; the SDK's `LocalProcess` helper (X5) carries the mechanism only |
| hidden probing inside a target (running `ps`, reading `/proc`, injecting a shell hook to learn the foreground or the cwd) | side effects, cost and security in someone else's container; a producer reports what it knows natively, else the fact is `unknown` and the consumer asks. **The one exception is the consented integration bootstrap (4.5, X4b):** a fixed script embedded in the SDK, requested by the user for this terminal, visible in the exec's argv, never typed into the tty, never run to probe, and reported back as a fact (`facts.integration`, the observed tier); nothing else is run inside a target on the user's behalf |
| persistence beyond what a target gives (tmux, reconnecting a lost exec stream) | target-specific; an author may run `tmux new -A` as the command and declare `SURVIVAL_TARGET_SESSION`; the SDK promises only what it holds: the plugin process |
| transcript storage, command history, search over history | UI and host features; they consume replay and marks |
| a shell-string builder, quoting or interpolation helpers | argv only; the SDK ships no way to build a shell string from data. The integration bootstrap is the one `sh -c` the SDK passes: its script is fixed text and the requested argv follows it as positional parameters, never interpolated into it |
| sandboxing, network policy or resource limits of a command in a target | the target's and the cluster's; the SDK bounds time and output only |
| ConPTY for the host's own Windows terminal | a host step; the SDK's plugin lane needs no pty at all |
| the Wails event shape and the page's slicing | host transport; the SDK emits few large frames and the host slices for the page |

## 9. Open questions for the owner (six; each with my recommendation)

**Owner answers so far: none.** The lead proceeds on each recommendation below until the owner says otherwise: the agent `run` tool **off** by default with consent on the exact argv; shell integration in the **local** shell on by default with an opt-out, never into remote targets unless the user asks; a 5-minute detach window; the declared client name recorded as unverified; Windows ConPTY after H1a-2; the package path kept. The second pass changed no answer; it changed the text of question 4 only.

1. **The agent `run` tool: default posture and allow-lists.** Recommend: **off for every connection until the user turns it on, and confirm on the exact argv for every call**; allow-patterns (literal prefix, glob per element) in a later step; never part of the `read-only` preset and never overridable to skip consent. A connection id the policy does not know is off.
2. **Audit: may the record carry the MCP client's self-declared name?** The relay knows a credential id and a session id only (a shared bearer is not a named agent). Recommend: **yes, as `declared_client`, stored and labelled unverified, with the credential and session ids as the trustworthy part**; retention local only, append-only 0600 file, size-rotated. Without it "what agent" is not answerable.
3. **The default detach window** (how long the plugin keeps a session whose host stream is gone). Recommend **5 minutes**, extendable by the host to 30 per session: long enough for a reload or a reconnect, short enough that a crashed host does not leave a remote shell for hours. A product promise "your terminal survives a reload" is true; "survives restarting Omniview" is declared false for every exec target and the UI never offers Reattach after a restart.
4. **Shell integration.** Recommend: inject OSC 133/633/7 integration into **local** zsh, bash and fish **by default, opt-out in settings**, through the shell's own startup mechanism without editing the user's rc files; **never inject into remote targets** unless the user asks. For a pod or any remote target "asks" means: an explicit per-terminal choice, with a prompt that says what is sent (a small script passed in the command line of the exec, never typed into the terminal), remembered per connection, and never switched on by a default, a preset or a plugin (the SDK refuses the bootstrap without the host's consent flag: 4.5, X4b). It is the single biggest "exceptional terminal" feature (command decorations, jump to previous command, exit-status gutter, "command finished"); it modifies what runs in the user's shell, so it is your call.
5. **Windows.** The plugin exec lane works on Windows the day X3a ships (no pty). The host's own local terminal on Windows has no ConPTY backend (T1-go answers `UNSUPPORTED`). Recommend: schedule the ConPTY provider as a host step after H1a-2, behind the same contract (the capability set already says what a ConPTY cannot do: no foreground group, no cwd).
6. **Naming at the flip.** The plan keeps the lane's package (`pkg/v1/exec`) and gives the new types non-colliding names, so the flip is a deletion and a few renames rather than an import-path change for every plugin. Alternative: a new package path (`pkg/exec/v2`) with clean names from the first day. Recommend the first (one registration, one convention, no import churn), accepting that the legacy names are awkward for a few releases.

## 10. Verified and not verified; artifacts

**Verified [ran]:** the SDK baseline harness on macOS (Apple M5 Max, Go 1.27.4, load average 2 to 16, several runs) and on Linux arm64 (Docker, `golang:1.27.4-bookworm`); the host controller baseline on macOS; the bare-gRPC ceiling on both; the model of the new data plane on both. The facts of sections 1 and 2 are **[read]** from the code at the bases named above, file and line as cited. T1-go and T1 were read from their branches, not run.
**Verified in the second pass:** [read] client-go v0.37.2 `tools/remotecommand`: `errorstream.go:42-50` (nil for an empty error channel; a Success status also decodes to nil), `websocket.go:57-65` (ping every 5 s, pong deadline 61 s), `websocket.go:310-321` (one read loop; per-stream pipe writes "can block"), `v2.go:81` (stderr only when not a TTY); [ran] plugin `go.mod` at `origin/main` and at `origin/feature/ui-next`: client-go, apimachinery and streaming v0.37.2, with `register.go:17,258` and `pod_exec_action.go:19,221` using `k8s.io/streaming/pkg/httpstream`; [ran] no `Seq` is read in `backend/pkg/plugin/exec` (host `origin/main` 77ce06f8); [ran] the revised proto passes `buf build` (a throwaway copy, removed). **Taken on trust from the study [note]:** every Kubernetes-server, kubelet, containerd, Docker, ssh and product behaviour it cites (the server closing a stream on a slow reader, the 128+n folding, attach having no status, exit 0 after a kubelet restart, Wave's thresholds, Warp's bug list, Codex's and Gemini's kill timings).
**Not verified:** Windows (no run: the SDK's pty factory returns an error there, [read]); a real Kubernetes cluster (every Kubernetes behaviour marked [INFERENCE]: that the node shell gets no size, that a tty exec's shell gets SIGHUP when the stream closes, what ends a non-tty exec); the Wails transport and a native window (T1.md measured the local shell's); the host's per-event Emit cost for a plugin session (the table sweeps 0 to 100 µs; T1.md's local-shell figure of about 40-65 µs sits at the cliff); the grpc-go connection-window behaviour beyond the model; 64 concurrent sessions on one connection (a proof in X3c); the claim that the 4,096-frame queue is what the host's echo waits behind (the arithmetic fits 233 ms and 443 ms, the host harness measured the totals); PR C's final shape (read from its worktree while in progress). `docs/ui-next/status/T-terminal-bar.md` does not exist; VS Code and JetBrains behaviour is [INFERENCE] from memory.
**Not verified, second pass:** the argv bootstrap in any real pod, whether the Kubernetes nil can be told from a Success status, whether a stalled consumer really loses the tail against a real API server (the design assumes the study's report), a Wails `GoStream` (H-transport measures it), and the cost of the mode tracker and the ground-state rule in the flood (X4a's proof).
**Artifacts** (not in this repository): the planning pass's scratch worktrees (`exec-plan-sdk`: plugin-sdk `origin/main` 6885ca6 with untracked `pkg/v1/exec/zz_baseline_test.go` and `zz_model_test.go`; `exec-plan-host`: host `origin/main` 77ce06f8 with untracked `backend/pkg/plugin/exec/zz_baseline_test.go`; `exec-plan-k8s`: `origin/feature/ui-next` 8af576f; `exec-plan-host-t1`: `origin/wip/ui-next/t1-terminal` ee98530d; `exec-plan-host-t1go`: `origin/feat/t1-go-terminal-signals` b7025fe5) and the harness sources, the checked proto and the raw outputs (`zz_baseline_test.go.txt`, `zz_model_test.go.txt`, `host_zz_baseline_test.go.txt`, `exec_v2.proto.txt`, `baseline-sdk-macos.txt`, `baseline-sdk-macos-flood-rerun.txt`, `baseline-sdk-linux-arm64.txt`, `baseline-host-controller-macos.txt`, `model-newlane-macos.txt`, `model-newlane-linux-arm64.txt`) were local files of the lead's machine. The wire proto this plan describes is `proto/exec/v2/exec.proto` in plugin-sdk on `feature/exec-v2`. Nothing was committed, pushed or tagged. PR C's worktree `exec-close-race` and the other agents' worktrees were only read; the Linux runs used `docker run --rm` with the worktree and the module cache mounted read-only (no container is left).
