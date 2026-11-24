# Before any tag that ships `exec.v2`

> **Copy for the terminal handoff** (2026-11-24) of `docs/exec-before-any-tag.md` on the branch `feature/exec-v2` of `omniviewdev/plugin-sdk` (head `8726f24c` when copied), byte for byte except this line (its relative links to the SDK's own docs were removed). The file in plugin-sdk is the authority.
>
> **Read item B1.3 with `exec-lane-k8s-proof.md`, section 4.4: its recommendation "PROCESS for a Success" was tried on a real cluster and is contradicted.** After a kubelet or containerd restart the API server sends an explicit Success for a command that did not exit 0 (8 of 8 sessions), so reporting PROCESS for a Success would print a false exit 0 for a killed command. The spike's recommendation: do not adopt it; keep an arm for "ended normally, the command's status not known" (`Exited{0, TRANSPORT}` or an arm without a code); a non-zero status stays PROCESS; `Lost` is for a broken leg. The gate's text below is unchanged.

This page keeps, verbatim and not edited, the conditions that the independent review of head `ed6f26f8445c2e756de5506882c3927e9f228b47` of the exec v2 contract (`proto/exec/v2/exec.proto`, `pkg/v1/exec`), by `ReviewSdk87`, sets before **any** tag that ships `exec.v2`: a stable tag cut from `main` ships the contract for good. The file and line references (`exec.proto:1268`, `docs/exec.md:121`, `limits.go:102`, ...) are to that head, not to the tree you are reading, and the page is a record of the review: it does not say which of its conditions have been met since.

---

- **C3, process.** `proto-breaking` baselines against the latest *stable* tag (`.github/workflows/native-exec.yml:96-106`), v0.22.0, which has no `exec.v2`, so it guards nothing until a stable release carries the file; and **any stable tag cut from main after this merge ships `exec.v2` for good** (a bug-fix tag would do it). Cut no stable tag from main before the gate, or cut it from a branch without this commit. A pre-release tag (`-rc.N`) is invisible to `@latest` and to that job's baseline, so it freezes nothing.

### (B) The tag gate: what must change before a tag

#### B1. Shape decisions. 1 to 6 close the gate; 7 to 12 are decide-and-record, each with an additive path

1. **Narrowing** (blocker 4; the open follow-up). Decide: (i) declare selection-determined modes statically (`Choice` carries a narrower `Capabilities`, applied by the SDK at admission): `Opened` is then accurate, the picker can show "attach: no exit status, survives a host restart" before opening (the `mode` option of `docs/exec.md:167` shows nothing about it), and the fields that act at admission or when the pipes are wired (`tty`, `env`, `cwd`, `initial_size`, `stall`) can follow it; `Started` keeps only what is learned at run time. (ii) The SDK sends a `Started` (the author's, or one made from the bound) before the first `Output`, so no output is delivered under provisional capabilities; the illustration's gate disappears. (iii) Say that a new session's `Opened` capabilities are provisional until then. (iv) The cross-field rule the PR lists as open: narrowing `tty` to false empties `integration`. (v) Mutating `Proc.Capabilities` is inert today (only a reported `SessionFacts.Capabilities` counts): observe it or make it read-only.
2. **End invariants** (C1) and the `Lost` + `remote_may_survive=false` contradiction (a decoder rule).
3. **A stream that ended with no status** (SHOULD 8). `Exited{code, TRANSPORT}` exists and is unambiguous for a consumer that reads `source` (an unspecified source is never PROCESS; `ExitCode` on an `ExitReportNone` target is downgraded to TRANSPORT with a violation and survival absent: ran). The guide swapped the risk and did not remove it: `docs/exec.md:223-226` and the tested illustration return `ExitLost(LostNoStatus)` for every `err == nil`, and client-go's nil is also what a **Success** status looks like (the comment there says so), so every successful Kubernetes exec would end "connection lost, may still be running" and an agent `run` could never return success from a pod. The author keeps `Exited{TRANSPORT}` for "exactly the transport that relays a code of its own" (answer to 4661646443). I could not find such a transport in the prior-art table (`T-terminal-prior-art.md:364`): Kubernetes exec relays the process's own status on the error channel, attach relays none, docker `ExecInspect` and ssh `exit-status` the process's own; the codes that are the runtime's or the client's (docker's 126/127/128 for a start failure, OpenSSH's 255 for a dead connection) are, by this contract's own rules, `Failed` (start) and `Lost`, not exit codes. So today the only producer of `ExitTransport(n)` is an author inventing `n` (my reading). Decide with K2's real executor: if it can read the status channel (the guide says a plugin can), PROCESS for a Success status and `Lost` for an empty channel, and delete `EXIT_SOURCE_TRANSPORT` and `ExitTransport`; if not, add the no-code arm ("closed cleanly, status not reported") and delete them as well. A code on a no-status end is the one shape I would not tag.
4. **Values nobody can deliver:** `OUTCOME_CANCELLED`, `CLOSED_BY_RUN_TIMEOUT`, `CLOSED_BY_CANCELLED` (blocker 1c), and `CLOSED_BY_IDLE_TIMEOUT` ("idle for longer than its bound", `:1131`), for which no message has a field to set the bound (`SessionLimits` has seven fields, none of them an idle timeout). Define who produces them, or delete them now (free now, permanent after).
5. **Redundant fields that can disagree:** `start_observed` vs `Failed.stage`; `OutputAccount.truncated` vs `dropped_bytes` and `completeness` (`:1442,1451`, SHOULD 13). Drop one of each pair, or ship the decoder that rejects the disagreement with the first consumer.
6. **Consumer readers.** The raw getters flatten every `optional` the contract relies on and keep an unknown enum number. Ship the readers (an absent fact is unknown; `remote_may_survive` absent reads "may"; an unknown enum value reads UNSPECIFIED) with the first host consumer (H1a-1 reads `Describe` now). This is what the deleted Go mirror did.
7. **`OpenRequest.kind`** (the `oneof` at `:645`) to two optional fields (wire-identical) so that "both present" is refusable (the author's answer to 4661646400: decided at X3a, before any tag: agreed).
8. **Refusal encoding** (SHOULD 7): a typed message under `Status.details` or the `ErrorInfo.metadata` strings; one encoding, before H1a-1's decoder hardens (`Options` refusals already use the metadata).
9. **`Session`/`Run` declaration** (SHOULD 4): a target with neither registers and serves only `Options` (now documented, `docs/exec.md:47,87`; still silent in code) and `Exec` is required even for an Options-only target.
10. **Ownership and sizes** (SHOULD 14, 15, 16): `ListSessions`, `ReadOutput` and `EndSession` carry no route (`:1338-1363`); one bound policy (refuse or clamp); the largest `Output` frame and `ReadOutput` and `ListSessions` response.
11. **`Exit` default:** `SourceUnspecified` beside a code reads PROCESS; read it as the weakest (TRANSPORT + violation) so that `ExitCode(...)` is the only way to claim PROCESS; consider an opaque `Exit`.
12. **Vocabularies and the string guard:** `Choice` kinds, details and states (K1a); `TestAbsenceIsUnknown` to cover strings; `Mark.command_line` and `cwd` presence.

#### B2. Names that still collide

| Collision | Where | Do |
|---|---|---|
| Constants whose prefix is not their type: `Reason*` / `ErrorReason`, `Class*` / `ErrorClass`, `Source*` / `ExitSource`, `Lost*` / `LostCause` (and the wire message `Lost`), `Link*` / `LinkState`; `IntegrationOff` vs the wire `NONE` | `enums_v2.go` | These are the **author API, live now**: the PR defers them as "names of things no engine produces yet", which is wrong for these. Rename before any author outside the tree |
| `SessionFacts` twice (the author's 7 fields; the wire's 12), `Capabilities` twice (plain declaration; wire `optional`), `TargetRef` twice (no selection) | `exec` and `execv2` | One word, two shapes: rename the author's `SessionFacts`; drop or rename the Go `TargetRef` |
| `exec.Request` (the validated request) vs the wire `RunRequest` and `OpenRequest` (a frame) | | rename |
| `exec.Client` (2 methods) beside the legacy `Provider` and `PluginClient` | | one word for "what the host calls" |
| `FEATURE_SESSION` vs `FEATURE_SESSION_MANAGEMENT` (`:264,278`); `Close`, `EndSession`, `End`, `Ended`, `Closed`; `Detach.lease_ms`, `Start.detach_timeout_ms` and `SessionLimits.detach_timeout_ms` (one lease, three names: `:456,602,700`); `last_offset` (exclusive) | wire | settle at X3a/X3c (the PR's own list) |
| `Started` (frame), `Proc.Started`, `start_observed`, `FAILURE_STAGE_START` | wire, Go | one story in four words: acceptable if it is told once |

#### B3. Exports that should still not be public (of the 236, and the 42)

- `NewTargetPlugin` (`plugin.go:80`): its only non-test caller is `internal/exectestkit`; hide it behind `internal/exechook` as `narrowCapabilities` already is.
- `SourceHost` (`enums_v2.go:331`): no use outside the package, and an author "may not set it".
- `SessionLimits.IsZero` and `RunLimits.IsZero` (`limits.go:102,240`): no use outside the package, and they publish "zero = not served", which B1.9 may change.
- The seven SDK-raised `ErrorReason` constants (`TooManySessions`, `TooManyRuns`, `InputTooLarge`, `SessionExists`, `SessionUnknown`, `ConsentRequired`, `InputBacklog`, `enums_v2.go:264-285`): no author or live consumer produces them; add the Go names with the step that raises them.
- `exec.Exit`'s five fields: consider opaque; the constructors are the API and the fields publish the empty and mixed shapes the SDK then polices.
- `exectest`, 42 identifiers: 17 are what an author needs (`Conformance` x3, `ProcRig` x14); **25 are not** (`NewFakeTarget` with 8 `Fake*`, 13 `Step`s, `Gate` x4). Outside the package, no doc or example uses them; only the SDK's own tests do. The PR calls all 42 author-facing; an author tests their own `ExecFunc` with the rig and `Conformance`, which never use the fake target. They serve the engine's and the host's tests, so `internal/` is right unless the host repo needs a scripted target: decide when H1a-1 writes its first test, not before. And `NewProcRig` holds a function to a *fake* target's capabilities unless given `RigCapabilities(target.Info.Capabilities)`: take the `Target`.

#### B4. The 11 deferred SHOULDs: is each deferral safe?

| SHOULD | Safe to defer past the merge? | Must be true before the tag |
|---|---|---|
| 4 explicit `Session`/`Run` | Yes | X2a takes it before its registry consumes `IsZero` (B1.9) |
| 5 `Choice` states and vocabularies | Yes: additive enum values and text | K1a publishes them; the mode picker shows no capabilities until B1.1(i) |
| 6 typed `UNSUPPORTED` reasons | Yes: additive `ErrorReason` values | before H1a-1 picks lanes by call order |
| 7 refusal as a typed detail | Yes for the merge | one encoding, before H1a-1's decoder hardens (B1.8) |
| 8 no-status arm | The merge yes; **the tag no** | B1.3 |
| 11 rig fails writes after the end; five cases | Yes. The rig half is **already done**: a late write fails with `io: read/write on closed pipe` (ran). The five cases are tests, but a panic in `ExecFunc` and the author's obligations are **contract text** (`docs/exec.md:121` still says "Not specified yet") | write both before the tag |
| 13 `OutputAccount.truncated` | Yes | dropped before the tag or it is permanent (B1.5) |
| 14, 15, 16 ownership, one bound policy, sizes | Yes | decided in X3a/X3c (B1.10) |
| 17 `Describe` static or per connection | Yes if "static per plugin" is the answer | the per-mode gap is B1.1, not this |
| rest of 2 (names) | The wire names yes; the **Go prefixes no** (live author API) | B2 |
| the Kubernetes compile proof | Yes | against the real client-go, before the tag; it decides B1.3 and exercises B1.1 |

None of the eleven is a shape the engine steps would bake in beyond what they must touch anyway; 7, 8, 13 and 16 are cheaper before X2a/X2b/X3a write against them.

#### B5. The three threads answered with a reason

- **A `oneof` arm the decoder discards** (4661646400, `admission_v2.go`): acceptable. The decoder keeps only the last arm and the reflection walk cannot see an unknown field in the discarded one, so a frame carrying both arms reaches admission as the later arm alone: a malformed sender, not a downgrade, and nothing the reader does not understand is acted on. The wire-identical fix (two optional fields) is B1.7.
- **An `Exited` arm from the transport** (4661646443, `exit.go`): acceptable for the merge, not for the tag (B1.3). On the wire the source makes it unambiguous: an unspecified source is never PROCESS, `ExitCode` on a `NONE` target is downgraded to TRANSPORT with a violation and survival absent (ran), and `RunResult` carries `exit_source` beside `exit_code`. It is confusable only by a consumer that prints the code and drops the source, and only if the engine feeds the kind's capabilities (A).
- **A bare `Canceled` from a catalog provider** (4661646447, `plugin_server_v2.go`): acceptable. The author's reason: a provider that returns `context.Canceled` from a downstream operation of its own is misread as a retirement, that is a provider bug, and the lease ends on return so it cannot be told apart from outside. `Options` is a read and a retry is safe; the mutant that drops the caller-alive guard (R22) is killed.

#### B6. The open follow-up, 4661646396 (a write that arrives without `Started`)

Not a docs nit, and not a hole in the way the bot frames it. After the fix, the bot's only real reply says "One race remains: `awaitStream` checks `first.seen` and finds it open; a writer starts after; the deferred `first.release()` unblocks it without a `Started` report ... make the return path fail closed for writes that arrive without a `Started` report ... I am not marking the finding as addressed." **The SDK itself accepts output with no `Started`, by contract:** `Proc.Started` says a command that never calls it "is reported as started when its first output arrives", and the proto says its capabilities then "stay the kind's upper bound" (`:774`); the rig accepts it (ran: output, zero `Started` reports). So no illustration can make the SDK refuse that order, and the gate in the illustration protects an invariant the contract does not give. The real finding is blocker 4's: the contract lets output run under provisional capabilities and gives the author no way to be early, so every author with modes will re-implement that gate and get it wrong (the bot found one race, and after the fix another). The fix belongs in the SDK (B1.1 ii) and settles the thread; until then the illustration should not be the pattern the guide teaches (it also encodes the "nil is Lost" decision of B1.3).

#### B7. Guards and proof

- The Kubernetes compile proof against the real client-go, before the tag (B4).
- `proto-breaking` is trivial until the first stable release that carries the file; until then the reviewed golden is the only guard, and `-update` regenerates it (C3).
- Pin `defaultMaxDimension` and `maxTargets` to the numbers the guide prints (the two survivors).
- `Exit.end` must receive the session's effective set (A).

