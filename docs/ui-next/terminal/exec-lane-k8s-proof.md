# SDK2-K-proof: a Kubernetes Pod exec provider on the exec v2 contract (a spike), and what it says about the tag gate

> **Copy for the terminal handoff** (2026-11-24). The lead's spike report `SDK2-K-proof.md` (2026-11-23), copied unchanged except that the scratch path of the rig's raw files was removed (they are not in this repository). The code it describes is on the plugin's branch `wip/spike/exec-v2-provider` (public repository `omniviewdev/omniview-plugin-kubernetes`, no PR). Its verdict is an input to the tag gate (`exec-tag-gate.md`, item B1.3) and to the work on pod exec in the terminal (see the epic).

Agent `K8sSdk0220`, 2026-11-23. A spike: no PR to `feature/ui-next`, nothing tagged, nothing merged. It is the "real provider" that `docs/exec-before-any-tag.md` (SDK `feature/exec-v2`) asks for before any tag: "the Kubernetes compile proof against the real client-go; it decides B1.3 and exercises B1.1".

- **SDK:** `feature/exec-v2` `abbcad0d7fe5a7f2a4d273083c9d30eb4c642012` (contract + engine + `Open` served), pinned in the plugin as `v0.22.1-0.20261123110854-abbcad0d7fe5`. It predates the v0.22.1 repairs (#89), so the legacy lane runs on the older base here.
- **Plugin:** branch `spike/exec-v2-provider` from `origin/feature/ui-next` `2b5e684`, pushed as `wip/spike/exec-v2-provider` (head at the end). Provider in `pkg/plugin/execv2/`; the legacy lane (`pkg/plugin/exec/`) is untouched but for one line that registers the new target beside its handlers.
- **Cluster:** kind v0.30.0, node image `kindest/node:v1.34.0` (containerd 2.1.3), one node, cluster `kproof-exec-v2` (deleted at the end), busybox 1.37.0.
- **Measured two ways.** **[rig]**: through the real plugin binary, launched as the host does (go-plugin, AutoMTLS, broker), with the SDK's `Client.Open` and a frame-aware tap proxy between the plugin and the API server that records what the API server really sends (`hack/kproof/`; raw files and the rig's own tables in a scratch directory, `k-proof-out/`, not in this repository: `RESULTS.md`, `raw/`). **[direct]**: by calling the provider's `ExecFunc` against the same cluster, where no SDK is needed to see what client-go gave (`pkg/plugin/execv2/kind_test.go`, skipped unless `KPROOF_KUBECONFIG` is set).

## 1. Verdict

- **A real Pod provider fits the contract.** Describe, Options, Exec and Classify in **398 lines** (329 code) against the legacy 862 (648 for its Pod-only part). Through the real plugin and `Client.Open` on kind it did what the contract says: TTY and non-TTY, stdout and stderr apart, the size at open (`stty size` 30 100 at the first command, 40 120 after a resize), exit codes, typed refusals, Close and stream cancel, Lost for every break of the API-server leg, and a 64 MiB flood at 170-185 MB/s (kubectl 182-191, client-go direct 176-215). The picker's states predicted exec-ability for 10 of 10 containers.
- **B1.3: do not adopt "PROCESS for a Success".** client-go's `nil` cannot tell a Success from an empty channel, and reading the channel does not help: after a kubelet or containerd restart the API server sends an explicit **Success** for a command that did not exit 0 (8 of 8 sessions through the tap; the provider that reads the channel returned `Exited{0, PROCESS}`, `remote_may_survive=false`, in 4 of 4 that ran). An empty channel with a normal close never occurred in 228 sessions. A Success is "ended normally", not "success": keep an arm for it (`Exited{0, TRANSPORT}` exists and Kubernetes is its producer; a no-code arm is safer), keep non-zero as PROCESS, keep Lost for breaks, and fix the guide, whose `nil` → Lost makes every `exit 0` "lost, may still be running, start not observed" (measured).
- **Other places the contract guessed or could not say** (section 5): `Started` has no trigger for a quiet command; the default choice is not in `Proc.Request.Selection`; Options runs at every Open; typed classification fails for the upgrade's own refusals (403 and 401 arrive as text); a killed container is a plain 137; no `LinkHealth` over client-go; `Stall=LOSSY` drops bytes for a consumer slower than about 100 MB/s; `close_input` is not served, so stdin EOF cannot be exercised through `Open`; attach's `Opened.facts.program` is wrong.
- **Fixed in the provider after the rig found it:** RBAC and 401 refusals (they ended `Failed{INTERNAL}`: client-go hands them over as text) and the kubelet's "pod does not exist".

## 2. What was built

`pkg/plugin/execv2/`: `target.go` (Describe: routing key `kubernetes` / `k8s:/pods`, capabilities, the two modes), `options.go` (Options), `podexec.go` (ExecFunc, incarnation check, default container), `classify.go` (Classify), and two spike-only files that are not the provider (`spike.go`: trace and the nil-arm knob; `ownexec.go`: an executor that reads the status channel, section 4).

| | lines (raw / code) |
|---|---|
| **new provider** (`target.go` 49, `options.go` 109, `podexec.go` 188, `classify.go` 52) | **398 / 329** |
| legacy `pkg/plugin/exec/` set that is "862" (`register.go` 398, `pod_attach.go` 111, `node_handler.go` 214, `client_provider.go` 14, `diagnostics.go` 65, `observability.go` 60) | 862 / 764 |
| the legacy Pod-only part of it (all but `node_handler.go`) | 648 |
| spike-only (`spike.go` 89, `ownexec.go` 192) | 281 |

It does what the legacy Pod path does, plus a command without a terminal, stderr kept apart, an initial size, typed container states in the picker, typed refusals, the incarnation check and the default container. It does **not** do: node exec (the debug pod), the wait for an ephemeral container that is still starting (legacy `waitForDebugContainer`, about 70 lines), the diagnostics/observability spans, the native command (`native_command.go`, 227 lines, a separate action). What leaves the plugin is what the SDK now owns: the session table, the size-queue goroutine, the stop channel, the presentation half of `classifyExecError` (about 80 lines) and the reference/route/metadata validation (`nativeExecTarget`, about 85 lines).

Tests: 11 unit tests (every shape of client-go error mapped, stream options per terminal, the SPDY fallback, classification, container states, the default, the incarnation, and the SDK's own `exectest.Conformance`, green, with the cases of steps not served yet skipped by the SDK) and 7 kind probes in `kind_test.go`. `golangci-lint --no-config`: 0 issues.

## 3. What was measured

Every row is a run through the real plugin and `Client.Open` unless marked [direct]; "3 runs" means three. The rig's own tables, with every frame, are in `RESULTS.md` and `raw/`.

**Describe and Options (S0, S9).** `contract_version` 1; features `SESSION`, `ENV`, `CWD`; one target `kubernetes` / `k8s:/pods`, capabilities TTY, separate stderr, resize, initial size, stdin EOF, `Kill=CLOSES_STREAM_ONLY`, `ExitReport=CODE`, `Stall=LOSSY`, `HostRestart=TARGET_PROCESS`, no env, cwd, signals or link health. Options returns `container` (required) and `mode`; the two modes are served with their own capability sets and `Opened` carries exactly them: exec `HostRestart=NONE`, attach `ExitReport=NONE`, the only two fields that differ (B1.1 works). Picker data against what the API did with `Open ["true"]` on each container:

| pod / container | kind | Options: state, detail | kubelet | exec |
|---|---|---|---|---|
| three / main | container (default) | READY | running | works |
| three / init | init | STOPPED, completed | terminated Completed | refused NOT_RUNNING |
| three / dbg | ephemeral | READY | running | works |
| states / app, side | container | STARTING, creating | waiting PodInitializing | refused NOT_RUNNING |
| states / wait | init | READY | running (an init container that still runs) | works |
| states2 / ok | container (default) | READY | running | works |
| states2 / crash | container | STOPPED, crash-loop | waiting CrashLoopBackOff | refused NOT_RUNNING |
| states2 / pullfail | container | STOPPED, image-pull | waiting ImagePullBackOff | refused NOT_RUNNING |
| states2 / done | init | STOPPED, completed | terminated Completed | refused NOT_RUNNING |

10 of 10 agree: `READY` is exactly "the API accepts an exec". The SDK does not enforce it: it admits a `STOPPED` choice and the API refuses later, as text (5.5).

**TTY shell (S1, S11, S12).** `/bin/sh`, 100x30: `echo` works; `stty size` before any resize `30 100` (3.3 ms after the prompt: the initial size is honoured, so `InitialSize` is true); after `resize` 120x40 `40 120` (3.3 ms); `exit 3` gives `Exited{3, PROCESS}`, `remote_may_survive=false`, `start_observed=true`, `output=COMPLETE`, 77 ms in all. 200 resize frames while `cat` echoes: echo latency median 1.3 ms during the storm (3.8 ms before), max 18 ms, nothing dropped. 20 sequential opens: `Open`→`Opened` median 4.0 ms non-TTY / 5.6 ms TTY (p95 6.0 / 7.2), →first byte 45 / 61 ms, →`Ended` 47 / 66 ms [direct: building the connection's clients 0.25 ms, the Options callback with its GET 2.1 ms, a whole `true` 32.7 ms].

**Ends (S2, S10), 3 runs each, with the default arm (`nil` → Lost).**

| command | End the host saw |
|---|---|
| `echo out; echo err >&2` | `out\n` on STDOUT and `err\n` on STDERR, apart; then Lost, as the next row |
| `exit 0`, `true` | **Lost{NO_STATUS}, `remote_may_survive=true`, `start_observed=false`**; with `KPROOF_NIL=code0` Exited{0, PROCESS}; with `transport0` Exited{0, TRANSPORT}, survival absent |
| `exit 3` | Exited{3, PROCESS}, `remote_may_survive=false`, COMPLETE |
| `exit 137`, `kill -9 $$`, `kill -TERM $$` | Exited{137, 137, 143; PROCESS}: a death by signal is a plain code |
| `/no/such/binary` | Failed{NOT_FOUND, NO_SUCH_EXECUTABLE, stage START, facts program} |
| container `nope` | Open refused INVALID_REQUEST, facts `container=nope` (the SDK) |
| Starting, Stopped, completed-init containers | Failed{UNAVAILABLE, NOT_RUNNING, START, facts container} |
| stale reference (a recreated Pod) | Failed{CONFLICT, TARGET_REPLACED, START} |
| a reference of another type; mode `bogus`; a size without a tty; empty argv[0] | refused by the SDK: UNSUPPORTED / INVALID_REQUEST |
| RBAC denied (a ServiceAccount that may only get Pods), exec, exec with a tty, attach | first build **Failed{INTERNAL}** (client-go hands the 403 over as text); after the fix (`plugin.fix1`, 2 runs each) **Failed{FORBIDDEN, TARGET_DENIED, stage START}** |

**Stdin and Close (S3, S7).** `close_input` is ignored and counted, as the doc says: a `cat` sent `abc\n` and then `close_input` was still running 10 s later. `Close{GRACEFUL}` and `Close{KILL}` both end `Closed{REQUEST}` with `remote_may_survive=true`; cancelling the stream gives no `Ended`, only a CANCELLED stream error. After each of the three, 5 s later, the `sleep 600` was **still running in the container: 18 of 18** (a non-TTY `sleep`, and a `sleep` typed into a TTY shell; 3 runs each): `Kill=CLOSES_STREAM_ONLY` is the right declaration on containerd, for a TTY too.

**Flood (S4), `yes | head -c 67108864`.**

| | MB/s (64 MiB) | result |
|---|---|---|
| `kubectl exec \| shasum` | 182-191 | sha256 matches |
| client-go direct, WebSocket / SPDY | 176-215 / 220-233 | sha256 matches |
| **plugin, a consumer that only counts** | **170-185** (365-398 ms) | 3 of 3 byte-exact, 0 dropped |
| plugin, a consumer that hashes and checks the pattern | 74-92 (717-886 ms) | 1 of 3 sha256 match; 2 of 3 `TRUNCATED` (1.92 MB in 17 ranges, 1.45 MB in 37); received + dropped = 67108864 exactly |
| plugin, a consumer that sleeps 20 ms per frame | ends in 1.0-1.9 s | 1.5-1.7 MB delivered, 65.4-65.6 MB dropped, TRUNCATED |
| plugin, a consumer that stops reading for 5 s after 8 MiB | ends at 5.1 s | 9.9 MB delivered, 57.2 MB (85 %) dropped in 1 range |
| through the tap proxy | 108-149 | 2 of 6 TRUNCATED with the hashing consumer |
| TTY (96 MiB: the pty turns `\n` into `\r\n`), plugin / client-go direct | 3.0 / 2.8-3.2 | byte-exact, sha256 of the translated stream matches, 3 of 3 |

`Dropped` accounting is exact in every run (`bytes_out == last_offset`, `output=TRUNCATED` iff dropped > 0). The lossy arm is real: a consumer slower than about 100 MB/s loses bytes while the session itself never stalls, and Kubernetes has no PROPAGATES (client-go reads all channels in one loop). A TTY moves 3 MB/s whatever the lane: that is the runtime's pty path (client-go direct is the same).

**What ended a session mid-flight (S5, S6), 2-3 runs each.** "Status" is the tap's view of the status channel.

| fault | status | client-go | End the host saw | after |
|---|---|---|---|---|
| container PID 1 `kill -9` from the node | Failure `NonZeroExitCode` 137 | `CodeExitError` | **Exited{137, PROCESS}**, `remote_may_survive=false` | 127-200 ms |
| Pod force-deleted; Pod deleted (grace 1 s) | Failure 137 | `CodeExitError` | Exited{137, PROCESS} | 2.05 s |
| **kubelet restarted; containerd restarted** | **Success**, close 1000 | `nil` | Lost{NO_STATUS}; with the channel-reading executor **Exited{0, PROCESS}** | 50-120 ms |
| API-server leg: FIN / RST | none; close 1006 / reset | error | Lost{NO_STATUS} | 2.0 / 0.7 ms |
| API-server leg silent (blackhole) | none | i/o timeout (heartbeat) | **Lost{LINK_DEAD}** | 58.97 s |
| API server restarted | none; close 1006 | error | Lost{NO_STATUS} | about 30 s (the kubelet takes that long to notice the moved manifest) |

The kill, the deletes and the breaks never end as exit 0. In every Lost: `remote_may_survive=true`, `start_observed=true`, and no `Closed` by CONNECTION_RETIRED got there first. A killed container is `Exited{137}` with source PROCESS: identical to `exit 137`.

**Attach (S8).** `Opened` carries `HostRestart=TARGET_PROCESS`, `ExitReport=NONE`. Typing `exit` into a container whose PID 1 is `sh` ends the attach with a **Success** status: `Lost{NO_STATUS}` (the container's exit code is not on the stream).

## 4. The tag-gate item (B1.3): client-go's nil, "ended normally" and "success"

**The question** (B1.3). `docs/exec.md:223-226` and the tested illustration return `ExitLost(LostNoStatus)` for every client-go `nil`; the review points out that `nil` is also what a Success status looks like, so every successful exec would end "connection lost, may still be running" and an agent `run` could never return success from a pod; it asks to decide with the real executor: if it can read the status channel, PROCESS for a Success and Lost for an empty channel, and delete `EXIT_SOURCE_TRANSPORT` and `ExitTransport`; if not, add a no-code arm ("closed cleanly, status not reported"); "a code on a no-status end is the one shape I would not tag".

### 4.1 Can the real executor read the status channel? No

client-go's `watchErrorStream` (`errorstream.go`) sends `nil` for a Success status and for a channel that closed empty alike, and `remotecommand.Executor` has no hook for the status. The guide's parenthesis ("a plugin that reads the status channel itself can return ExitCode(0) for a Success status") means carrying the v5 channel protocol in the plugin. I did it as an experiment: `ownexec.go`, 173 code lines (read loop, stdin pump with the close signal, resize pump, the 5 s heartbeat with its 61 s read deadline, status decode); it worked at the first run on kind and needs the SPDY fallback kept beside it. On the wire a Success is `{"metadata":{},"status":"Success"}` (34 bytes) and an exit is `Failure` / `NonZeroExitCode` with a cause `ExitCode` (216 bytes).

### 4.2 What the API server puts on the channel, and what each design makes of it [rig tap + direct]

| what happened | status channel (tap) | client-go | provider, the guide's arm (`nil` → Lost) | provider that reads the channel (PROCESS for a Success) |
|---|---|---|---|---|
| `exit 0`, `true`, `echo` | **Success** (34 B), close 1000 | `nil` | **Lost{NO_STATUS}, `remote_may_survive=true`, `start_observed=false`** | Exited{0, PROCESS} |
| `exit 3`, `kill -9 $$`, `kill -TERM $$` | Failure `NonZeroExitCode` 3, 137, 143 | `CodeExitError` | Exited{N, PROCESS} | same |
| container PID 1 `kill -9`ed from the node, Pod deleted, Pod force-deleted | Failure `NonZeroExitCode` **137** (216 B) | `CodeExitError` 137 | Exited{137, PROCESS} | same |
| **kubelet restarted; containerd restarted** mid-session | **Success** (34 B), close 1000 (8 of 8 sessions: 4 kubelet, 4 containerd; [direct]: the exec'd `sleep` is gone after a kubelet restart) | `nil` | Lost{NO_STATUS} (right, by accident) | **Exited{0, PROCESS}, `remote_may_survive=false`: wrong** [rig, 4 of 4] |
| FIN or RST of the API-server leg | none; close 1006 / ECONNRESET | error, 2.0 / 0.7 ms later | Lost{NO_STATUS} | same |
| the API-server leg goes silent | none | error: heartbeat read deadline, after 58.97 s | Lost{LINK_DEAD} | same |
| attach: the container's PID 1 exits with 5 | Success | `nil` | Lost{NO_STATUS} | Lost (ExitReport none) |

Across the whole rig (228 sessions through the tap) the API server ended **192** execs with a status (77 Success, 46 `NonZeroExitCode`, 69 other Failure) and **none** with a normal close and an empty channel; the 36 without a status are our own cancellations (30) and the breaks we injected or caused (6). The "no status" case the guide guards against never occurred; the unknown case arrives as a **Success**.

### 4.3 What it means: "ended normally" is not "success"

1. With client-go alone the two cases are one `nil`.
2. Reading the channel does not make them two: on a kubelet or containerd restart the API server itself answers Success for a command that did not exit 0 (it was killed with its stream: the case the plan's G10 cites as k/k#130885, reproduced here on 1.34.0; the issue itself was not re-read). A Success means **the exec stream ended normally**, not **the command succeeded**. A non-zero status is the command's (46 sessions); a zero status is the API server's word for "ended normally".
3. The review's first option (PROCESS for Success, Lost for empty, delete TRANSPORT) therefore prints `exit 0, PROCESS, remote_may_survive=false` for a killed command: the contract's strongest claim, false, in the one failure class where the exit code matters most to an agent. Its premise ("an empty channel is the unknown case") does not hold either, as the 228 sessions show.
4. The contract already has the arm for this: `Exited{0, TRANSPORT}` ("the transport said the stream ended and the process's own status was not relayed (Kubernetes attach, or exec with an empty error channel)", `exec.proto:1182-1184`, `remote_may_survive` absent). Kubernetes **is** a producer of it, for client-go's nil and for a read Success alike (measured below with `KPROOF_NIL=transport0`). Three places contradict it: the comment of `Exited` ("a stream that ended with none is Lost, never Exited with code 0", `:1222`), the guide (`:223-226`) and the illustration.

Measured wire results of the three arms for a plain `exit 0` / `true` [rig, 3 runs each]: guide (`nil` → Lost): `Lost{NO_STATUS}`, `remote_may_survive=true`, **`start_observed=false`** (a quick silent command is "lost, may still be running, never seen to start"); `KPROOF_NIL=code0`: `Exited{0, PROCESS}`, `remote_may_survive=false`, `start_observed=true`, `output=COMPLETE`; `KPROOF_NIL=transport0`: `Exited{0, TRANSPORT}`, `remote_may_survive` absent, `start_observed=true`, `output=UNSPECIFIED`.

### 4.4 Recommendation for the gate

- **Do not adopt "PROCESS for a Success".** Not for Kubernetes: it is false after a kubelet or containerd restart, and nothing on the wire can tell the two apart.
- **Keep an arm for "ended normally, the command's status not known".** Either keep `Exited{0, TRANSPORT}` (code and source), or, better, replace it with a no-code arm (a new `ClosedBy` value such as `TARGET`, or an `Ended` kind of its own): for Kubernetes the zero carries no information the arm does not, and a consumer that prints the code and drops the source can no longer read it as a success. Either way the producers are real: client-go's `nil`, a read Success, attach.
- **Non-zero stays PROCESS** (`Exited{N, PROCESS}`), `Lost` stays for what really is lost: the API-server leg breaking (FIN, RST, 1006) and the heartbeat giving up. Both were measured and need no new word.
- **Fix the guide's paragraph and the illustration.** "Never exit 0" for every `nil` was measured to make every successful command "lost", with the start not observed; the example should return the transport arm.
- **What an agent `run` can promise on a pod:** "ended normally" or "exit N", never a verified exit 0, with any executor. A verified zero needs an in-band marker (a wrapper that prints `$?` on the data channel, the idea of the integration argv wrapper), not a status. `remote_may_survive` for the normal end must stay absent: a kubelet restart killed the command, and a plain client cancel leaves it running (18 of 18 in S7).

## 5. Every place the contract forced a guess, or could not say what client-go gives

**5.1 The no-status end.** Section 4: client-go's `nil` is two cases, the wire's Success is not the command's, and the guide's arm loses every `exit 0`.

**5.2 `Started` has no honest trigger.** client-go has no "running" callback and the exec protocol no start message; the observations are the first byte and the status. The SDK makes the `Started` of a first byte from `Opened`'s facts, so a quiet command has none: `exit 0` and `true` ended with `start_observed=false`, and a silent `sleep` never shows as started. The transport that carried the session (WebSocket v5 or the SPDY fallback), the terminal granted and the size applied cannot be reported before the first byte either. Calling `p.Started` before the stream exists would make `Failed.stage` RUN for a command that never started (a 403, a container that is not running). *My choice:* no `Started` call. *Suggest:* say in the guide that this class of target is "start observed at the first byte or the status", or give the author a way to mark "stream established" that is not "command running".

**5.3 The default choice is not in `Proc.Request.Selection`.** `checkSelection` (`engine.go:927-945`) accepts a request that omits a required option when a choice is the default, and uses the default only to narrow the capabilities; the function sees the selection as sent. A Pod with several containers then fails at the API ("a container name must be specified") unless the author reads the Pod again to find the default (`containerOf`: a second GET, 22 lines). *Suggest:* put the resolved choices into `Request.Selection`.

**5.4 Options runs at every Open, and the function builds the clients again.** `resolveOptions` (`engine.go:813-854`) calls the callback inside the admission of each `Open` (to check the selection and to narrow the capabilities); the function then builds the connection's clients and, with an incarnation, reads the Pod again. On kind that is 4-6 ms to `Opened` (clients 0.25 ms, Options 2.1 ms); a kubeconfig whose auth is an exec plugin (aws, gcloud) forks a process in each build [INFERENCE, not measured]. The legacy lane built the clients once per session. *Suggest:* hand the function the lease's client (the resource lane already borrows one: `borrowNativeClient`) or the Options result.

**5.5 Choice states are advisory, and the refusal comes late as text.** The SDK admits a `STOPPED` or `STARTING` choice; the API refuses with `Internal error occurred: unable to upgrade connection: container not found ("app")`, the same text for a waiting, a crashed, a completed and an unknown container. Options knows which; `Classify(err)` cannot. 10 of 10 containers agreed with their state, so a picker can disable what is not `READY`. "Ready" means running here, not readiness-probe ready (a running container that fails its probe is exec-able and `READY`). The ephemeral-container flow (create, wait up to 60 s for it to start, attach: legacy `waitForDebugContainer`) has no place in the contract: a `STARTING` choice is refused, not waited for.

**5.6 Vocabulary I had to invent.** `Choice.Kind`: `container`, `init`, `ephemeral` (a restartable init container, a sidecar, is an `init` that stays running: not told apart). `Choice.Detail`: `pending`, `creating`, `crash-loop`, `image-pull`, `waiting`, `completed`, `terminated`; the guide names two of them. `ErrorReason` used: `TARGET_DENIED`, `TARGET_GONE`, `TARGET_REPLACED`, `NOT_RUNNING`, `NO_SUCH_EXECUTABLE`; missing: a container that is not in the Pod (mapped to `NOT_RUNNING`) and a Pod the kubelet has just lost ("pod does not exist" during a restart, also `NOT_RUNNING`).

**5.7 Typed classification is not possible for the upgrade's refusals.** The plan (K1b/K2, second pass) wants `errors.As` on `*StatusError` before any text. On the real path client-go flattens the API's 403 and 401 into `unable to upgrade connection: pods "quiet" is forbidden: User ...`, a plain `errors.errorString`: the first build ended RBAC-denied sessions as `Failed{INTERNAL}`. Typed matching holds for the exit code (`CodeExitError`) and for stream breaks (`*websocket.CloseError`, `*net.OpError`); the rest is text (403, 401, "container not found", "pod does not exist", "executable file not found"). Fixed in `classify.go`; the unit table has the real texts.

**5.8 `Classify(err)` has no request.** The facts a host words a refusal from (the program that was not found, the container asked for) need the request, so `ExecFunc` adds them and `Classify` is only the second half of the classification. *Suggest:* `ClassifyFunc(req Request, err error)`.

**5.9 A killed container is a plain exit code.** `kill -9` of the container, a Pod delete and `exit 137` all end `Exited{137, PROCESS}`; `kill -TERM $$` is 143. The API carries no signal, so `ExitReport=CODE` is right and `ExitFolded` would claim a fold the API does not state. A consumer cannot say "killed"; it can show the code.

**5.10 Lost or Failed for a broken stream.** The contract says a stream that failed after the start is `Failed{stage STREAM}` and one that merely ended is `Lost`; client-go reports a break as an error. I chose Lost for every break of the read side (FIN, RST, a server restart, the heartbeat), as the brief expected, and kept dial and upgrade failures as errors for `Classify` (stage START). The causes: `NO_STATUS` for a close or a reset, `LINK_DEAD` for client-go's heartbeat read deadline (`net.OpError`, a read timeout, 58.97 s): the second is a guess at "the transport's keepalive gave up".

**5.11 `LinkHealth` cannot be implemented over client-go.** The executor pings every 5 s and gives up after 61 s, internally, with no hook: the host sees nothing for 59 s before `LINK_DEAD`. Only a plugin that owns the WebSocket (`ownexec.go`) could report DEGRADED and STALLED.

**5.12 `Stall=LOSSY` is real, and costly for output you want whole.** Section 3, flood: a consumer that does a little work per byte loses output in 2 of 3 runs although the lane runs at 170+ MB/s, and a stall of 5 s loses 85 % of 64 MiB. The SDK's accounting is exact and `output=TRUNCATED` says so; Kubernetes has no PROPAGATES, and the one knob that might help, a larger replay ring (`Start.replay_bytes`), is refused UNSUPPORTED by this build.

**5.13 Attach.** `Opened.facts.program.argv` is `["/bin/sh"]` for an attach (the target's default argv fills the request's); an attach runs no program. `ExitReport=NONE` is true of the stream, but the container's exit code is in the Pod status a moment later, which a provider could read (exit 5 ended as `Lost`). A container without stdin accepts an attach that asks for it and the input goes nowhere [direct]: the container × mode combination cannot be said by per-choice capabilities.

**5.14 The incarnation.** The exec API has no precondition, so the provider reads the Pod and compares its UID (+2 ms, `TARGET_REPLACED` works end to end); the race between the read and the exec stays open.

**5.15 Stdin EOF is unprovable through `Open` here.** `close_input` is not served, so `StdinEOF: true` rests on the unit level (client-go closes the remote stdin when `p.Stdin` reads EOF; the channel-reading executor sends the close signal) and not on the wire; for a TTY the pty has no half-close [INFERENCE].

**5.16 What needed no guess.** `Kill=CLOSES_STREAM_ONLY` (18 of 18 survive), `InitialSize` and resize, `SeparateStderr`, the two modes narrowed on their choices (`Opened` carried exactly them: B1.1 works), the SDK's typed refusals, the incarnation, `ExitReport=CODE` for exec and `NONE` for attach.

## 6. Not covered

- Node exec (the debug pod), the wait for a starting ephemeral container, the native command, the diagnostics spans.
- Not served by this SDK build, so not exercised: `close_input` (stdin EOF on the wire), `signal`, `detach`, an attach request kind, replay, lease, `Run`.
- One runtime and version: kind v1.34.0 on containerd 2.1.3. The kubelet-restart Success, the survival of a cancelled command and the 3 MB/s TTY are runtime facts; other runtimes (cri-o, docker) and versions are not measured [INFERENCE for them].
- A kubeconfig with exec-plugin auth (the cost of the per-Open client builds), several nodes, an API server behind a proxy with idle timeouts, sessions idle for longer than the 61 s heartbeat.
- The channel-reading executor (`ownexec.go`) is an experiment: no SPDY path of its own, its stdin close signal was not exercised on the wire.

## 7. Evidence and re-run

- Rig, tables and every frame: `k-proof-out/` in the lead's scratch directory (not in this repository: `RESULTS.md`, `raw/*.jsonl`, the tap's `raw/*.tap.jsonl`, the provider's `raw/*.trace.jsonl`, `redo.sh`, `bin/kproof`); plugin binaries `bin/plugin` (sha256 `8ed5755b...`) and `bin/plugin.fix1` (the classification fixes).
- Provider knobs (spike only): `KPROOF_TRACE=<file>` (one JSON line per ended stream: client-go's error type chain and text, the protocol, the exit chosen), `KPROOF_NIL=code0|transport0` (the arm for client-go's `nil`), `KPROOF_EXECUTOR=own` (the channel-reading executor).
- Direct probes: `KPROOF_KUBECONFIG=<kubeconfig> KPROOF_CONTEXT=kind-kproof-exec-v2 GOWORK=off go test ./pkg/plugin/execv2 -run TestKind -v` (`KPROOF_SLOW=1` adds the blackhole; they create and delete pods named `lead-*` and restart the kubelet).
- Branch `wip/spike/exec-v2-provider` of `omniview-plugin-kubernetes`, head `a37f0d058b8a0febfa526cea6df71bd899c32a43` (one commit on `origin/feature/ui-next` `2b5e684`); no PR. The kind cluster `kproof-exec-v2` is deleted.
