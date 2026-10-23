# Development instance CLI

`omniview-dev` is a native-independent client of a running, isolated development
host. It does not build plugins itself, start another Vite supervisor, expose a
shell, or offer arbitrary file operations. Marketplace publisher CLI commands are
unchanged; `plugin list` here means plugins installed in the selected instance.

Bootstrap the CLI through the public task, which prints its actual immutable
absolute executable path. The host consumes published SDK `v0.6.0`:

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

Flags may appear before or after the single positional ID/path, following the
command group and action. `--id ID` can replace positional IDs; `--path PATH` can
replace positional paths. All results are JSON, even without `--json`.

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
