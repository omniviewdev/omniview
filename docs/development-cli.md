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
```

`edit` persists selection/ref/name/port edits. `--apply` also refreshes the workspace:
stop owned services, relink dependencies, rebuild, restart, and verify readiness.
`refresh` uses the current worktree contents without advancing Git refs. `update`
fast-forwards selected repositories before refreshing; it does not discard dirty
edits or reset branches. `recover` resumes refresh work using its durable journal.
Existing `resume` and `rollback` commands handle interrupted workspace creation.

Removing a repository selection retires its worktree but keeps its branch
ownership record for later reselection or explicit branch deletion. Link, unlink,
refresh, and workspace removal validate only live worktrees; a deliberately
retired source is not a missing checkout. A missing or replaced selected worktree
still blocks these operations.

An externally changed dependency tree is a different failure. For example,
running an unmanaged `pnpm exec` can trigger a standalone installation and change
`node_modules` outside the recorded producer transaction. The resulting
`owned generated tree changed` refusal protects unverified bytes. Neither
`workspace recover` nor `workspace refresh` authorizes deleting or adopting that
tree. Keep the workspace and output journal intact for reconciliation; do not
delete the tree or rewrite its ownership record to force cleanup. Use the managed
launcher for package commands to retain pre-run dependency verification.

Refresh commands reuse saved launch settings and protocol evidence. Supply launch
flags for a workspace that has never launched, or override saved settings
explicitly. `workspace evidence` inspects reusable protocol proof;
`--link-evidence FILE` applies supplied proof through the normal link operation.
Refresh revalidates link state rather than treating old link freshness as current.
Workspace commands print human diagnostics by default; `--json` returns structured
errors and results. Control API commands retain their JSON response envelopes.

`workspace inspect` reports independent process, build, dependency, served-source,
readiness, HMR, and source-reload observations. Current checkout commit, branch,
dirty state, and source digest remain distinct from the last served checkout.
Failures name the failed stage and a recovery command. An HMR connection alone
does not prove that an edited source module was served or executed.

To verify an actual source edit, add a unique marker to the module, then run:

```sh
"$DEV" workspace verify-reload feature --module /ui/path/to/module.tsx \
  --marker UNIQUE_SOURCE_EDIT_MARKER --json
```

The command authenticates the owned host and fetches the marker from its exact
Vite endpoint. Evidence proves the edited source was served, not browser execution.

For control API commands, flags may appear before or after the single positional
ID/path, following the command group and action. `--id ID` can replace positional
IDs; `--path PATH` can replace positional paths. Control results are JSON, even
without `--json`.

| Command | Arguments | Meaning |
| --- | --- | --- |
| `instance inspect` | none | Authenticated actual instance descriptor |
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
| 5 | Build, runtime, persistence or protocol failure |
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
