# Development package linking

`internal/devworkspace` composes only registry-owned feature worktrees into one **workspace-private pnpm12.14.0 workspace** at the canonical feature root. Git repositories and Go modules remain separate. It does not edit canonical checkouts, create global package links, change published dependency ranges or rely on a parent `go.work`.

## API and ordering

- `Manager.Link(ctx, name, LinkOptions{Evidence: evidence}) (LinkReport, error)` applies and installs links. `name` is the normal registry workspace name/UUID.
- `Manager.InspectLinks(ctx, name) (LinkReport, error)` reports effective package directories, package versions, Go module replacements, and individual resolution failures.
- `Manager.Unlink(ctx, name) (LinkReport, error)` restores recorded source/configuration bytes and original aggregate-file absence, retires exact owned package outputs, and retains the journal on a conflict/failure. It does not start a second independent-root installer; an absent journal makes unlink idempotent.
- `Manager.LinkEvidence(ctx, name) (LinkProtocolEvidence, error)` reads exact accepted journal evidence before a stopped unlink/edit/relink operation. It requires a completed transaction, matching selected manifest, unchanged recorded hashes and valid protocol evidence. Unlinked, incomplete or edited transactions return errors; no synthetic success evidence is provided and no external commands are run.

Link/unlink acquire the lifecycle lock, validate the A03 ownership journal and linked Git worktrees, and acquire the stopped-profile guard. Stop the workspace before changing its dependency graph. Unlink before changing selected repositories or removing the workspace.

Build outputs must exist for effective-resolution diagnostics to pass. A first link can install successfully and still return `link_resolution_failed` when a selected package has no `dist` entry yet. Its durable phase remains `linked`; build in the A15 dependency order, then call `InspectLinks` or re-link to recheck. Do not treat this error as proof of a successful bootstrap. Runtime must build before Vite-plugin shim generation; generated bindings remain the parent's `task bindings` operation.

## Protocol acceptance gate

There is deliberately no unproved default. `LinkOptions.Evidence` must contain successful **workspace/12.14.0** output from the disposable composition probe. Historical independent-root `link` evidence cannot authorize this topology. Selected local exports use explicit workspace mappings with live directory outputs; no unproved `file:` materialization or global links are substituted.

At the quiescent integration barrier, run from the feature host:

```sh
GOWORK=off GOFLAGS= A11_PROTOCOL_PROBE=1 \
  A11_PROTOCOL_REPORT=/tmp/omniview-a11-protocol.json \
  go test ./internal/devworkspace -run '^TestLinkPinnedProtocolProbe$' -count=1 -v
```

Requirements: Go, Node with `import.meta.resolve` and its explicit parent-resolution flag, and native pnpm **12.14.0** on PATH or selected by canonical `OMNIVIEW_PNPM_EXECUTABLE`. Corepack is not required; mixed/incompatible manager pins fail before mutation. The real probe uses registered disposable feature worktrees with spaces, nested source configs and multiple plugins. It checks actual manager selection, cold incompatible peers, recursive peer rejection after a warm peer-only edit, local UI/runtime resolution, React/ReactDOM/runtime object identity and live JS/CSS/declaration visibility across atomic `dist` replacement. Fresh Node processes observe replacements. Evidence is emitted only after all assertions succeed, not from directory/symlink existence or install exit0.

Unmarshal that JSON as `LinkProtocolEvidence` for `Link`. The evidence is a prerequisite supplied by the trusted local orchestrator, not an artifact signature or a claim that real application browser validation has run. This source change alone is not protocol acceptance.

## Consumer roots and singleton behavior

The feature directory is the single pnpm workspace/lockfile boundary above these physical projects:

1. Selected host and its providers/runtime/Vite-plugin packages.
2. Selected UI root and base-ui/ai-ui/editors packages.
3. Every selected plugin's real frontend package root; backend-only plugins add no frontend.

Source package names, versions, dependency ranges, workspace configs and lockfiles remain standalone inputs. The planner explicitly reconciles compatible policies into generated aggregate `package.json`/`pnpm-workspace.yaml`/`pnpm-lock.yaml`, seeds existing registry resolutions, and refuses conflicting/unrepresentable settings rather than silently dropping them. Declared selected manager pins must match **12.14.0**; credentials are never copied into generated metadata.

Build approvals are permissions, not requirements: explicit `allowBuilds` booleans intersect with **deny-wins** across roots. A host approval cannot override a plugin denial. Standalone files remain unchanged, managed installs still prohibit all scripts, and other incompatible policy values still refuse composition.

Locked registry metadata may contain informational prose with support URLs. An embedded URL in a deprecation notice is not a URL-valued resolution; actual URL values still reject userinfo, query/fragment data and unresolved repository-local references.

Local Omniview exports are explicit workspace mappings even when older published dependency ranges differ. React/ReactDOM use the selected host's locked semver providers within the same workspace, not external path links that pnpm12 cannot peer-attest. Managed installs use `--ignore-scripts` and strict peers, followed by **recursive** `pnpm -r peers check --json --lockfile-only`; frozen/up-to-date install alone can skip peer revalidation.

The owned native launcher clears inherited workspace-dir aliases and sets validated `PNPM_CONFIG_WORKSPACE_DIR` to the feature root. Actual package cwd/argv remain unchanged, including nested scripts; a nearer child YAML does not override managed context. Child policies are explicitly reconciled, not presumed inherited.

Diagnostics resolve import-condition exports from each consumer's actual package location, including the runtime package, UI packages, and every selected plugin. Runtime `api`, `models` and `runtime` subpaths are checked independently. Missing exports, missing build outputs and wrong directories remain explicit problems.

The host's CSS entry remains authoritative: `@omniviewdev/base-ui/styles.css` must still map to `@/theme/base-ui.css` in shared dependencies. Package-directory linking does not replace this CSS mapping or bypass the host's cascade layer. The disposable CSS-content probe is not a browser cascade proof. Actual host/plugin singleton identity through Vite aliases, generated shims, and browser rendering must also be exercised by the integration barrier; Node directory checks alone cannot establish that.

## Actual Go consumers

When an SDK repository is selected, the host and every selected Go plugin receive an actual worktree-local `go.mod` replacement:

```go
replace github.com/omniviewdev/plugin-sdk => "/absolute/feature path/plugin-sdk"
```

Go itself writes the properly quoted module syntax. A pre-existing replacement to the same local SDK is retained byte-for-byte; a different replacement, a registry replacement, or a version-specific override is a conflict. Other replacements are untouched. Commands always force `GOWORK=off` and clear ambient `GOFLAGS`, so neither a parent workspace nor an unrelated modfile can masquerade as the effective module. Inspection executes `go list -m -json github.com/omniviewdev/plugin-sdk` from every actual Go consumer. Selected SDK compatibility still requires the trusted local builds owned by A15; version strings or metadata are not build attestations.

## Reversibility and conflicts

`.local/links.json` is separate from A03's lifecycle ownership journal. It records workspace identity, selected manifest, consumer plan, protocol evidence, and original/applied bytes and SHA-256 hashes for modified pnpm configuration/lockfiles and Go mod/sum files. Original absence and permission bits are retained. The journal is persisted before applying edits and before running an installer. Only `pnpm-lock.yaml` is an expected pnpm output: successful output is captured after all configuration hashes are checked. Manifest, workspace YAML and Go-file bytes are never adopted from an external process. A concurrent editor change conflicts and remains untouched. Changed lockfile bytes left by a failed command remain pending/unverified and require reconciliation rather than automatic overwrite.

Re-link does not reinstall or rewrite an unchanged completed transaction; it inspects effective resolution again. Unlink preflights every recorded file before restoring any file. A subsequent user edit yields `link_conflict` instead of being overwritten. Files already restored to their original hash are safe for interrupted unlink retries. A process crash during an installer that leaves bytes not covered by its last durable hash is an explicit unverified conflict, not permission to assume ownership. Preserve those bytes and reconcile them before retrying.

Selected repository directories, package directories, frontend roots and package manifests must resolve to their exact owned feature paths. Symlink redirects to canonical checkouts or other locations are rejected before planning can mutate configuration. SDK replacement validation scans every entry, so a matching unversioned replacement cannot hide a later conflicting version-specific replacement.

Unlink and canonical stopped edit/remove restore exact aggregate/source contents or original absence and retire only independently owned outputs. `node_modules` is derived package-manager state, not a byte-for-byte user-data backup. Unknown ignored files, modified distributions, foreign roots and uncertain live writers remain explicit refusals; no force-cleaning or production profile/credential import is authorized.
