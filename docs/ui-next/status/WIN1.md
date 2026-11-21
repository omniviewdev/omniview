# Status: WIN1 (plugin uninstall, update and reinstall on Windows)

- Agent: WinPluginFs. Host branch `fix/win1-plugin-roots-windows`, worktree `~/Repos/omniviewdev/worktrees/win1-plugin-roots-windows`, one commit on `origin/main` `c1042d3b`. SDK: `omniviewdev/plugin-sdk` pull request #81, branch `fix/win1-close-plugin-metadata`, worktree `~/Repos/omniviewdev/worktrees/plugin-sdk-win1-close-plugin-metadata`, one commit on `main` `bb9981f`.
- Experiments ran on branches with no pull request: host `wip/win1-probe` (handle probe, B4 before) and `wip/win1-host` (this change plus a throwaway Windows-only workflow `.github/workflows/wip-win1-windows.yml`), SDK `wip/win1-close-plugin-metadata` (same idea). The throwaway workflows are not part of either change.
- Load at the macOS measurements: `uptime` 1-minute load 5 to 67 (other agents share the machine; the whole-module run was at 5 to 21). Windows runs are on GitHub's `windows-latest`, Go 1.27.4.

## For a Windows user, in plain words

**Before.** Uninstalling a plugin the host had loaded, updating it, or reinstalling it failed with "Access is denied". The plugin was left half-removed: moved into a hidden staging folder, with a recovery marker, and listed as failed. A later retry sometimes worked, which made it look random. Two things caused it, and either one alone was enough: (1) the host read each plugin's `plugin.yaml` through the plugin SDK, which never closed the file, so the file stayed open until Go's garbage collector got around to it (CI5-W1, backend catalog B-72); (2) as soon as the host had used a plugin's `store` or `data` folder (every plugin with connection profiles), it kept that folder open for as long as it ran, and Windows will not move or delete a folder that has anything open inside it (CI5-W2, B-73).

**Now.** The host closes every manifest file it reads (`internal/pluginmeta`, until the SDK that closes it is pinned), and the folder the host keeps open lets go for exactly as long as the plugin manager moves or deletes the folder above it, then opens again where the folder went. Uninstall, update, failed update (rollback) and reinstall work with the host's folders held, and a lookup or save that arrives in the middle of a move waits for it instead of failing the update. On the Windows runner the 19 tests that failed on the manifest leak pass, and so do the 8 `internal/appstate` tests that needed the folder fix, and five new tests that run uninstall, rollback, update, failed update and updates under load with the host's folders held. Not proved on a real Windows desktop (see "Not run on Windows").

## Decision B1: the smallest correct cure, and why

Measured on `windows-latest` (run 44887619646 of `wip/win1-probe`, `internal/appstate/zz_win1_probe_test.go`, not kept). A handle is held, then `plugins\flux` is renamed:

| Handle held | rename `flux` | rename `flux\store` itself |
|---|---|---|
| none | ok | ok |
| `os.OpenRoot("flux\store")` (what `scoped.go` did) | **Access is denied** | refused (sharing violation) |
| root opened through another root, `plugins.OpenRoot("flux/store")` (Go opens it with `FILE_SHARE_DELETE`) | **Access is denied** | ok |
| a file under `flux\store` held, through a root or `os.Open` | **Access is denied** | refused |
| root on `flux` itself, through another root | ok | ok |

- `os.OpenRoot` opens its top directory without `FILE_SHARE_DELETE` (Go 1.27 `os/root_windows.go`). A root opened through another root does allow it (`internal/syscall/windows/at_windows.go`, `Openat`), but the table shows it does not help: **Windows refuses to rename a directory that has any handle open beneath it, whatever its share mode.** So no way of opening the root cures the uninstall, the update or the reinstall. Option 2 of the assignment is out; the answer to "does `os.Root` allow it" is: for the state directory itself yes, for the plugin directory above it no.
- Option 1 as worded (release the roots before the rename, open again lazily) is not safe either, for two reasons the existing tests state: the resource controller's authority resolver holds one root for the life of the process (`resource/catalog_binding.go`), and #613's own tests (`TestInstallPluginFromPath_ConcurrentStateLookups...`) require the root a holder kept across an update to be the same `*ScopedRoot` and to work afterwards; and a lazy lookup that races the rename would open a handle that blocks it.
- **Chosen:** the plugins root (`Service.Plugins()`, through which the manager stages, publishes and deletes plugin directories) closes the cached store and data roots beneath a directory for exactly as long as it renames it (`ScopedRoot.RenameDirectoryNoReplace`, `Rename`), runs the rename, and opens each root again where its directory went, **under the same `*ScopedRoot`**, if it is the directory the root was open on (`os.SameFile`); a failed rename opens them where they were; a root that cannot be found is closed and forgotten like a released one. Deleting a tree (`RemoveAll`) closes the roots beneath it for good, and the manager's `ReleasePluginRoots` still forgets them once the uninstall is durable (the order #613 pins is unchanged). The service holds its mutex across the rename and a moving root is write-locked, so a lookup or an operation that arrives meanwhile **waits** and then sees the plugin where it went: nothing opens a handle that blocks the move and nothing creates a directory in its way.
- **The same code path on every OS**, so the Unix test runs exercise the Windows cure: `internal/appstate/plugin_roots_relocation.go` (the service), `scoped.go` (every operation read-locks the root; `FS()` resolves the handle per call), no change in `backend/pkg/plugin` beyond the call sites below. The manager needed no change because it already moves directories through `pm.pluginsRoot`.
- A file or child root a caller opened through a held root is the caller's and blocks the move on Windows (documented in `docs/plugin-development.md`); no host code keeps one across an install operation.

## B2: the host and the SDK's leaking loader

Every call of `types.LoadPluginMetadata` in the host (16, found by `go/parser` over the whole tree, not grep) now goes through `internal/pluginmeta.Load`, which returns what the SDK returns, error text included (a parity test compares them), and closes the file: `backend/pkg/plugin` `archive_transaction.go:584`, `connection_sharing.go:87`, `loader.go:201`, `manager.go:785`, `reconciler.go:80,179`; `backend/pkg/plugin/devserver` `gowatch.go:725`, `instance.go:117`, `manager.go:207` and three tests; `internal/devworkspace` `plugin_archive.go:63`, `supervisor_runtime.go:584`. CI5 listed five; `connection_sharing.go`, the dev server and `devworkspace` were not on its list. No forced garbage collection. Two tests keep it honest: `TestNoHostCodeCallsTheLeakingSDKLoaders` fails on a new call of the SDK's loaders, and the tripwire `TestPinnedSDKStillLeavesTheManifestOpen` fails on the day the pin reaches the fixed SDK and says to delete the package (as #551 did for the error sentence). **SDK to pin: v0.20.1** (the PR above; `main` has two unreleased fixes after v0.20.0, so the tag carries all three). The owner tags; this change does not.

## B3: un-skipped

- **W1, 19 of 19** (`WINDOWS DEFECT CI5-W1` skips removed): all pass on the Windows runner (run 44889774187, wip). The `remove` case of `TestUninstallPlugin_DoesNotPublishInventorySuccessOnFailure` keeps its own Unix-only skip ("the host never moves its own root").
- **W2, 16**: `SkipIfOpenRootBlocksRename` is deleted (it probed Go, not the product, so it could never have lifted itself). The 8 `internal/appstate` tests now move directories through the plugins root, as the manager does, and **all 8 pass on Windows**. The 8 in `backend/pkg/plugin` lose the defect skip, and on Windows they still skip, now by the credential fixture's own plain reason (`credentialArchiveVersion`: the fixture archive carries a Unix shell script as `bin/plugin`, B-74). They pass on macOS. The same flows are proved on Windows by five new tests with a plugin that needs no binary (`plugin_roots_transactions_test.go`), named to be matched by the Windows job's existing `-run`: uninstall with held roots, rolled-back uninstall, update, failed update, and updates under concurrent lookups and writes, **all pass on Windows**. `TestReinstallWithoutAStateReleaserWritesThroughTheOldRoots` still holds as written: a removal closes the handles, forgetting stays the manager's call.

## B4: the two tests CI5 saw fail outside its selection

`TestHostChannelSyncInstallsSignedFeatureArchive` and `TestChannelInstallsAndHostSyncSerialize` fail on Windows on `main` for the same file-handle cause (W1), and pass with this change. Before (run 44890032892, `main`): `expected: "1.0.1-feature-abc.1.1" actual: "1.0.0"` plus `TempDir RemoveAll cleanup: unlinkat ...\.archive-flux-...\candidate\plugin.yaml: The process cannot access the file because it is being used by another process`; and `Received unexpected error: Access is denied.` plus the same cleanup failure on `flux\plugin.yaml`. After: both pass (0.17 s, 0.13 s). They are added to the `-run` selection of the Windows job (`pr-checks.yml`, that one line).

## Not run on Windows

The channel mTLS tests and the credential-erasure, schema-memory and killed-process tests need a `.exe` fixture (B-74); so do the 8 plugin-level W2 tests, which would need only the name `bin/plugin.exe` for their in-process backend (not tried). A real plugin process holding its files, an antivirus or indexer holding a transient handle during a rename, and anything on a real desktop were not run. `internal/pluginmeta` is not in the Windows job's package list (its proof on Windows is the 19 tests, and one wip run); adding it is one word in that step.

## Verified on macOS (arm64, Go 1.27.4)

`-race -count=5` `internal/appstate`; `-count=200 -race` `TestInstallPluginFromPath_ConcurrentStateLookupsDoNotBreakReplacement` (200 of 200, 60 s); the five new manager tests `-race`; mutants of the cure, 11 of 11 killed by a named test (no close during the move, no service lock, no write lock, no identity check, path not followed, a failed move treated as moved, a removal that keeps handles, a prefix match without a separator, and others); `go test ./...` of the whole module once: 72 packages ok, none failed. Details in the pull request.

## Backend catalog

| Class | Where | Finding | Interim |
|---|---|---|---|
| fixed here | plugin SDK `pkg/types/plugin.go` (PR #81), host `internal/pluginmeta` | B-72 / CI5-W1 | the host helper, until v0.20.1 is pinned |
| fixed here | `internal/appstate` | B-73 / CI5-W2 | none needed |
| TANGENTIAL | `backend/pkg/plugin/uninstall_credential_state_test.go` `credentialArchiveVersion` | the Unix-only fixture keeps 8 W2 tests and the credential tests off Windows; the placeholder is never run | a rename to `bin/plugin.exe` may enable them; not tried |
| TANGENTIAL | plugin SDK CI | its Windows leg runs `pkg/v1/exec` only; this class of bug is caught on Ubuntu by the descriptor test | none |

## Dev tools

Throwaway, not in the tree: the wip branches and workflows above; the probe test of the handle flavours (`wip/win1-probe`); the mutation harness (`/tmp/appmut/run.py`, an overlay per mutant); golangci-lint v2.15.0 in `/tmp/ci5bin`.

## Log

- 2026-11-21: read the brief, CI5 and the cred-613 review; SDK fix with tests red then green; Windows probe of handle flavours (the table above); host helper and 19 un-skips green on Windows; relocation of cached roots, 8 appstate and 5 manager tests green on Windows; B4 before and after; pull requests opened.
