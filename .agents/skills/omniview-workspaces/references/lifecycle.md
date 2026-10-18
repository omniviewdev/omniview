# Source-defined lifecycle commands

Authority: host `cmd/omniview-dev/workspace_commands.go`, `control_commands.go`, `internal/devworkspace/{registry,lifecycle,launch,status,links}.go`. Consult current source when behavior changes. Examples below have not themselves been executed by skill authoring; neither a parser nor a help listing proves build/start success.

From the host checkout, capture the actual immutable CLI path printed by the build helper once:

```sh
DEV="$(SDK_SOURCE="$FIXED_SDK_SOURCE" task --silent dev:cli:build)"
```

The helper writes outside source in the private OS user cache; do not guess `$PWD/bin/omniview-dev`, add an alias, or rebuild a CLI under the source tree while its supervisor owns that checkout. Initial/root bootstrap needs explicit canonical `FIXED_SDK_SOURCE` because the reviewed fixed SDK is unpublished. Within an enclosing workspace, SDK selection may derive only from its canonical manifest—not a guessed sibling. Commands below invoke the captured `"$DEV"`; other references' `omniview-dev` denotes this CLI, not an assumed PATH install.

Managed JavaScript uses **one stock pnpm12.14.0 workspace per feature** above the selected physical worktrees; Git repositories, Go modules and profile UUIDs remain separate. Native pnpm must be on PATH or explicitly selected by canonical `OMNIVIEW_PNPM_EXECUTABLE`. The owned launcher sets `PNPM_CONFIG_WORKSPACE_DIR` to the validated feature root while preserving package cwd/argv; do not point it at another feature or assume a child YAML policy is inherited. Do not manually edit generated aggregate files or run an unowned child installer beside a managed session.

Use a successful **workspace/12.14.0** protocol report, not historical pnpm10/link evidence. Install exit0 is not peer proof: the managed path requires recursive `pnpm -r peers check --json --lockfile-only`, including after peer-manifest changes. Policies are reconciled at the aggregate root; conflicts fail rather than weakening peers, script restrictions or source ownership.

Shared lock snapshots use the developer-approved host→selected UI→stable remaining-source seed order. Necessary transitive edges may converge, while standalone locks remain unchanged and integrity conflicts still refuse. Inspect `seedConvergence` / canonical `plan.composition.convergence`; do not claim all standalone graphs remain identical or bypass the final native install/recursive audit.

## Establish a collection once

Read `COLLECTION/.omniview-dev/repositories.json` if present. It is explicit machine-local source authority (`id`, `commonDir`, optional `worktree`, `defaultRef`, `directory`), not a feature path map. Do not recursively search parent directories for clones or guess which duplicate clone is current. With no registry, initialize known paths:

```sh
"$DEV" workspace init --root "$COLLECTION" \
  --source "omniview=$HOST_CLONE" --source-ref omniview=main \
  --source "ui=$UI_SOURCE" --source-ref ui=main \
  --source "plugin-sdk=$SDK_CLONE" --source-ref plugin-sdk=main \
  --source "kube-repo=$KUBE_CLONE" --source-ref kube-repo=main \
  --source "metrics-repo=$OTHER_PLUGIN_CLONE" --source-ref metrics-repo=main --json
```

IDs `kube-repo`/`metrics-repo` are examples: use the actual registry IDs. `--source ID=PATH` accepts a normal checkout, linked worktree, or bare Git repository (for example `ui/.bare`); a normal UI clone works too. `--source-directory ID=NAME` controls the feature directory; optional `--source-ref ID=REF` selects the committed default. Detached sources need an explicit ref. Do not assume all machines have the conventional `omniview`, `plugin-sdk`, `omniview-plugin-kubernetes`, `ui/.bare` + `ui/main` layout. Conflicting existing registries fail rather than being silently replaced.

## Create and start once

For host + UI + SDK + two distinct plugins, use this **single command template**, substituting real registered IDs and actual plugin metadata. The plugin ID is not necessarily its repository ID:

```sh
"$DEV" workspace create "$FEATURE" --root "$COLLECTION" \
  --name "$DISPLAY_NAME" \
  --repo omniview --repo ui --repo plugin-sdk \
  --repo kube-repo --repo metrics-repo \
  --plugin kubernetes --plugin metrics \
  --start --mode browser --watch=true --live-frontend=true \
  --reviewed-sdk-revision "$FULL_REVIEWED_SDK_REVISION" \
  --link-evidence "$SUCCESSFUL_PINNED_LINK_PROBE_JSON" --json
```

Host `omniview` is required; launch also requires selected SDK. Select UI only when needed. Use repeated `--ref ID=REF` for selected repository overrides. References must resolve committed metadata; never invent a second real plugin. Missing reviewed **full** fixed-capability SDK revision or successful actual pinned pnpm protocol probe is a prerequisite, not permission to forge evidence. See host `docs/development-package-linking.md` for the real probe contract. No global `pnpm link`, guessed `file:` protocol, or published SDK fallback.

Use `--mode native` instead for a desktop app; `--mcp` is optional and native-only. `--timeout 20m` bounds startup. Watch/live frontend default true; disabling them is explicit. Source-defined orchestration still needs the parent's real compile/link/start barrier before claiming it works end to end.

For an existing selected workspace, root `task dev` is the canonical CLI `workspace up` wrapper, not an independent `wails dev` supervisor. It defaults to native; `SERVER=true` selects browser and `WAILS_MCP=1` opts into native MCP. Task dev/workspace wrappers capture the cache helper once internally without adding a path to command JSON stdout. For direct invocation, use the captured path:

```sh
"$DEV" workspace up "$FEATURE" --mode browser \
  --root "$COLLECTION" \
  --reviewed-sdk-revision "$FULL_REVIEWED_SDK_REVISION" \
  --link-evidence "$SUCCESSFUL_PINNED_LINK_PROBE_JSON" --json
```

Do not start a second Wails/Vite supervisor beside this managed session. A reviewed fixed SDK commit available only in the local source collection is not a published module: ensure every selected SDK checkout can resolve that exact commit rather than claiming an unpushed revision can be fetched from a remote module release.

After create/start (or failure), obtain authoritative paths and status:

```sh
"$DEV" workspace inspect "$FEATURE" --root "$COLLECTION" --json
"$DEV" workspace paths "$FEATURE" --root "$COLLECTION" --json
"$DEV" instance inspect --workspace "$FEATURE" --root "$COLLECTION" --json
```

Read returned `manifest.workspaceID`, `root`, `stateRoot`, `generation`, `launchPhase`, `instance.endpoints` and build/service errors. `paths` maps repository IDs to actual feature paths. Never copy another feature's UUID or endpoints. `--workspace /absolute/workspace.json` or workspace directory is an alternative explicit selector. Absolute `OMNIVIEW_WORKSPACE_FILE` and enclosing manifests can select context, but disagreement/ambiguity fails; no production fallback. Do not unset a conflicting environment merely to evade a target conflict—first establish the intended workspace.

## Existing work and changes

| Need | Source-defined command (add `--root "$COLLECTION" --json`) |
| --- | --- |
| List registered features | `workspace list` |
| Inspect/select existing | `workspace inspect "$FEATURE"`, then `workspace paths "$FEATURE"` |
| Recover interrupted lifecycle journal | `workspace resume "$FEATURE"` |
| Reverse recoverable journal intent | `workspace rollback "$FEATURE"` (review retained-work conflict first) |
| Start stopped/crashed workspace | `workspace up "$FEATURE"` with launch prerequisites above; recorded up options are reused unless explicitly changed |
| Stop/restart owned session | `workspace down "$FEATURE"` / `workspace restart "$FEATURE"` |
| Change stopped selection | `workspace edit "$FEATURE" --add-repo ID --add-plugin PLUGIN_ID` (repeat; `--remove-repo`, `--remove-plugin`, `--ref ID=REF`, `--name`, `--slug` supported) |
| Apply/diagnose local links while stopped | `workspace link "$FEATURE" --link-evidence "$SUCCESSFUL_PINNED_LINK_PROBE_JSON"` |
| Restore owned overlays while stopped | `workspace unlink "$FEATURE"` |

`resume` resumes lifecycle metadata, not a substitute for `up` or plugin rebuild. Do not run `up` against an already-owned live supervisor; inspect it, repair source, or restart as appropriate. Keep the same feature UUID and dirty source. Link reports retain expected/resolved paths and problems; missing dist exports require ordered bootstrap, not suppression. Link conflicts/user-edited overlay bytes require explicit reconciliation, not deleting journals. Build order: `task bindings` only; UI base-ui → ai-ui/editors; providers/runtime **before** Vite plugin/shims; selected plugins and host. Do not run competing writers beside the supervisor graph.

Ordinary dirty SDK APIs are source-digested and rebuilt by the trusted local builder against an independently reviewed baseline—no commit/review per edit. Protected isolation-core changes need explicit review and workspace `--allow-isolation-source-changes`; this is not a sandbox. Do not enable it for unrelated failures.

## Failed plugin build / occupied port

A live old binary, process, port, or `/health` is not current readiness. Keep the failed operation and source changes, read errors, repair the cause, then use **plugin generation**, not host generation:

```sh
"$DEV" plugin dev status kubernetes --root "$COLLECTION" --workspace "$FEATURE"
"$DEV" plugin dev logs kubernetes --root "$COLLECTION" --workspace "$FEATURE" --limit 100
"$DEV" plugin dev rebuild kubernetes --generation "$PLUGIN_GENERATION" \
  --root "$COLLECTION" --workspace "$FEATURE" --wait
```

Default logs expose redacted metadata. `--unsafe-output` deliberately reveals potentially secret raw output; never enable/share automatically. Wait timeout does not cancel a mutation: use `operation wait OPERATION_ID --root "$COLLECTION" --workspace "$FEATURE"`, not resubmission. Reinspect current UUID/generation/endpoints after recovery. Refuse an occupied strict port; do not kill/adopt its listener or change a descriptor manually. Resolve the conflict through owned down/up/restart and inspect actual addresses. A failed build remains not ready until real successful current-generation recovery.
