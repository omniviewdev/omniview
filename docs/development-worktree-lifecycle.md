# Development worktree lifecycle

`internal/devworkspace` owns repository registration and feature-worktree filesystem operations. It is native-independent; it does not launch the host, install dependencies, create global links, connect clusters, or inspect production settings. CLI command wiring lives separately in `cmd/omniview-dev`.

## Registered sources

Initialize one machine-local registry at `<root>/.omniview-dev/repositories.json` using `Init(ctx, InitOptions{Root: root})`. The standard discovery layout is:

| Repository ID | Git source | Existing source checkout | Feature directory |
| --- | --- | --- | --- |
| `omniview` | `omniview/.git` | `omniview` | `omniview` |
| `plugin-sdk` | `plugin-sdk/.git` | `plugin-sdk` | `plugin-sdk` |
| `kubernetes` | `omniview-plugin-kubernetes/.git` | `omniview-plugin-kubernetes` | `omniview-plugin-kubernetes` |
| `ui` | `ui/.bare` | `ui/main` | `ui` |

Only existing standard sources are registered; the host is required. Historical `omniview.git` and `plugin-sdk.git` are not silently substituted. For another layout, supply `InitOptions.Sources` explicitly. Each `SourceSpec` contains `ID`, `Path`, optional `Worktree`, `DefaultRef`, and `Directory`. Relative source paths are relative to the configured root; the registry stores canonical local Git/common-directory and checkout paths, not URLs or credentials. Bare sources may omit a checkout. Detached sources require an explicit default ref.

Duplicate IDs, common directories, destination directories, or origin identities are rejected. Different HTTPS/SSH credentials or transport spellings do not distinguish clones of the same remote. Reinitializing the identical registry is harmless; reinitializing with different mappings fails without replacing the existing registry. Existing source clones/checkouts are never relocated, reset, or cleaned.

`LoadRegistry(root)` exposes the validated source map read-only. `Open(root, Options{Home: home, Stopped: guard})` creates a lifecycle manager. `Home` selects the profile boundary through the shared resolver; it is not substituted into subprocess environments.

## Create and recover

`Manager.Create(ctx, CreateOptions{Slug, DisplayName, Repositories, Plugins, Refs, Baseline})` creates `<root>/workspaces/<slug>`:

- `workspace.json` is portable intent: immutable new UUID, display name/slug, selected repositories, requested refs and resolved commits, owned branch names, managed plugin identities, link intent, and development profile/port policy.
- `.local/ownership.json` is the private local transaction journal: Git common/admin paths, ownership refs, edit intent, and creation/removal progress. Do not copy this journal to claim ownership of another checkout.
- Every selected source gets a real linked Git worktree. The host is always selected. Optional repositories are registered IDs; repeatable plugin IDs are resolved from committed `plugin.yaml` at the selected source ref, not inferred from repository filenames or a dirty source checkout.
- Branches are `feature/<slug>-<first-eight-UUID-characters>`. Git atomically reserves each new branch together with its workspace ownership ref. An existing branch, even at the same commit, is never attached without the matching journal/ownership reservation.
- Profiles are separately owned at `~/.omniview-dev/profiles/<UUID>` (under the configured home), with a `.workspace-owner.json` marker. No production/nightly profile is copied or read.

Creation first writes a durable ownership journal and portable manifest in an exclusive hidden `.create-<UUID>` sibling directory, then atomically publishes the named directory before any Git mutation. An unpublished durable intent can be resumed by slug/UUID, including interruption before its first manifest write; a second create never allocates a replacement identity for that intent. `Resume(ctx, name)` continues a pending owned create, edit, or rename without following a moved base ref. `Rollback(ctx, name)` applies only to interrupted initial creation and removes only owned clean worktrees and unchanged owned branches. Planned branches whose ownership reservation never succeeded remain untouched. Foreign files, changed owned branches, dirty worktrees, or foreign checkouts prevent destructive cleanup.

CLI `resume`, `rollback`, and `remove` accept an explicit manifest or workspace directory through `--workspace` from outside the collection. Without `--root`, the canonical workspace path determines the collection; an explicit conflicting `--root` still refuses. Recovery resolves through the ownership journal rather than requiring a surviving manifest. A registered feature name is positional (`workspace up "$FEATURE" --root "$COLLECTION"`), not a name-valued `--workspace` path flag.

A root-scoped OS flock serializes lifecycle mutations. A competing mutation returns a conflict rather than waiting indefinitely. After a killed process, OS locks release automatically; do not delete arbitrary lock files or Git directories.

Ownership staging protocol version 1 reserves exact per-workspace filenames for manifest/journal writes before publication. A partial write at one of those reserved names can be recovered from the durable journal; arbitrary `.write-*` files, directories, and symlinks are never guessed to be disposable.

## Inspect and edit

Names resolve within the configured root by directory name, manifest slug, or UUID. An explicit missing name is an error, never a fallback to an enclosing workspace or production. `Inspect` returns the shared resolved workspace plus transaction phase; `List` returns sorted workspaces; `Paths` returns canonical repository paths and profile state/runtime/webview paths. Absolute machine paths never enter the portable manifest.

A validated machine-local `.local/profile.json` may select custom state through `devcontract.SetCustomProfile`. Its canonical UUID/state record must match the external `.omniview-profile.json` owner marker and durable custom-profile claim. Rename/removal capture the selected state root and exact binding-file SHA256 in the ownership journal/retirement receipt; a filename alone never proves ownership. Custom state remains absent until seeded or started. Runtime/webview paths always remain under the canonical default `~/.omniview-dev/profiles/<UUID>/{runtime,webview}`, not beside custom state.

`Edit(ctx, name, EditOptions{DisplayName, Slug, AddRepositories, RemoveRepositories, AddPlugins, RemovePlugins, Refs})` preserves UUID and profile identity. Unchanged refs remain pinned even when source branches advance. Ref changes must fast-forward an unmodified owned feature branch; they never reset or rewrite history. A worktree with user commits must preserve that history instead of changing its source ref through this operation. Removed source branches remain available by default. Remove plugin selections before removing their selected source repository.

`CreateOptions.Ports` and `EditOptions.Ports` accept a complete `*devcontract.PortPolicy`. Nil means sticky defaults during creation and preserves the existing policy during edit. Overrides are copied, not retained as aliases to caller-owned maps; the shared manifest validator rejects invalid policy/port combinations before any worktree mutation. The CLI validates currently supported listener role names; the portable schema remains extensible.

Slug rename atomically moves the owned feature directory and repairs Git worktree administrative pointers. The rename intent travels inside that directory, so `Resume` using the new directory name or UUID repairs a rename interrupted after the filesystem move. Existing feature branches keep their names. Rename requires clean owned worktrees and no unrecognized local metadata. The CLI's `Reconfigure` orchestration automatically unlinks dependency/producer overlays before `Edit` and relinks the committed selection afterward; direct `Manager.Edit` callers must supply clean worktrees. After source/ref/target/profile and generated-ownership preflight, rename retires only ledger-attested generated output, preserving the original UUID-scoped native bundle in its external removal snapshot before cleaning build files. UUID, default/custom state and native storage identity remain unchanged; changed, unknown or redirected output refuses cleanup without deleting it.

The validated rename intent is durable before generated cleanup begins. If cleanup is interrupted, `workspace resume` finishes only the existing attested deletion plan before applying source changes and moving the directory; injected or changed output still refuses recovery without adopting it. Combined source additions also preflight Git ref namespace conflicts, including ancestor/descendant branches, before retiring any generated output.

For edits, recovery, rollback, and removal, the caller supplies `Options.Stopped(ctx, resolvedWorkspace)` to prove host/owned child sessions stopped. The lifecycle first acquires `devcontract.LockProfile(ctx, home, UUID)` at `~/.omniview-dev/locks/<UUID>.lock`, outside the deletable profile. It then acquires the existing canonical `state/.lock` OS flock if the state root exists. Absent state remains absent, so recovery/edit cannot block an optional baseline import by scaffolding state. Startup and baseline import use the same stable guard, in stable-guard-before-state-flock order. A missing guard fails closed; purge never removes the stable lock inode. Startup may hand off from the stable guard only after acquiring the state-root flock.

## Remove and retained state

`Remove(ctx, name, RemoveOptions{})` preflights all selected and previously retired resources, then removes clean owned worktrees and known lifecycle metadata. Default removal retains both profile state and feature branches, including user commits. It does not force-remove tracked changes, untracked/ignored files, detached checkouts, moved/foreign worktrees, or user files in the feature root.

`DeleteBranches: true` is explicit and stricter: each branch must still equal its journaled base commit and ownership marker, and must not be attached to a foreign worktree. User commits are never deleted even with this flag. Explicit `PurgeState: true` removes the owned default UUID filesystem profile, including runtime/webview data. With a custom binding it additionally deletes the selected custom `state` child but retains the external container owner marker and global claim. Both namespaces are validated before Git removal; an absent default profile is harmless, while an existing unmarked/foreign profile is not adopted. The stable UUID guard and both distinct existing state-root flocks protect the purge. Native WK UUID datastore removal is separately orchestrated; no filesystem operation here claims to remove it.

A pending removal is continued with the same `Remove` flags, not with `Resume`. Unknown files in `.local`, including an active dependency-link journal, block removal rather than being recursively deleted. Restore/unlink those integrations first. After removing owned worktrees, the lifecycle atomically retires the directory to `.retired-<UUID>` and retains an external receipt in `<root>/.omniview-dev/retirements/<UUID>.json` until the retired directory itself is durably gone. A crash after unlinking its inner manifest/journal is therefore resumable. Known-file removal never deletes foreign data recursively; such a conflict retains the receipt for safe recovery.

The orchestrator may supply `RemoveOptions.ValidateGenerated func(context.Context, Workspace) error` to validate every non-lifecycle `.local` file/tree against the external generated-resource ledger. It is read-only and must reject changed or unrecorded resources. `BeforeRemove func(context.Context, Workspace, []GuardFile) error` then runs only after all metadata/profile/worktree/branch refusal checks, while the root lifecycle lock, UUID guard, and existing state-root locks remain held. The hook completes native cleanup before removing its own proven generated outputs; errors retain source worktrees. Lifecycle metadata is checked strictly again after the hook, before the first removal journal/Git/profile mutation. A11 dependency overrides must already be restored/unlinked.

On Darwin only, `GuardFile{Role string, File *os.File}` lends the actual retained BSD-flock file descriptions. Roles are exactly `uuid` (always), `selected-state` (when selected state exists), and `default-state` (only when distinct default state exists). The callback may pass duplicates using `Cmd.ExtraFiles`; neither it nor the child may unlock/close the parent's files. The child validates expected-path file identity and flock ownership, then closes its inherited duplicates **without** `LOCK_UN`. Parent locks remain held through native completion and subsequent filesystem/Git commit. Other platforms retain the existing lock implementation and provide no Darwin FD capabilities. This is not a lock-skipping flag or an advisory preflight that releases guards before native deletion.

## Regression coverage and integration verification

`internal/devworkspace/lifecycle_test.go`, `lifecycle_review_test.go`, and `internal/devcontract/profilelock_test.go` use disposable real normal/bare Git repositories and temporary homes. They cover source paths with spaces, plugin identity, occupied branches, independent features, interrupted create/ref/rename/removal boundaries, reserved partial writes versus foreign files, absent baseline destinations, stable lock contention across profile deletion/recreation and container aliases, dirty/foreign worktrees, user commits, retention/purge, file-URL source duplication, and portable-manifest tampering. No actual user state or application launch is involved.

At the integration barrier, the integration owner should format these Go files and run `GOWORK=off go test ./internal/devcontract ./internal/devworkspace -count=1`, followed by the CLI tests after wiring. These checks are intentionally not run by parallel implementation workers.
