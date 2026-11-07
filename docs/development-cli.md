# Development instance CLI

`omniview-dev` manages isolated development workspaces and controls their running
hosts. Workspace commands own builds, links, and supervised services; instance,
plugin, settings, and operation commands use the authenticated host API.
Marketplace publisher CLI commands are unchanged; `plugin list` here means plugins
installed in the selected instance.

On macOS, the application cask installs and updates `omniview-dev` alongside the
desktop app:

```sh
brew install --cask omniviewdev/tap/omniview
brew update && brew upgrade --cask omniviewdev/tap/omniview
omniview-dev --help
```

For source development, bootstrap the CLI through the public task, which prints
its actual immutable absolute executable path. The host consumes published SDK
`v0.7.0`:

```sh
DEV="$(task --silent dev:cli:build)"
"$DEV" instance inspect --workspace /path/to/workspace
```

For local SDK development, explicitly select its source with
`SDK_SOURCE=/canonical/path/to/plugin-sdk`. Inside a selected enclosing workspace,
the task may resolve SDK source from its canonical manifest instead; it never
guesses a sibling. Do not use an ad hoc Go replacement or install a CLI into the
feature checkout. Keep using the returned `"$DEV"` path rather than guessing a
`bin` location.

Build the CLI from the selected host worktree when switching source cohorts.
An immutable CLI built from an older checkout retains that checkout's validation
rules; selecting a newer host does not update the executable. Current UI checks
exclude comparison benchmarks while still rejecting legacy dependencies in
runtime consumers.

Source refs across repositories are not automatically compatible. The reported
host commit `187e5336f1c9a4b9d58d32890649d7db9d80d413` and Kubernetes commit
`f366018a7fac1fbd91c43bb2abb6dcfc9149a5b1` fail strict peers: Kubernetes selects
React Query 5.90.21 and Vite 5.4.21, while linked host packages require
`^5.105.0` and `^7.3.7`. Kubernetes commit
`4fab2158ad2531bdba37782567b794b5e34cf726` on
`origin/feature/frontend-upgrade-3bd7bcc6` declares those newer versions.
This is a manifest-compatible candidate, not a runtime-tested cohort. Select refs
explicitly and verify the resulting application; never disable strict peers.

Link planning reports provable conflicts between ordinary exact, caret, and tilde
manifest ranges before installation, naming both consumer and linked manifests.
Overlapping ranges are not proof that a selected lockfile resolves compatible
versions. Complex ranges and policy-adjusted peers remain the native resolver's
decision; a clean planning result does not replace strict installation.
When a peer itself comes from selected linked source, planning compares that
package's actual manifest version with the linked consumer's peer range. It names
the consumer, peer requester, and selected provider manifests. A stale dependency
range does not replace the selected provider's version. Generated `workspace:*`
overrides do not suppress this check; unrelated policy overrides still defer to
native resolution.

Commit pins must already exist in the registered source repository. A
`local_ref_missing` error names the repository and pinned object without printing
Git stderr or remote URLs. Explicitly fetch the branch containing that object in
the registered source repository, then repeat the selection. The CLI never fetches
an unknown pin automatically; explicit remote-tracking branch selection retains
its existing fetch behavior.


Go source preflight also checks direct SDK imports against non-test package source
in the selected SDK worktree before installation. It scans platform/tag variants
conservatively and accepts ordinary uncommitted SDK source additions. This is
source-presence evidence, not proof of exported API compatibility, target-specific
buildability, or future source generation.

An owned supervisor can remain alive after a launch failure. `workspace up`
refuses to replace it and reports its launch phase and recovery command, including
the absolute manifest target. Use the reported command: failed builds normally need
`workspace refresh`, not another `workspace up`. A retained supervisor is not
evidence that the application is ready.

`workspace recover` does not require a failed supervisor to be stopped first.
For materialized workspaces, recovery validates retained intent and proof before
authenticated shutdown.
Completed manifests must still match their owned lifecycle journal before any
shutdown. Interrupted creates whose journal exists before `workspace.json` is
published can resume materialization through `workspace recover`.
An interrupted materialization is resumed only after the owned supervisor exits.
Initial launch recovery can reuse the genuine protocol evidence saved in
`launch.json`, even if linking failed before accepting a link journal. Missing
proof still requires explicit `--link-evidence FILE`; recovery never invents proof.
If a refreshed launch fails after dependency preparation has already completed,
recovery resumes its retained `start` or `verify` boundary instead of reinstalling
the captured cohort. Each launch generation is minted and recorded in the private
refresh intent before its supervisor is spawned. A UUID or environment selection
alone grants no launch authority. The controller captures its actual child before
reaping can permit PID reuse and issues a private, one-shot native launch handoff.
Only that exact process identity can claim it, before publishing supervisor state.
Recovery requires the claimed handoff to match the selected process and fences
shutdown by both generation and native identity. Different successors and direct
`supervise` replays are refused, including reuse of a known generation.

Potential attempts remain recorded across interruptions before ownership publication;
recovery never infers authority from whichever supervisor happens to be latest.
Malformed, zero, noncanonical or duplicate persisted generation identities are
rejected, never normalized into authority. Older retained intents without native handoff
proof cannot adopt or stop a live owner automatically. Inspect ownership before
an explicit transition. These private metadata and native invocation checks are
not a sandbox against a same-user actor who can rewrite metadata or executables.

`workspace restart` also starts a stopped or exited workspace using its saved
launch settings. Missing or exited supervisors are not errors by themselves.
Live ownership conflicts and generation changes remain refusals. On Darwin,
authenticated shutdown still waits for the exact supervisor's kernel exit before
starting a successor.

The target application must have been built with `devcontrol` enabled and launched
against the workspace. Release builds do not advertise a control endpoint.

## Target selection and authentication

Every command accepts `--workspace <manifest-or-directory>`. An enclosing
`workspace.json` or absolute `OMNIVIEW_WORKSPACE_FILE` is also accepted. Explicit
and environment targets must agree. Multiple enclosing manifests are ambiguous.
There is no production fallback.

A registered workspace name or full UUID can be selected with
`--root /path/to/repository-collection --workspace my-feature`. Without `--root`,
name lookup searches ancestors of the current directory for the A03 source
registry, then uses its workspace identity/journal lookup. Use `./name` to select
an unambiguously relative directory instead of a registry name. Unknown or
ambiguous names fail rather than guessing.
`instance inspect [WORKSPACE]` accepts the same workspace selector positionally.
The positional selector and `--workspace` must agree when both are supplied;
plugin and operation positional IDs remain resource IDs, not workspace selectors.


From a host Git checkout, `workspace collections --json` lists reachable, validated
collections associated with that repository's registered Git worktrees. It does
not scan sibling directories, create a global index, select a profile, or fetch
refs. Invalid, redirected, and unavailable collections are omitted; an orphaned
collection without a registered host worktree still needs explicit `--root`.
Choose a returned root explicitly with `workspace list --root COLLECTION`.
Listing skips directories without a `workspace.json`; existing malformed or
unreadable manifests still cause an error.

The client reads the private per-workspace discovery record and token reference,
verifies the process start identity, then authenticates `instance.inspect` against
the actual endpoint. Its descriptor must match the manifest's UUID, isolated state
root, discovery instance UUID, complete process identity, control endpoint and
host generation. A healthy port alone is never sufficient. Tokens are not accepted
on the command line and are never included in JSON output or diagnostics.

Discovery uses the authoritative instance profile's UUID-owned runtime directory,
including when persistent state is custom-bound elsewhere. A directory beside a
custom state root is not a discovery source and cannot redirect the client.

## Commands

Commands, flags, help, and shell completion use Cobra. Every group and command
supports `--help` without selecting a workspace or contacting a running host.
`help workspace up` is equivalent to `workspace up --help`. Usage failures list
valid commands without echoing private argument values.

Generate completion with `completion bash`, `completion zsh`, `completion fish`,
or `completion powershell`, then load the output through your shell's normal
completion mechanism. Completion follows the command tree and offers only flags
valid for the selected command:

```sh
source <(omniview-dev completion bash)
```

Flags accept `--flag=value` and may appear before or after positional targets
within a command. Repeat selection flags to supply multiple values. Boolean
overrides use `--watch=false`; `--` ends flag parsing for dash-prefixed targets.

### Repository and workspace lifecycle

Repository mappings belong to the collection, not to any single workspace:

```sh
"$DEV" repository list --root /path/to/collection
"$DEV" repository add my-plugin --source /path/to/plugin \
  --ref main --directory my-plugin --root /path/to/collection
"$DEV" repository remove my-plugin --root /path/to/collection
```

Adding a mapping preserves existing mappings. Removal refuses repositories still
referenced by workspaces or retained lifecycle resources; it never deletes source
repositories or worktrees. The host repository cannot be removed.

Remote-tracking selections such as `origin/main` or
`refs/remotes/origin/main` fetch the requested branch before resolving it.
The manifest retains the named base ref and records its resolved base commit.
Explicit commit pins do not fetch. Selection edits preserve committed plugin
metadata from existing worktrees.

```sh
"$DEV" workspace edit feature --add-repo my-plugin --apply
"$DEV" workspace refresh feature
"$DEV" workspace update feature --repo my-plugin
"$DEV" workspace recover feature
"$DEV" workspace evidence feature --json
"$DEV" workspace reset-modules feature [--json]
```

`edit` persists selection/ref/name/port edits.

Linked rename validates aggregate files, producer outputs, and generated metadata
before recording intent. It tears down old-root links under the lifecycle and
stopped-profile guards, then applies strict root admission before moving anything.
Only exact validated owned paths receive temporary admission; changed bytes,
foreign neighbors, redirected paths, and unfinished producers remain refusals.
Interrupted teardown resumes at the old root; interrupted move resumes from its
persisted lifecycle journal. Link journals containing absolute roots never move.
Use explicit `edit --apply` to rebuild and relink at the new root.
With `--apply`, stop owned services, relink dependencies, rebuild, restart, and verify readiness.
Canonical edit intent is validated before `--apply` stops a healthy supervisor;
the mutation repeats that planning under its lifecycle lock.
`refresh` uses the current worktree contents without advancing Git refs. `update`
fast-forwards selected repositories before refreshing; it does not discard dirty
edits or reset branches. `recover` resumes refresh work using its durable journal.
Existing `resume` and `rollback` commands handle interrupted workspace creation.

Failure recovery commands include an absolute `--workspace` manifest path. They
can be copied into a shell outside the collection without discovering or selecting
another profile. A conflicting workspace environment still refuses the command;
unset stale context explicitly rather than falling back to another target.

Supervisor inspection does not queue behind a source or shutdown operation.
During shutdown, `launchPhase: "stopping"` and `waitStage` identify the current
wait, such as `build-authority`, `plugin-control`, `host`, or `leases`. A busy
observation does not attest host readiness. A response from a replaced supervisor
generation is refused rather than reported as the current ready application.
If the same owner exits before final verification, inspection restores its saved
stopped proof or reports a crash; it never returns stale readiness.
The authenticated supervisor status request has a five-second total deadline,
including its response body. A stalled observation returns exit 7 with
`code: "timeout"` and retains ownership; it does not mark the supervisor dead.
Canceling a queued request releases its wait without authorizing delayed
mutations. Canceling an admitted shutdown does not prove disposal: exact process
handles, output writers, and leases remain with the owner until cleanup completes.
The owner continues cleanup after the caller's deadline, joins in-flight launch
work, and releases its process and workspace lock only after confirmed disposal.
Each shutdown wait-stage transition is saved for crash inspection. Late producer
completion cannot restore readiness after shutdown has been admitted.

Removing a repository selection retires its worktree but keeps its branch
ownership record for later reselection or explicit branch deletion. Link, unlink,
refresh, and workspace removal validate only live worktrees; a deliberately
retired source is not a missing checkout. A missing or replaced selected worktree
still blocks these operations.

An externally changed dependency tree is a different failure. For example,
running an unmanaged `pnpm exec` can trigger a standalone installation and change
`node_modules` outside the recorded producer transaction. The resulting
`owned generated tree changed`, `node_modules changed before Vite start`, or
`repository output still has an active or interrupted writer` refusal protects
unverified bytes. Neither `workspace recover` nor `workspace refresh` authorizes
deleting or adopting that tree. Do not delete the tree or rewrite its ownership
record by hand to force cleanup.

`workspace reset-modules` is the explicit recovery. It requires a stopped
workspace (the same lifecycle lock and stopped-profile guard as `link`; a running
supervisor or live consumer is refused). For a complete dependency link, it
deletes every journal-owned `node_modules` tree, the TypeScript and Vite loader
caches inside it, the external Vite optimizer cache, and any `node_modules` at the
composition root or a selected package root, including trees left by an
interrupted writer. It then reinstalls through the recorded composition installer,
so the new trees are snapshotted by a recorded writer. Foreign bytes are never
adopted. Distributions, bindings, shims, the YAML worker, root-level config
timestamp files, their publications, and build reuse records stay untouched. A
target that resolves through a symlink is refused. The result lists the removed paths; `--json` returns
`{"workspaceID", "phase", "removed", "reinstalled"}`. If the reinstall fails, rerun
the command; if the lockfile was left unverified, `unlink` and relink instead.

When an `unlink` or `remove` was interrupted by such a refusal (link phase
`unlinking`), `reset-modules` only deletes the same trees and forgets their
records, without reinstalling into the partially restored overlay, and reports
`reinstalled: false`. Every other output and its pending restoration stay for the
rerun `workspace unlink` or `workspace remove`, which then completes. Other
incomplete phases are refused except `applying`: explicit reset also deletes
selected dependency trees in that phase without running an installer. Then rerun
the original `workspace up` or `workspace link` command with the same exact
workspace and protocol evidence. For first launch after an unmanaged frozen
install, run `workspace down --workspace /absolute/workspace`, then
`workspace reset-modules --workspace /absolute/workspace`, then
`workspace restart --workspace /absolute/workspace` to replay saved launch settings
and protocol evidence (or repeat the original `workspace up` command). If retained
refresh intent exists, the diagnostic instead includes `workspace recover` to
finish that operation with its retained running/stopped intent.
For an `unlinking` journal, the diagnostic instead ends with `workspace unlink`
after reset, even when launch settings exist: teardown must finish before any
new launch. It also supplies this teardown action without saved launch settings.
Preserve any wanted dependency bytes externally first.
Use the managed launcher for package commands to retain pre-run verification.

### Read-only ownership inspection and standalone reentry

```sh
"$DEV" workspace ownership feature --root "$COLLECTION" --json
"$DEV" workspace preflight feature --root "$COLLECTION" --ownership --json
```

`ownership` checks every selected composition module root (including the aggregate
store), staged producer boundary, and recorded cache. It enumerates all conflicts
without installing, starting processes, creating metadata/locks, or changing
receipts. Results are point-in-time observations, not reusable launch authority;
each real writer repeats its admission checks. Active or interrupted writers and
pending restoration are not reported ready.
Changed file/link/special-file root kinds are reported per boundary without
discarding other selected conflicts. Genuine I/O failures and cancellation remain
errors, not ownership drift. Regular-file payloads are opened without following
links, with nonblocking opens where supported; opened type and identity are
checked before hashing. Dependency links remain opaque link observations.
On Windows, metadata and identity come together from the initial metadata-only
handle; a preceding pathname-only observation is never upgraded into identity
proof. Later payload opens must still match that original handle's identity.

Ordinary `preflight` remains lightweight and reports `ownershipChecked: false`.
The explicit `--ownership` option performs the recursive ownership scan and
includes its report. Neither form certifies source trust, runtime readiness, or
the absence of a mutation after inspection.

Conflicts name the producer, consumer, absolute target, ownership state, phase,
bounded differing paths and file kinds. Publication conflicts also identify the
stage and backup. Typed ownership details survive supervised build/status
transport; arbitrary compiler output stays redacted. `inspect` and `paths` expose
separate `metadata` locations for workspace ownership, links, producer receipts,
launch status and profile state. A reserved profile path need not exist.

For standalone-to-managed reentry, inspect once before linking. Preserve **every**
reported unowned module root externally while stopped. No command silently adopts
those bytes, and `reset-modules` is not a nondestructive preservation operation.
An interrupted `applying` link can use the stopped, explicit selected-module
reset above before retrying the original launch.
Replay accepts only the same validated journal's exact original or applied bytes;
already-applied aggregate files from a failed install need not be removed.
Changed or unverified aggregate files still require preservation and explicit link
recovery; reset never adopts those bytes. Retain source/profile data and resolve
separately reported conflicts.

### Managed bindings and explicit producer reconciliation

```sh
"$DEV" workspace down feature --root "$COLLECTION"
"$DEV" workspace bindings feature --root "$COLLECTION" --json
```

Use `workspace bindings` in an already-linked managed workspace instead of
running standalone output generation there. It invokes the canonical `task
bindings` through the existing staged graph producer, holding stopped-process,
worktree and profile guards. It verifies the selected effective SDK before and
after generation, retains the saved browser/native build context (browser for a
never-launched workspace), and publishes only validated output. Standalone
checkouts still use `task bindings`; raw Wails generation is not supported.

If a standalone producer already changed or replaced a **journal-owned** output,
preserve that exact boundary before restoring its current committed baseline:

```sh
mkdir -m 700 "$PRESERVATION_DIRECTORY"
"$DEV" workspace reconcile-output feature --root "$COLLECTION" \
  --producer bindings --consumer "$HOST_DIRECTORY" \
  --preserve-at "$PRESERVATION_DIRECTORY/bindings" --json
"$DEV" workspace bindings feature --root "$COLLECTION" --json
```

The preservation directory must already be private and outside both the
collection and profile. The exact destination must not exist. Source and
destination parent directory handles are pinned to their recorded identities;
the no-replace rename is handle-relative, with no pathname fallback. This
preserves the entire output, including unknown bytes and directory identity;
cross-filesystem moves are refused rather than copied/deleted. A changed parent
namespace cannot redirect the move and causes refusal before further inspection.
Reconciliation never adopts or deletes the preserved tree, changes unrelated
outputs, or resets source/profile data. It restores only this producer's current
committed baseline through the existing publication state machine. Interrupted
reconciliation retains an intent: rerun the same command with the exact original
preservation path. Source, parent or preserved-byte changes cause refusal.
Supported exact producers are `bindings`, `distribution`, `shims`, and
`yaml-worker`. Unowned outputs require separate preservation and exact baseline
restoration; this command does not create ownership authority for them.

For standalone verification, place compiler build-info outside managed module
trees (for example, `tsc --noEmit --incremental false` when the project supports
it). Tools that write managed caches must use their existing managed writer
lifetime; arbitrary test/build commands do not gain cache ownership.


Managed Vite loaders use an owned, precreated `node_modules/.vite-temp` directory,
so their interrupted writer is part of the explicit dependency reset. Fresh
workspaces no longer register a separate root timestamp-file writer. Root-level
timestamp artifacts remain unmanaged and are never adopted or deleted by this
reset. A proofless live root-loader entry from an older journal remains a safe
refusal; a writer token alone cannot prove that its producer stopped.
New cache roots are created exclusively through pinned parent handles with private
protection established at creation: owner-only mode on Unix, and the current user
SID plus a protected owner-only DACL on Windows. Existing directories are never
adopted or permission-repaired by this creation path. Windows POSIX-style mode
bits are not an ACL/ownership proof; preservation directories likewise require
actual private ownership and access protection, not merely `chmod`/mode settings.

Refresh commands reuse saved launch settings and protocol evidence. Supply launch
flags for a workspace that has never launched, or override saved settings
explicitly. `workspace evidence` inspects reusable protocol proof;
`--link-evidence FILE` applies supplied proof through the normal link operation.
Refresh revalidates link state rather than treating old link freshness as current.

`workspace restart` accepts no launch overrides: it reuses saved launch settings
and protocol evidence. Use `workspace refresh` to change launch settings.
Flag errors identify registered offending names and the exact subcommand help
command, but never echo values or arbitrary unknown names.

Plain `workspace edit` requires a stopped supervisor. Its refusal includes an
exact absolute-manifest `omniview-dev workspace down --workspace MANIFEST`
command. `edit --apply` manages stopping and refresh with retained prerequisites.

A `link_conflict` identifies the dependency path and link phase. When completed
links retain valid protocol proof and saved launch settings, the diagnostic offers
the exact workspace refresh command. Refresh may stop and restart the workspace
and still refuses overlapping edits it cannot preserve safely. Missing
prerequisites or incomplete links instead point to the applicable command help;
do not edit receipts or assume that `up` will adopt changed dependency files.

### Protocol evidence

Every `--link-evidence FILE` argument is a report file path, not inline JSON.
`workspace evidence` without that flag only inspects saved proof. A fresh workspace
returns structured `evidence_missing` with `state: absent`, without creating a
link journal. Supplying the flag invokes the normal link operation; it is not a
proof-only save.

From the selected host source checkout, run the actual pinned composition probe:

```sh
GOWORK=off A11_PROTOCOL_PROBE=1 A11_PROTOCOL_REPORT=/absolute/path/link-protocol.json \
  go test ./internal/devworkspace -run '^TestLinkPinnedProtocolProbe$' -count=1
```

The probe uses disposable repositories, the native pinned pnpm executable, and
registry access. It writes the report only after live distribution replacement,
recursive peer checks, and runtime checks pass. The current report schema contains
`protocol`, `versions`, `atomicDist`, `peers`, and `runtime`; the selected pin is
validated exactly. Do not construct acceptance booleans manually or reuse a report
for a different protocol or pnpm version.

Use the emitted file with `workspace preflight --workspace MANIFEST
--link-evidence FILE`, then `workspace up --workspace MANIFEST --link-evidence
FILE` after resolving reported source prerequisites. Inspection of saved proof is
not certification that installed dependency bytes remain unchanged.

For first launch, use plain `workspace edit` to select prerequisite repositories,
then `workspace preflight`, then `workspace up --link-evidence FILE`. The
[protocol acceptance gate](development-package-linking.md#protocol-acceptance-gate)
documents how to generate genuine probe evidence. `edit --apply` requires accepted
protocol evidence and valid saved launch settings before stopping a supervisor or
changing selection. A bootstrap refusal leaves the manifest unchanged.

If an edit persists but its subsequent refresh fails, the error reports
`editApplied: true`, manifest identity, completed/pending phases, selected workspace,
and an exact `nextCommand` in its JSON details. Human output also names the
persisted edit and recovery command. Do not repeat the edit to hide an apply failure.
Partial-result identity comes from the persisted edit, including a changed slug
and manifest directory, rather than from the command's original target.

Retained refresh intent is immutable. An override mismatch names safe field paths,
captured operation and phase, and the exact command to resume saved intent without
overrides. Seed paths and protocol payload values are not included in that diff.
Complete the captured operation before requesting a different cohort.
Mismatch and partial-apply recovery commands use the shell-quoted invoking
executable, so source CLI workflows do not depend on a matching binary in PATH.

Successful stopped refresh/recovery remains stopped and not ready. It clears
current failure, wait-stage and recovery hints while retaining prior diagnostics
as `historicalError` and `historicalFailedStage`. Those fields describe history,
not an instruction to recover again.

Workspace commands print human diagnostics by default; `--json` returns structured
errors and results. Control API commands retain their JSON response envelopes.

`workspace inspect` reports independent process, build, dependency, served-source,
readiness, HMR, and source-reload observations. Instance repository
`configuredRef` and `baseCommit` describe immutable workspace configuration.
Workspace `checkouts` samples the current commit, branch, dirty state, and source
digest. `readyCheckouts` samples those same fields after the last successful
readiness transition; a failed rebuild does not replace that observation.
`health.checkoutSinceReady` reports `unchanged`, `changed`, or `unknown`. Neither
checkout observation proves compiler inputs or the source served by a process.
`health.servedSource` remains `unknown` without artifact-to-source attestation.
The footer reports host readiness independently of served provenance. It shows
checkout changes since readiness and served-source evidence separately; a ready
host does not attest which source produced its artifacts.
Failures name the failed stage and a recovery command. An HMR connection alone
does not prove that an edited source module was served or executed.

To verify an actual source edit, add a unique marker to the module, then run:

```sh
"$DEV" workspace verify-reload feature --module /ui/path/to/module.tsx \
  --marker UNIQUE_SOURCE_EDIT_MARKER --json
```

The command authenticates the owned host and fetches the marker from its exact
owned Vite endpoint. An authenticated browser host can provide this capability
at `backend-ready`; native application readiness is a separate requirement.
Evidence includes the SHA-256 `responseDigest` of the complete transformed module
response. It proves marker delivery, not browser execution, a served repository
revision, or a checkout-to-artifact binding. The included `checkouts` are separate
filesystem observations, not provenance for the response bytes.

For control API commands, flags may appear before or after the single positional
ID/path, following the command group and action. `--id ID` can replace positional
IDs; `--path PATH` can replace positional paths. Control results are JSON, even
without `--json`.

| Command | Arguments | Meaning |
| --- | --- | --- |
| `instance inspect` | none | Authenticated actual instance descriptor |
| `extensions windows` | none | Discover registered diagnostic runtime names before selecting a document |
| `extensions inspect` | `[--window main] [--plugin ID] [--point ID] [--query TEXT] [--issues-only] [--include-sensitive]` | Live frontend registry, queued contributions, plugin state and captured problems |
| `extensions lookup` | `--point ID --plugin ID --resource-key KEY [--window main]` | Explicit supported resource-context resolution, without mounting components |
| `plugin list` | none | Installed plugin inventory in this instance |
| `plugin get` | `ID` | Installed plugin metadata |
| `plugin install-archive` | `--path ARCHIVE` | Install caller-owned archive without consuming the input |
| `plugin install-version` | `ID --version VERSION` | Install an explicit registry version noninteractively |
| `plugin uninstall` | `ID` | Canonical plugin uninstall transaction |
| `plugin dev link` | `--path SOURCE` | Canonical source-link/install/rebind transaction |
| `plugin dev unlink` | `ID` | Stop/unlink a managed development plugin |
| `plugin dev start` | `ID` | Start canonical managed lifecycle |
| `plugin dev stop` | `ID` | Stop actual plugin backend and managed watcher/services |
| `plugin dev restart` | `ID` | Canonical restart and readiness |
| `plugin dev rebuild` | `ID --generation PLUGIN_GENERATION` | Rebuild only the expected plugin generation |
| `plugin dev status` | `ID` | Build/Vite/RPC/controller status and actual plugin generation |
| `plugin dev logs` | `ID [--cursor N] [--limit N] [--unsafe-output]` | Bounded log page; default 100, maximum 500 |
| `settings schema` | scope flags | Authoritative, redacted settings schema |
| `settings get` | scope flags, optional `--id KEY` | Redacted setting or map |
| `settings set` | scope flags, `--id KEY --value JSON` | Set one typed JSON value |
| `settings set-many` | scope flags, `--values JSON_OBJECT` | Canonical bulk settings mutation |
| `operation get` | `OPERATION_ID` | Current operation status |
| `operation wait` | `OPERATION_ID [--timeout 30s]` | Wait on an existing operation, not resubmit it |

Settings scope is `--scope host` (default), or
`--scope plugin --plugin PLUGIN_ID`. JSON values retain booleans, numbers, arrays,
objects and null; they are not converted to strings. Input must be exactly one
valid JSON value, at most 1 MiB. Bulk input must be an object. `--value -` and
`--values -` read stdin; this is recommended for sensitive input so it does not
appear in shell history/process arguments. Inputs are not echoed to diagnostics.

```sh
"$DEV" settings set --workspace /path/to/workspace \
  --id editor.wordWrap --value true --wait
printf '%s' '{"editor.fontSize":14,"editor.wordWrap":true}' |
  "$DEV" settings set-many --workspace /path/to/workspace --values - --wait
"$DEV" settings get --workspace /path/to/workspace \
  --scope plugin --plugin my-plugin
```

Setting IDs are provider-defined; inspect the schema instead of assuming the
example keys exist. Provider validation and persistence remain authoritative.
Sensitive and unknown values/defaults are always redacted at the host boundary.
This client has no secret-reveal flag or bypass of that policy.

## Extension diagnostics for agents

The Extension Inspector and CLI use the same frontend diagnostic model. The CLI
asks the selected running document for a fresh capture through the authenticated
workspace control endpoint; it does not infer UI registrations from installed
plugin metadata or return a cached registry when the document is unavailable.
The default native document is `main`. Run `extensions windows` to discover
registered runtime names, then use `--window NAME` to select one. Wails browser
mode assigns names such as `browser-3`; these are not aliases for native `main`.
Discovery lists registered documents, not cached diagnostic data or a guarantee
of responsiveness. Every capture still requires a new correlated response from
the selected document's actual Wails window identity.
Wails registration stays in the host adapter, outside the standalone CLI's
pure-Go diagnostic broker and control transport.

```sh
"$DEV" extensions windows --workspace /path/to/workspace --json
"$DEV" extensions inspect --workspace /path/to/workspace --json
"$DEV" extensions inspect --workspace /path/to/workspace \
  --plugin kubernetes --issues-only --json
"$DEV" extensions inspect --workspace /path/to/workspace \
  --point omniview/resource/sidebar/infopanel --json
"$DEV" extensions lookup --workspace /path/to/workspace \
  --point omniview/resource/sidebar/infopanel \
  --plugin kubernetes --resource-key 'core::v1::Pod' --json
```

Snapshots distinguish registered contributions, pending target points, module
failures, captured crashes, and quarantine. Inventory includes every registration
in a single-mode point, not only its selected match. Point ownership and
contributing-plugin ownership are separate. The response identifies its window,
capture time, truncation, configured crash limits, and diagnostic coverage.
Crash counts prefer lifecycle and quarantine counters. Registry-only registrations
fall back to bounded captured crash evidence; that fallback is not a lifetime total.

Inventory and filtering never execute contribution values or matchers. Lookup
is explicit because a plugin's matcher or selector can execute code. Supported
resource sidebar/drawer contexts use the real context contract; other point
types report unsupported rather than guessing. A selected, non-quarantined
registration is eligible for generic rendering, not proof of a successful render.

Freeform errors and stacks are withheld by default. For deliberate local
debugging, `extensions inspect --include-sensitive` requests bounded error text
and prints a warning to stderr. **Plugin error text and stacks may contain
secrets.** Review the output before sharing it or attaching it to an issue.
This flag does not reveal arbitrary contributed values, settings, or credentials
through a separate endpoint.

The frontend must be running and responsive. A closed or unavailable document
returns an error, not an empty inventory. Agent access is JSON through the
existing CLI; it does not require a separate MCP server. The CLI exposes no
extension recovery, reload, or quarantine mutation.

## Operations, output and errors

Mutations return `accepted` plus an operation ID by default. Add `--wait` to wait
for real completion. `--timeout` defaults to 30 seconds and accepts Go duration
syntax such as `500ms` or `2m`; it must be positive. It bounds waiting, not the
accepted backend mutation. Timeout returns partial `accepted`/`running` state and
the same operation ID. Poll `operation get` or `operation wait` against the same
workspace and running host generation. Do not blindly retry the original mutation.

Build/RPC/Vite/controller failures remain structured operation failures. A failed
build is not reported as ready; repair source and use the canonical retained
watcher/rebuild path. UI-only plugins have backend not-applicable state rather
than a fabricated connected backend.

Stdout contains one JSON response/error. By default `plugin dev logs` writes only
redacted log metadata to stderr; stdout contains the response envelope and
`{nextCursor,truncated,count}` metadata. Arbitrary plugin/build output has no
authoritative sensitivity schema, so messages are not revealed by default.

Output delivery failures return exit 5 in both text and JSON modes, including
failures while writing an error or diagnostics. A completed mutation remains
persisted even when its result cannot be delivered; inspect state before retrying.

For deliberate troubleshooting, `plugin dev logs ID --unsafe-output` requests
real bounded log text in JSON stdout and prints a clear warning to stderr.
**Raw plugin/build messages may contain secrets.** This flag is not a promise that
arbitrary plugin output is sanitized. Do not pipe it to shared logs, telemetry or
public issue reports without reviewing it. It does not reveal settings or tokens
through a separate endpoint and is never enabled automatically.

Resume with `--cursor nextCursor`; cursors are offsets in the current bounded
snapshot, not a lossless stable producer sequence across buffer rotation.
Log retrieval never starts an unbounded follow stream. Ordinary settings commands
write no setting values to stderr.

| Exit | Meaning |
| --- | --- |
| 0 | Success, including an accepted mutation without `--wait` |
| 2 | Usage, malformed JSON, or typed parameter/schema validation failure |
| 3 | Missing/ambiguous target, unavailable instance or missing resource |
| 4 | Target/generation/ownership conflict |
| 5 | Build, runtime, persistence, protocol or output delivery failure |
| 6 | Authentication failure |
| 7 | Wait timeout; accepted mutation may still be running |

## Replacing the standalone runner

The nested `cmd/omniview-plugin-dev` module and its independent builder, process,
handshake scanner, watcher, Vite process and PID-file writer are removed. There is
no alias or shim. Start the workspace host first, then use:

```sh
"$DEV" plugin dev link --workspace /path/to/workspace \
  --path /path/to/workspace/my-plugin --wait
"$DEV" plugin dev status my-plugin --workspace /path/to/workspace
"$DEV" plugin dev logs my-plugin --workspace /path/to/workspace --limit 100
"$DEV" plugin dev stop my-plugin --workspace /path/to/workspace --wait
```

Capabilities determine whether the host starts Go, Vite, or both. Do not replace
managed lifecycle with `air`, an external binary, PID-only attachment, or a second
SDK discovery writer. See [plugin development](plugin-development.md) and
[managed lifecycle](development-plugin-lifecycle.md).
