# Safe development baselines

A baseline is a logical snapshot of selected nonsecret preferences and an **inactive plugin ID/version inventory**. It is not a profile clone, database backup, executable distribution, or live-instance copy. The source must be stopped. Only a new, stopped, named development destination is accepted.

## Integration API

`internal/devbaseline` is native/Wails-independent. A16 owns CLI/orchestrator wiring; this package does not register a command or launch a host.

```go
profile, err := instance.Resolve(instance.Options{
    Workspace: workspaceManifest,
    Home: fixtureOrUserHome,
    Channel: "local",
})
if err != nil {
    return err
}
result, err := devbaseline.Seed(ctx,
    devbaseline.SnapshotOptions{
        SourceRoot: canonicalStoppedSourceRoot,
        SourceVersion: sourceBuildVersion,
    },
    devbaseline.ImportOptions{Destination: profile, Home: fixtureOrUserHome},
)
```

The caller holds its workspace lifecycle operation lock around create/seed/up. **Seed before creating the destination state directory or its `.lock`** and before launching any host. An existing state directory is rejected even when it contains only an empty lock scaffold: replacing that directory would discard the flock inode used by startup. Do not delete an initialized root to make seeding succeed.

`Seed` and direct `Import` internally acquire the shared stable profile guard at `<HOME>/.omniview-dev/locks/<workspaceID>.lock` before checking that the destination is absent, and hold it through validation, staging, and atomic publication. Startup acquires the same guard before its state-root flock, so an absent destination cannot be initialized during import. `Seed` acquires it once and invokes the internal locked import path; callers must not pre-acquire this same non-reentrant guard around either public API. The source's stopped-instance root flock remains a separate lock; source/destination overlap is rejected before acquiring profile/source locks.

For a default UUID profile, both public import APIs establish its ownership marker under that guard before publishing state. A direct `ResolveWorkspace` → `Seed`/`Import` caller therefore gets the same startup-valid ownership handoff as the CLI; no separate build-cache initialization is required. Custom profiles retain their separately validated binding and sibling owner marker.

Separate APIs are available:

- `Snapshot(ctx, SnapshotOptions) (*Baseline, error)` acquires the same `<source>/.lock` used by the application, then reads bbolt with `ReadOnly: true` and one coherent `View`. A busy source returns `ErrSourceBusy`; the CLI should explain that the source instance must first be stopped. It does not retry a live-source clone.
- `Import(ctx, *Baseline, ImportOptions) (Result, error)` revalidates profile identity and reapplies the allowlist even for a decoded or modified snapshot. `Result` includes the state root, `baseline.json` path, and inactive inventory.
- `Seed` validates nonoverlap before acquiring the source lock and combines those operations.

A caller may JSON-encode a `Baseline` for transport. Source root and ancestor identities are SHA-256 fingerprints, not copied source paths. They preserve overlap checks across JSON round trips; they are identifiers, not signatures or artifact trust. Source version is restricted to a bounded version identifier. Inventory provenance is always `unverified-source-inventory`, regardless of source metadata claims.

## Copied preferences

Every key is explicitly allowlisted; adding a field to a category does not add it to baseline export. Current host schema must still define the field as nonsensitive, non-development-only, non-password and non-file-selection. Values are bounded scalar preference values and validators are honored without including their private input in error messages.

| Category | Keys |
| --- | --- |
| `general` | `language` |
| `appearance` | `theme` |
| `editor` | `theme`, `folding`, `foldingHighlight`, `fontSize`, `fontWeight`, `formatOnPaste`, `formatOnType`, `lineHeight`, `lineNumbers`, `lineNumbersMinChars`, `minimapEnabled`, `minimapScale`, `minimapShowSlider`, `minimapSide`, `minimapSize` |
| `terminal` | `theme`, `fontSize`, `cursorStyle`, `cursorBlink` |

Terminal `defaultShell` is deliberately excluded: it can refer to a source executable or worktree. Preference strings cannot carry slash/backslash paths or URLs. Unknown settings and all plugin settings/data are excluded, not accepted through a plugin-schema fallback. Invalid allowlisted values fail closed rather than disappearing silently.

The existing host persists numeric `editor.fontWeight` (including its default `11`) despite declaring that field as Text. Baselines preserve finite integral numeric weights from 1 through 1000 for that exact key only; unrelated text preferences still reject numeric values.

## Unconditional exclusions

No runtime locks, PID/PGID records, `plugin_pids.json`, `devserver_pids.json`, `.devinfo*`, control endpoints/tokens, discovery, logs, caches, temporary files, sessions, terminal instances, native/webview/browser storage, credentials, connections, autoconnect state, or telemetry enablement/auth/export destinations are copied. No executable, plugin directory, source-worktree path, symlink or hardlink is installed. `plugin_state.json` is read only to reconstruct plugin ID/version; enabled flags, development paths, errors and isolation claims are discarded.

Source settings bytes remain unchanged, including on corruption. The writable corruption-recovery settings-store `Open` is never used on the source. If the source has no `.lock`, taking the offline lock may create that empty runtime marker; `source.lockMarker` records `created-for-offline-lock` or `existing`. The lock is not copied to the destination. No source files are renamed or recovered.

Source flock acquisition opens the actual `.lock` without following the final component, verifies the opened inode against the named independent file, and takes the same nonblocking OS lock as the host. Unix uses descriptor-relative `O_EXCL` creation/`O_NOFOLLOW` open and `LOCK_EX|LOCK_NB`; Windows opens reparse points themselves, rejects them, and uses the host's one-byte `LockFileEx` range. A symlink inserted after inspection cannot cause an outside target to be created.

Database integrity checking remains isolated in a same-executable child before the coherent parent read-only transaction. The internal protocol requires both `--omniview-internal-baseline-integrity-v1` and `OMNIVIEW_INTERNAL_BASELINE_INTEGRITY=1`, accepts only the read-only source path on stdin, and exits before application/test main. It does not accept arbitrary commands or write/recover source state. Its output and panic traces are discarded; failure returns a sanitized error rather than private paths/values. The checker has a ten-second/context deadline and a 256 MiB database safety limit. The invoking executable must link `internal/devbaseline` (true for direct API callers and its Go test binary).

Correct checker completion requires the adopted **bbolt v1.5.0** dependency: it recovers validation panics and sends them as errors before closing the checker channel. v1.4.3 can close that channel during panic unwinding and race the child to exit successfully; process isolation alone is insufficient. The damaged-freelist fixture's refusal assertion remains unchanged. After the dependency upgrade, the integration owner reported isolated-HOME full baseline and settings-store suites passing (2.683s and 0.594s); this is fixture evidence, not a cross-platform or real-profile smoke claim.

Legacy core GOB (`<source>/settings`) is read only when there is no bbolt database. Only that single independent file is copied into a private temporary directory, decoded there, filtered, and removed. Plugin legacy data is not traversed. A malformed legacy file fails rather than being silently treated as an empty snapshot. Legacy backups and a migrated database are never written into the source.

## Destination transaction and plugin activation

Destinations must match `devcontract.ResolveWorkspace` for the explicitly selected workspace manifest and supplied profile identity. This accepts either the canonical default UUID state root or an explicitly established custom binding created through `devcontract.SetCustomProfile`: workspace-local `.local/profile.json`, matching sibling `.omniview-profile.json` owner marker, and durable global claim must all agree. Arbitrary environment-selected roots, production/nightly/source overlap, symlink aliases, foreign ownership/claims, and already initialized destinations are rejected. Binding leaves the custom `state` directory absent; Seed stages beside it without rewriting the owner's sibling metadata, then atomically publishes only that new state directory. Runtime/webview roots remain UUID-scoped defaults; a custom state binding is not authority to relocate them.

Import creates a private `0700` sibling stage, uses the existing settings store to create independent `0600` bbolt settings, writes a sanitized `0600` `baseline.json`, checks the staged database read-only, and publishes with a no-replace atomic directory rename. Darwin uses `RENAME_EXCL`, Linux `RENAME_NOREPLACE`, and Windows `MoveFileEx` without replacement. Concurrent initialized destinations are never overwritten. Ordinary failures/cancellation remove the private stage. Process termination before finalization can leave a private `.baseline-stage-*` sibling, but no partially imported destination; it is not an active profile.

Both destination and legacy stages retain an opened directory and inode identity. Failure cleanup traverses only that owned descriptor, refuses a replacement pathname, and rechecks ownership before removing an empty directory name. Successful publication immediately disarms cleanup, so a recreated old stage pathname is not recursively deleted. Ambiguous/replaced stages are left untouched rather than risking another actor's data.

To retain ownership without blocking Windows publication/removal, stages open the child root through a short-lived parent `Root.OpenRoot(child)`, not top-level `os.OpenRoot(stage)`. The supported Go 1.26 Windows descriptor-relative open includes `FILE_SHARE_DELETE`; the parent handle is closed before publication. This permits rename/removal while keeping the owned child descriptor. Regression fixtures exercise finalization and failure cleanup with that descriptor retained; Windows execution remains an integration-owner check.

Files are flushed before publication. Unix directories are synced; Windows uses write-through rename because POSIX directory fsync is unavailable. Unix mode bits are not a substitute for Windows ACL validation; Windows ACL/durability behavior still requires platform evidence. A failure syncing the parent after successful publication returns the populated `Result` with an error explicitly saying the profile was published; orchestration must not assume that error means no destination exists.

Imported inventory lives only in `baseline.json`, **not** `plugin_state.json` and not a plugin directory. Every entry stays inactive, including entries claiming compatible metadata in the source. To activate a plugin, use the existing canonical manager install/link operation with an independently verified isolated-root-compatible artifact or rebuild from the selected destination feature worktree. Do not synthesize a binary, copy the source executable, trust imported isolation declarations, or restore source `DevPath`.

## Fixture regression coverage and evidence limits

`internal/devbaseline/baseline_test.go` and `safety_test.go` use only temporary canonical HOME/USERPROFILE, bbolt, legacy GOB, and JSON inventory fixtures. Coverage includes safe preferences/inactive inventory, independent destination writes, source preservation/contention, valid-metadata damaged freelists isolated from the test process, source symlinks/hardlinks and replacement-lock sentinels, forbidden targets/overlap, current persisted numeric editor preferences, untrusted refiltering, private legacy transformation, staged cancellation/failure, replacement-safe owned cleanup, no-replace publication, and shared stable profile guard contention.

`customprofile_test.go` additionally binds a real fixture custom root and seeds actual preferences plus inactive inventory, checks the sibling owner marker/source DB remain unchanged and runtime/artifact/excluded state remains absent, and rejects foreign owner/claim mutations before source locking or destination staging.

Integration ran the baseline package in the full Go barrier. A real named native Alpha profile additionally refused Snapshot while running, then exited normally before offline import into a newly resolved disposable UUID profile. Actual destination bbolt read Obsidian; writing Solarized Light there left source Obsidian unchanged.

A later canonical workspace seed exercised a real source containing Kubernetes0.2.2 and workspace-probe0.1.0 installs. `create --start --seed-from` rejected the running source with `baseline_source_busy`; after canonical source shutdown and destination down/up recovery, launch copied `solarized-light` and both ID/version entries as `inactive` / `unverified-source-inventory`. The live destination's authenticated plugin list and runnable state were empty, its plugin directory contained no executables, and authenticated host settings returned the copied theme. Source settings/database and inventory SHA256 values stayed unchanged across import. No production data, native storage, plugin settings or credentials were copied. Windows ACL/durability still requires platform-runner evidence.
