# State, baseline and removal boundaries

Authority: host `internal/devcontract/{workspace,customprofile}.go`, `internal/devbaseline`, `internal/devworkspace/lifecycle.go`; operational details in `docs/development-baselines.md`. Inspect current integration evidence rather than assuming an option is runtime-proven.

## Custom state root

Default state is `~/.omniview-dev/profiles/<workspace-UUID>/state`, separate from feature source. Custom roots use source-defined `workspace create NAME --state-root /absolute/new-container/state` or `workspace profile NAME --state-root /absolute/new-container/state` (both accept `--root COLLECTION --json`). `profile` binds an existing **stopped** workspace; it does not move/copy old data. Create can combine binding and `--start`.

The custom leaf must literally be `state` under a new dedicated absent/empty canonical container. Its sibling `runtime` belongs to that container. The binder records `.local/profile.json`, container `.omniview-profile.json`, and a durable matching claim in `~/.omniview-dev/custom-profiles.json`. These are ownership metadata, not portable manifest intent. Do not hand-author them, reuse an arbitrary directory, or bypass them with `OMNIVIEW_STATE_DIR`. Claims survive rebinding so old state cannot be silently adopted by another workspace.

Container/state/runtime must not overlap production/nightly/default profiles, any selected source/worktree/common Git storage, the registered collection, another claim, or each other through aliases. Symlink aliases and shared-parent containers fail closed. Select the actual resolved state/runtime from inspect; do not infer runtime under the state leaf. A custom profile is local isolation, not a security sandbox or remote-cluster boundary.

## Explicit safe baseline

Default is empty, disconnected state: no production preferences/credentials are needed to start. Optional `--seed-from /absolute/stopped/source/state --seed-version NONSECRET_VERSION` on `create --start` or `up` requests safe baseline seeding **before** first destination-state creation/launch. Do not precreate the `state` leaf. Source must be stopped; a busy source is a real refusal, not permission to copy bbolt or a raw tree. If production must remain running, start empty; do not weaken snapshot consistency.

Only allowlisted nonsecret general/appearance/editor/terminal values are eligible. Exclude credentials, secrets, unknown/plugin settings, connections/autoconnect, kubeconfigs, executable/plugin binaries, PID/devinfo/control/token/lock/discovery/log/browser data and source paths. Inventory imported from baseline stays **inactive/unverified**, not an installed compatible plugin. Rebuild/install/link explicitly through the selected host's canonical operations; do not execute imported unknown artifacts.

Custom-root binding and baseline import have separate validators. Before combining `--state-root` with `--seed-from`, establish that the current baseline destination validator consumes the same ownership binding and that the combined path has real integration evidence. If it still rejects custom roots, report that specific gap; use empty custom state or an approved default-profile seed, not a validator bypass. This is a current integration gate, not a permanent claim that the combination is impossible.

No startup or test should auto-connect Kubernetes or another external service. Any authorized remote check needs an explicitly named disposable context/account and separate approval for remote effects. Never read real credentials/cluster state just to demonstrate local readiness.

## Stop/remove while preserving user work

```sh
omniview-dev workspace down "$FEATURE" --root "$COLLECTION" --json
omniview-dev workspace remove "$FEATURE" --root "$COLLECTION" --json
```

No `--delete-state` or `--delete-branches`: state and feature branches are preserved by default. Removal still preflights ownership and dirty/user commits/ignored work. A refusal is the required safe outcome; report exact conflict, retained worktree/branch/state paths and stop deletion. Committing dirty edits does not guarantee owned-branch deletion becomes safe. Do not invent `--force`, `--preserve-state`, automatic stash/commit/reset/clean, `rm -rf`, manual worktree removal, registry edits or lease/PID cleanup.

`--delete-state` and `--delete-branches` are separate explicit destructive requests, not routine teardown flags for a human feature. Only the owning disposable harness should request them for its own data, and refusal still stands. Stop/cleanup touches only verified owned process generations; a port, lease or PID alone is not authority. Native browser data cleanup is platform-specific and needs its own real evidence; deleting source is not proof it was purged.
