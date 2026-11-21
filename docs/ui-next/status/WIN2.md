# Status: WIN2 (the plugin test fixture is a real executable on every OS; backend catalog B-74)

- Agent: WinFixtureExe. Branch `test/win2-plugin-fixture-exe`, worktree `~/Repos/omniviewdev/worktrees/win2-plugin-fixture-exe`, one commit on `origin/main` `20679a1b`. Experiments ran on `wip/win2-plugin-fixture-exe-1` (this change plus a throwaway Windows-only workflow `.github/workflows/wip-win2-windows.yml`) and `wip/win2-base-1` (`origin/main` plus a throwaway workflow that runs the whole `./backend/pkg/plugin` package on Windows), no pull request. The throwaway workflows are not part of this change; the base worktree `~/Repos/omniviewdev/worktrees/win2-base-probe` is left in place.
- Files: `backend/pkg/plugin/testdata/pluginfixture/` (the fixture program), `plugin_fixture_exe_test.go` and `plugin_fixture_exe_selftest_test.go` (the builder and its tests), the fixtures of `backend/pkg/plugin` that wrote a shell script (below), `.github/workflows/pr-checks.yml` (the `Windows connection profiles` job only), this file. Outside that list, one line: `activities_test.go` (`activityObserverService` never closed its state service, see "What failed on Windows").
- Load at the macOS runs: `uptime` 1-minute load 19 to 77 at the first runs, 42 at the `-race` comparison with the base. Windows runs are on GitHub's `windows-latest`, Go 1.27.4, so the machine's load does not enter them.

## In plain words

The plugin manager's tests launched a plugin through `bin/plugin`, written as a `#!/bin/sh` script. Windows cannot run it and the host looks for `bin/plugin.exe`, so every test that installs a fixture archive or starts a plugin process skipped there. They run on Windows now, with a fixture that is a real executable.

**Is the mutual TLS between the host and a plugin tested on Windows now? Yes, and it passes.** `TestCreateBackendEnablesChannelAuthentication`, `TestCreateBackendChannelIsMutuallyAuthenticated`, `TestCreateBackendRefusesPluginThatIgnoresChannelCertificate`, `TestCreateBackendRefusesServerThatDoesNotHoldItsAdvertisedCertificate` and the three cases of `TestChannelRejectsClientWithoutHostCertificate` pass on `windows-latest` (the host's end and the plugin's end both: every call arrived over TLS with a verified client certificate, the host's own certificate, and the plugin's callbacks carry the plugin's own). go-plugin listens on loopback TCP there (`network=tcp address=127.0.0.1:10000` in the log) and a client without the certificate is refused: `tls: certificate required` (no certificate) and `tls: unknown certificate authority` (another certificate).

**Does the credential erase on uninstall work on Windows? Yes, and it passes.** All 8 tests of #613 pass (`TestUninstallErasesSensitiveSettingValues`, `TestUninstallErasesSettingValuesItCannotClassify`, `TestUninstallRemovesHostSavedConnectionState`, `TestUninstallLeavesCredentialStateAloneWhenRolledBack`, `TestReinstallAfterUninstallStartsFreshAndKeepsHostStoresWritable`, `TestUninstallSettingsStoreFailureFailsTheUninstallUntilTheNextStartFinishesIt`, `TestStartupStopsFinishingUninstallsWhenItsTimeBudgetIsSpent`, `TestUninstallErasesEveryValueOfAPluginWhoseSchemaWasNeverRemembered` and the rest of that group), and the two killed-process tests (`TestUninstallKilledBeforeTheEraseIsCompletedByTheNextStart`, `TestUninstallKilledProcessBeforeTheEraseIsCompletedByTheNextStart`: a real child process that is killed at the erase, then a start that finishes the uninstall). So do the plugin-level cached-root tests, a reinstall, and the first-install rollback (`TestFailedFirstInstallReleasesTheRootsItCached`, `TestSuccessfulUpdateReleasesNothing`, `TestFailedUpdateKeepsThePluginRoots`, `TestReinstallWithoutAStateReleaserWritesThroughTheOldRoots`, `TestInstallPluginFromPath_ConcurrentStateLookupsDoNotBreakReplacement`).

**No product defect on Windows came out of this change.** Nothing is skipped as `WINDOWS DEFECT WIN2-Wn`.

## The fixture

`backend/pkg/plugin/testdata/pluginfixture/` is a Go program of the standard library only (`main.go`, `run_unix.go`, `run_windows.go`). The test helper (`plugin_fixture_exe_test.go`) embeds its source, writes it into a temporary directory with a `go.mod` of its own, and runs `go build` for the host's OS (`GOOS`, `GOARCH`, `CGO_ENABLED=0`, `GOWORK=off`, `GOFLAGS=`): it is its own module, so the workspace, a `-modfile` or the flags of the test run do not reach it. It is built once per test process (`sync.Once`), the build directory is removed by the package's `TestMain`, and nothing built is checked in. A child process of the test binary that needs the fixture takes the built file from `OMNIVIEW_TEST_PLUGIN_FIXTURE_EXE` (the killed-process test passes it) and does not build it again. Each fixture gets a copy named `plugintypes.BinaryName()` (`plugin`, `plugin.exe` on Windows).

What it does is read from `bin/fixture.json` next to it, in this order: `records` (files to write; strings expanded shell style against the environment: `$NAME`, `${NAME-default}`, `${NAME:-default}`, `${NAME:+alt}`, `${NAME:+alt:-default}`), `env` (variables to set or remove), then `run` (a command: it replaces the process on Unix, as the shell's `exec` did; on Windows it runs as a child with the same standard streams and returns its exit status), or `sleepSeconds` and `exitCode`. With no file it exits 0 at once, which is what `#!/bin/sh` alone did, so every test that installed an empty fixture behaves as before.

On Windows the host kills only the process it started; a child it ran would live on. The fixture therefore joins a job object with `KILL_ON_JOB_CLOSE` before it runs the command (stdlib `syscall`, no dependency), so the command ends with it, as it does on Unix where the two are one process. `TestPluginFixtureEndsItsCommandWhenItIsKilled` proves it and passes on Windows.

| What the script did | Now |
|---|---|
| `credentialArchiveVersion` (an archive with `#!/bin/sh` as `bin/plugin`) | the fixture executable under the host's name for the OS, `pluginFixtureArchiveEntries` |
| `channelWrapperFor` (`printf` of the certificate, `unset PLUGIN_CLIENT_CERT`, the `set`/`unset` check, `exec` of the test binary under a `/tmp` socket directory) | `records` / `env` / `run` of the spec; the socket directory is a private temporary directory on every OS (`shortSocketRoot`) |
| trace launch (five `printf` lines of the environment, then `exec`) | one record and `run` |
| installed native upgrade (`export`, `exec`) | `env` and `run`, in the directory and in the archive |
| `load_failed_cause` (`exec sleep 30`, `exit 3`) | `sleepSeconds` and `exitCode` |
| `installPluginFixtureAt` with a binary (`#!/bin/sh`, named `plugin` even on Windows) | the fixture executable under `BinaryName()` |

## Skips removed (7)

`credentialArchiveVersion` (`uninstall_credential_state_test.go`), `TestUninstallKilledProcessBeforeTheEraseIsCompletedByTheNextStart` (`uninstall_erase_recovery_test.go`), `channelWrapperFor` (`loader_channel_mtls_test.go`), `TestCreateBackendOwnsTraceReceiver` (`trace_launch_test.go`), `newInstalledNativeManager` (`installed_native_upgrade_test.go`), `slowPlugin` and `TestAProcessThatEndsAtOnceIsNotATimeout` (`load_failed_cause_test.go`). The two tests of `installed_native_upgrade_test.go` and the two of `load_failed_cause_test.go` ran on no Windows job before; they pass there now and are in the job's `-run`.

## What the Windows job ran, before and after

Before (job 136811312801, the run of #634's head `1ff22ab4`; counts of `go test -v`, top-level tests and in brackets with subtests): **286 s**. Packages step (`./internal/appstate ./internal/settings/store ./backend/pkg/plugin/settings`) 25 s: 218 pass, 0 fail, 5 skip (333 / 0 / 5). Plugin step (`./backend/pkg/plugin -run ...`) 6 s: **29 pass, 0 fail, 21 skip** (52 / 0 / 25), among the skips every credential, killed-process, cached-root, reinstall, first-install-rollback and channel mTLS test.

After (the same steps alone on `windows-latest`, run 44905419529 of `wip/win2-plugin-fixture-exe-1`, green; the pull request's own run is quoted in the pull request):

| Step | Before | After |
|---|---|---|
| Packages, with `./internal/pluginmeta` added (its Windows branches had never run: `TestLoadClosesItsFileOnEveryPath`, `TestPinnedSDKStillLeavesTheManifestOpen`, review win-634 recommendation 4) | 218 / 0 / 5 | 224 / 0 / 5 (pluginmeta 6 tests, 17 with subtests, all pass, 2 s) |
| Plugin step | 29 / 0 / **21** in 6 s | **63 / 0 / 2** (89 / 0 / 3) in 22 s; the selection grew by the fixture's own 6 tests and the tests that were not selected |
| Job | 286 s | the wip run (steps alone, no other job's steps) is 138 s; the added Windows time is the fixture build (a few seconds) and about 20 s of running |

The three skips left in the plugin step, each with its reason (the job's list step prints them in the summary): `TestUninstallPlugin_DoesNotPublishInventorySuccessOnFailure/remove` (moving the plugins directory the service holds open is refused by Windows; the host never does this: unchanged, Unix-only by nature), `TestUninstallPlugin_PartialDisposalNeverRestoresOrAdoptsCanonicalDirectory` (a real permission-denied cleanup needs an unprivileged Unix user: unchanged), `TestUninstallKillHelperProcess` (the child process of the killed-process test; a helper that skips by design in a normal run). The packages step still skips 5 (`TestQuarantineKeepsModeAndNeverOverwrites`, `TestScopedRoot_OpenFile`: mode bits; `TestOpenLeavesEveryOtherFileAlone`: trailing dot; `TestACopyThatCannotBeRemovedDoesNotStopTheStoreFromOpening`, `TestRecoveryDoesNotNeedToListTheDirectory`: directory permissions): unchanged, Unix-only by nature.

`-run` of the plugin step: `TestPluginFixture|Uninstall|Reinstall|TestInstallPluginFromPath_ConcurrentStateLookups|TestFailedFirstInstall|TestFailedUpdate|TestSuccessfulUpdate|TestHostChannelSyncInstallsSignedFeatureArchive|TestChannelInstallsAndHostSyncSerialize|TestCreateBackend|TestChannel|TestInstalledNative|TestAProcessThat`.

## What failed on Windows when the tests first ran, and what was decided

The first run of the job's selection (run 44905016086): 88 pass, **1 fail**, 3 skip. The failure:

| Test | Message (quoted) | Verdict |
|---|---|---|
| `TestCreateBackendRefusesPluginThatIgnoresChannelCertificate` | `TempDir RemoveAll cleanup: unlinkat ...\003\.lock: The process cannot access the file because it is being used by another process.` | **a defect of the test, not of the product**: `activityObserverService` (`activities_test.go`) opens a state service and never closes it, so its `.lock` file is held while Windows removes the test's directory (Unix removes an open file). Fixed there with a `t.Cleanup` that closes it (one function, the same cure for every test that uses the helper). Not a skip |

The whole `./backend/pkg/plugin` package was also run on Windows once, for information (not part of the job): on `origin/main` **34 top-level tests fail** (241 pass, 30 skip; 54 fail with subtests); with this change **9 fail** (298 pass, 4 skip; 17 fail with subtests), and none of the 9 fails in this change and not on `origin/main` (compared by name). They are outside the job's selection, listed so that they are known:

| Test | Cause (from the log) | Class |
|---|---|---|
| `TestInstallPluginFromPath_ShutdownRefusalAfterBackendExit`, `TestInstallPluginFromPath_UnrelatedPersistenceKeepsArchivePreimageUntilCommit`, `TestInstallDevPluginFromPath_FailedBuildIsErrorAndRecoverable`, `TestDetermineInitialPhase_BackendWithBinary` | `missing required binary` / `resource plugin binary not found` / `expected: "Installed" actual: "Failed"`: their fixtures write `bin/plugin` (archive entries with the body `candidate executable`, `reconciler_test.go:164`, `installer_test.go:218`) and Windows looks for `bin/plugin.exe` | the same fixture problem as this change cures, for archives whose binary is never run; one more step (use `plugintypes.BinaryName()` in those entries) |
| `TestInitialize_BadRecoveryMarkerIsQuarantinedNotFatal` | `expected: 0x180 actual: 0x1b6` | Unix-only by nature (mode bits) |
| `TestInstallPluginFromPath_RetainsLiveStorageCapabilities/commit` | `Access is denied.` (`archive_storage_test.go:76`): the test itself holds an `os.OpenRoot` beneath the plugin's `store` across the update | Unix-only by nature: Windows refuses to rename a directory with a handle open beneath it (WIN1, decision B1) |
| `TestArchiveReplacementConcurrentAuthorityAccess` | `Access is denied.` (`archive_storage_stress_test.go:65`): four updates race a catalog observation that writes through the authority resolver | **possible product defect on Windows**: the open-file window of review win-634, recommended item 2 (a file opened through a held root is not waited for by `relocate`): a profile save or catalog persist that overlaps an update fails the update. Not shown by a user's run; not skipped here because the test is not in the job |
| `TestSupervisedStartupPreservesDevInventoryUntilCanonicalLink`, `TestSelectedUIStartupUsesCanonicalLifecycleAndActualHTTPBeforeReady` | `devsession: ownership conflict: runtime file permits another principal`; `open ...\actual-shutdown-cache: The system cannot find the file specified` | not looked at (developer-session code, not the plugin fixture) |

## Controls (rule 28)

`plugin_fixture_exe_selftest_test.go` runs each behaviour of the fixture for real: exit status, stay alive until killed, records and expansion and env and `run` with the status and output of the command, and that the command ends when the fixture is killed. Each control was shown to trip its own assertion on macOS with a mutant of the fixture, and to pass undetected with that assertion removed:

| Mutant of the fixture | Test that turns red | With its assertion removed |
|---|---|---|
| `exitCode` ignored (always 1) | `TestPluginFixtureExitsWithTheStatusItIsGiven` (`assert.Equal(3, ...)`) | passes |
| `env` removal ignored | `TestPluginFixtureWritesRecordsExpandsAndRunsItsCommand` (`removed=false` in the command's output) | passes |
| `run` spawns instead of replacing (the Windows shape, with no job) | `TestPluginFixtureEndsItsCommandWhenItIsKilled` (`the command the fixture ran outlived the fixture`, after 15 s) | passes |

The job object that cures the third mutant on Windows cannot be run on macOS: its proof is that `TestPluginFixtureEndsItsCommandWhenItIsKilled` passes on `windows-latest`.

## Verified

- macOS arm64, `GOWORK=off GOTOOLCHAIN=local`: `go vet` of `backend/pkg/plugin` and `GOOS=windows go vet` of it and of the fixture (both `amd64` and `arm64`) pass; `go test -race -count=3 ./backend/pkg/plugin` passes (258 s at load 17). The run before it, under load 45 to 77, failed `TestInstallPluginFromPath_EmitsInstallSpanTree` once by a race between its tracer write (`install_observability_test.go:28`) and a goroutine left by `TestCheckAll_StaleProbeDoesNotAffectReplacement` (`health_test.go:392`); neither is touched here, and the next run under lower load did not show it. The base passed `-race -count=3` once (145 s).
- The Go lint of the changed lines with golangci-lint v2.15.0 (`N24-L2`): see the pull request.
- On `windows-latest`: the runs above.

## Not verified

- Anything on a real Windows desktop: the failures and passes are those of GitHub's `windows-latest`, which has no antivirus or indexer holding handles.
- A plugin that is a real go-plugin server of its own: every plugin process in these tests is the test binary (run through the fixture); the fixture itself never serves the handshake, because none of the tests needs it to.
- The macOS and Linux run of the whole module and of Linux CI: relied on CI.
- `-race` on Windows (the job does not use it). The child test binaries print a data race inside `go-plugin` and `yamux` (`yamux.DefaultConfig` read by `grpcmux` while `go-plugin.Serve` writes it, `server.go:493`) when the package runs with `-race` and `-v`; it is identical on `origin/main` (`TestCreateBackendChannelIsMutuallyAuthenticated -race -v` prints it there too) and hidden by `go test` when the package passes. It is a library race, not this change.

## Dev tools

`testdata/pluginfixture/` and the helper in `plugin_fixture_exe_test.go` (`writePluginFixture`, `pluginFixtureArchiveEntries`, `pluginFixtureRunsTestBinary`, `shortSocketRoot`) are the fixture for every test that needs a plugin process or an archive with a binary; see "The fixture". golangci-lint v2.15.0 installed to `/tmp/win2bin`.

## Log

- 2026-11-21: read the three reviews and CI5 and WIN1; fixture program and builder; the seven skips removed; first Windows run of the job's selection: 1 failure (the unclosed state service of a helper); second run green (63 pass, 0 fail, 2 skip at top level); base and changed whole-package runs compared; opening the pull request.
