# PU2: never trap the user (a plugin whose load fails tells the window, keeps a record, and can be retried)

Row: PU2 in the lead's tracker (not edited here). Worktree `~/Repos/omniviewdev/worktrees/ui-next-pu2-failed-load`, branch `ui-next/pu2-failed-load` (saved on `wip/ui-next-pu2-failed-load`, no PR), on `origin/main` a9eb87e3 (PU1, #618). Findings answered: PU1-01 and PU1-02 of `status/PU1.md`.

**State (2026-11-21): one commit, every local check below green; NO PR IS OPEN, so CodeRabbit and CI have not answered and no review comment was handled: not ready to report ready.** The run stopped at its request budget; the lead can open the PR from `wip/ui-next-pu2-failed-load` (one commit on `origin/main` a9eb87e3) or ask for the remaining steps.

## Goal

A plugin whose load ends in a failure (a reload whose build, validation or process start fails, a first load that fails) must reach the window as a failure and never as a spinner with no exit: the host tells the window why in a code, the plugin keeps a record so `RetryFailedPlugin` works, the tab shows the kit's failure notice with a Retry that asks the host, and a retry that fails again returns to the failed state.

## What the host said before, and what it says now

Before (red Go tests, `unloaded_event_test.go` style, kept in `load_failed_event_test.go`): a reload whose load failed told the window `plugin/unloaded` (`reloaded`) and then nothing (the record's state observer is registered only after a success, `loader.go:245-249`, so no `plugin/state_change` to Failed was ever sent). A load that failed validation, found its files gone or unreadable stored no record at all (`validateForLoad` returns before `storeFailedRecord`): the plugin vanished from `ListPlugins` and `RetryFailedPlugin` answered 404.

| Case | The window was told (before) | Now |
| --- | --- | --- |
| reload, retry, crash recovery attempt: validation fails, files gone, process will not start, init or start fails | `reloaded` | `reloaded`, then `failed` (every attempt of a recovery says so) |
| the process neither says it is ready nor ends within the loader's start timeout | `reloaded` | `reloaded`, then `timeout` |
| first load (the start of the host, `LoadPlugin`) | nothing | `failed` or `timeout`; the plugin keeps a failed record (a window that opens later reads it from the inventory, phase Failed) |
| development link whose dev server or build fails before the load (`InstallDevPluginFromPath`) | `reloaded` | `reloaded`, then `failed` |
| reload refused before its load began (a pending recovery marker, a source the workspace does not select) | `reloaded` | `reloaded`, then `failed` (no record is made: those transactions own the plugin's state) |
| a load of what is not a plugin (nothing there, no metadata, nothing persisted to name it by) | nothing | nothing, no record |

## Decisions (and why)

- **`plugin/unloaded`, two more causes, no new event** (the lead's "state change to a failed phase, or an unloaded-family event"). A state change carries the free text of its `reason` (the error: go-plugin puts the plugin's first stdout line in its errors) and `packages/omniviewdev-runtime/src/connection/connectionReadiness.ts:158` shows the `reason` of a state change to a non-Running phase as the connections' error; the observer is also what counts a plugin as active (`recordPluginActivation`). The unloaded event is a plugin id and a code, nothing else (`TestTheEventIsAPluginIDAndACauseCodeAndNothingElse`, `TestWhatTheWindowIsToldOfAFailedLoadIsACodeAndNoText`: an error with a path and a token reaches no event). Cost: `task bindings` rewrote one generated file (`models.ts`, the enum `UnloadCause`), the audit policy rule's reason names the two causes.
- **Where it is told.** One place for the plugin's own load: a deferred settlement in `loadPluginLocked` after its guards (`failedLoad`, `load_failed.go`): the plugin keeps a failed record (the load of a process stored its own, a failure before there was one is named by the metadata the files said, else by the state the caller held: a reload now carries the metadata, the start of the host already did) and the window is told. Two places the load does not reach: `InstallDevPluginFromPath` (a failure before the load) and `reloadPluginLocked` (a load refused by a guard). Nothing in the uninstall or archive paths, or in `internal/appstate`, was changed (PR #613); an archive update whose candidate fails is told `failed` and then, by the rollback's unload, `reloaded`, and runs again with the restore.
- **The bound is the loader's own timeout, not a second one.** `pluginStartTimeout` (15 s) is go-plugin's `StartTimeout`; `createBackend` marks an error that arrived after the timeout as `startTimeoutError`, and `loadFailureCause` reads `Timeout()` (and gRPC's DeadlineExceeded), never the words of an error. A manager of a test may hold a shorter one (`startTimeout`, zero is the constant). Measured on the real host: a process that says nothing ends as `timeout` after 15.4 s in both engines. NOT bounded: the steps after the handshake (the controllers' starts) have no deadline of the loader's; see the catalog.
- **The window: one kind, six causes.** A failed entry of the kind `unloaded` now has the causes `crashed`, `reloaded`, `failed`, `timeout`. The first cause of a crash stands against what follows it (the recovery's reloads and failed attempts), a reload under way ends in what the host says of its load, a failed load gives way to the host's next reload (`supersedes`, `pluginStore.ts`).
- **Retry asks the host** (a change from PU1, for the crashed plugin too). `PluginStore.retry` asks the host (`PluginManager.RetryFailedPlugin`, which cancels the host's own recovery and reloads) for an entry of the kind `unloaded`, shows it starting again at once (the loading state, no Retry to press twice, one request for two presses), and ends in what the host says: `plugin/state_change` to Running or the answer of the call (`revive` loads the interface once), `failed`/`timeout` told while the call is in flight, or, when the host says neither, the end of the call (a failure or an answer that the plugin does not run is a failed load; its words go to the console, never to the entry). PU1's Retry read the interface again, which for a crashed plugin shows a page with no process behind it. A plugin whose interface failed on its own (missing, broken, ...) is retried by reading the bundle again, as before. The host's call is a third argument of the store with a production default, so no other construction of the store changed.
- **A plugin the inventory lists as Failed is failed from the first** (`inventory.ts`, `PluginDescriptor.failed`): no event reaches a window that was not open, so a window opened (or reloaded) after a load failed would have drawn the plugin's pages with no process behind them and no way to retry. The phase is read, never `lastError`.
- **Host-owned tool sessions stay (A21, A22):** unchanged paths; `PluginHost.failedLoad.test.tsx` runs a Logs session through a failed reload, a failed retry and the retry that runs: one session, ended, the same view with its lines, its stream closed once.

## Proof

Tests first and seen red, then green.

- Go (`backend/pkg/plugin/load_failed_event_test.go`, `load_failed_cause_test.go`: 18 tests): a reload that fails validation, whose process will not start, whose files are gone, a first load (validation, process), a load of what is not a plugin, no text in any event, a crash whose recovery does not start, a development link whose build fails and one whose load fails (told once), a reload refused before it began, the wire (`failed`, `timeout`), the classification from what timed out, and two real processes (one that says nothing: the load ends as `timeout` with a start timeout of 400 ms; one that exits at once: `failed`). Each of the first nine retries the plugin after it failed and gets a running plugin, not 404. Red run: 8 of 9 behaviour tests failed (`/tmp/pu2-red-go-1.txt`, the one that passed guards the no-record case), the rest did not compile (`UnloadFailed` undefined).
- Window (`ui-next/plugins`): `pluginStore.failedLoad.test.ts`, `PluginHost.failedLoad.test.tsx` (real chain: events, listener, store, host; rail, sidebar, tab with its Retry, empty window, tool, Logs session, 20 cycles with `listeners` constant), `inventory.test.ts`, and the updated tests of PU1 (`failure`, `lifecycle`, `PluginHost.unload`: the crashed plugin's Retry asks the host). Red run: 36 failures before the change.
- **Mutations of the rules:** Go 11 of 11 turn tests red (no emission, no record, the timeout never read, the start timeout not marked, no metadata carried by a reload, no settlement, a dev link that tells no one, one told twice, a non-plugin named by an empty id, no record stored, a timeout told as failed) and window 15 of 15 (a crash's first cause not standing, a reload not ended by a failure, a failure not giving way to the next attempt, Retry not asking the host, no progress, a failed call not an exit, the interface loaded whatever the host answers, the old words, the same sentence for a timeout, the interface read for a plugin listed as failed, the inventory not saying it, modules and late answers kept, `timeout` not one of the words, two presses asking twice, a rejected call leaving the plugin starting). Scripts: `/tmp/pu2-mut/mutate-go.py` (through `go test -overlay`, the tree untouched) and `mutate-ui.py`.
- **The real host** (`seam.check.mjs`, scenario p, a host of its own and the fixture's Go process, whose next start a file next to its binary makes fail: `start-mode` `exit` or `hang`): `ReloadPlugin` fails and the window is told `reloaded` then `failed`; the rail says "Seam Fixture, did not start" with the host's sentence in its tip, the tab says why with a Retry and draws no page and no spinner, the host lists the plugin as Failed; a window reloaded then shows it failed from the first (inventory); Retry asks the host (the frames show its reload), the load fails again and the window returns to the failed state; with `hang`, Retry shows the plugin starting again (a spinner, no Retry) and the load ends as `timeout` after 15.4 s (the loader's timeout) with the sentence for it; with the file gone, Retry runs the plugin, the host says Running, one page, one sidebar, one tool, no page error. The frames sequence of one run: `reloaded, failed, reloaded, failed, reloaded, timeout, reloaded`.
- **Controls (13)** in `FAILED_CONTROLS`: `told-frames`, `told-failed`, `rail-failed`, `tab-failed`, `no-spinner`, `record-kept`, `reopened`, `failed-again`, `progress`, `told-timeout`, `timeout-ends`, `rail-back`, `one-of-all`. `SEAM_CONTROL=failed-load` makes every perturbation in turn just before its assertion, which must fail with its own words (13 of 13 detected in Chromium and WebKit). `SEAM_REMOVE=<name>` leaves one assertion out: that control must then pass undetected, the other 12 detected, no other failure (13 of 13 in each engine, table below).
- Screenshots (WebKit, void, 1440 x 900), `~/Notes/omniview/ui-migration/status/PU2-assets/`: `failed-load-did-not-start-…` (the failed tab with its Retry), `…-starting-again-…`, `…-timed-out-…`, `…-recovered-…`.

## The commands CI runs

Run by `/tmp/pu2-final/full-verify.sh` on the committed tree, one stage at a time, each waiting for a 1-minute load under 30 (the load of each stage is in `/tmp/pu2-final/summary.txt`); the probes and the seam from `env -u ENGINES -u VIEWPORTS -u NEGATIVE_CONTROL -u ASSERTION_OFF -u SEAM_CONTROL -u SEAM_REMOVE`, kit built with `OMNIVIEW_UI=next`, `FONT_DELAY_MS=40` for the probes.

| Command | Result |
| --- | --- |
| `tsc` app, test and the kit's (`task check:ui-typecheck`), `pnpm lint` (eslint, `lint:ui-policy`, `lint:css`), the kit's `verify` (vocabulary guard), `node --test scripts/react-compiler.test.mjs` | exit 0 each |
| root `pnpm test` | 288 files passed, 1 skipped; 4,555 tests passed, 3 skipped (28 files, 733 tests of them in `ui-next/plugins`); started at load 8 |
| `task check:fmt-check`, `check:go-build`, `check:go-vet`, `check:go-test-devcontrol`, `check:bindings-check` (the regenerated bindings are the committed ones: one file), `check:c02-transport` | exit 0 each |
| `task check:go-test` (the whole suite) | exit 0, 187 s (started at load 25) |
| Go lint in CI's form (golangci-lint v2.15.0, the recipe of `status/N24-L2.md`, change committed first) | `0 issues` on the committed tree; the first run found three (two package variables of a test, an unused `nolint`), fixed |
| shell, rail, panel probes (`FONT_DELAY_MS=40`, clean environment, each at load 6 to 8) | exit 0, "no failures": 39 s, 14 s, 284 s |
| the whole seam, scenarios a to p, after `OMNIVIEW_UI=next task build:server` (13 s warm) | PASS in WebKit and Chromium (132 s). Two earlier runs failed and were fixed, not rerun away: (1) scenario n of PU1 asserted that a crash whose recovery cannot load the plugin tells `crashed, reloaded` "and nothing else"; the recovery's failed attempts now say `failed`, so the assertion reads what is true (the causes after `crashed` are `reloaded`/`failed`, the last is `failed`, and nothing more after the plugin runs); (2) scenario p's last assertion counted a page error that WebKit reports when the reload of the page cuts a call in flight ("due to access control checks"), which scenario i already excludes |
| the 13 controls of scenario p with their assertion removed (`SEAM_CONTROL=failed-load SEAM_REMOVE=<name>`, one run each) | Chromium 13 of 13 and WebKit 13 of 13: that control NOT DETECTED, the other 12 detected, 0 other failures |
| mutations of the rules | Go 11 of 11 and window 15 of 15 turn tests red (above) |


## NOT verified / NOT done

- No PR is open: CodeRabbit and CI have not answered, so no review comment was handled. The branch is saved on `wip/ui-next-pu2-failed-load` (no PR, no CI run).
- The host cluster check (`scripts/ui-next-pods/`, rule 30): not run (kind and the pinned plugin build); this change touches the window's plugin lifecycle and the loader, not the Pods list, the Pod page, the sidebar's counts or a Pod's logs.
- The strip, logs and palette probes were not run (the assignment named shell, rail and panel).
- The seam on Linux and Windows; the two real-process Go tests use a Unix shell script and skip on Windows.
- A plugin that is stopped by `StopDevPlugin`, or whose stop fails, still tells the window nothing (PU1-03, unchanged).

## Backend catalog

- **PU1-01 and PU1-02: closed** by this step (`loader.go`, `load_failed.go`).
- **PU2-01, TANGENTIAL, `backend/pkg/plugin/loader.go` `startPlugin` (the controllers' starts):** the loader's timeout bounds the process (go-plugin's `StartTimeout`) and each lifecycle call has the 5 s `rpcTimeout`, but `OnPluginStart` of the controllers has no deadline of its own; a controller that never returns leaves the load, and so the window's Retry call, waiting. A watchdog cannot abandon the goroutine safely (controllers are keyed by plugin id, a late teardown would stop the next run's). Interim: none; a deadline has to come through the controller interfaces.
- **PU2-02, TANGENTIAL, `installer.go` `prepareDevInstallDir`:** a dev link whose metadata copy fails (after the unload) is told `failed` (the window is not left spinning) but leaves no record, so its Retry answers 404 and the window returns to failed; `failedDevInstall` is not used on that path.
- **PU2-03, TANGENTIAL, the same for a reload refused before its load began** (`guardUninstallRecovery`, `checkArchiveLoad`, `validateManagedSource`): told `failed`, no record (those transactions own the plugin's state; #613 is in that code).
- **PU2-04, not told, `unloadPluginLocked` failing inside a reload:** the plugin is Failed but the window was never told it stopped (PU1-03's sibling); it still shows the plugin ready.

## Dev tools

- `ui-next/plugins/e2e/seam.check.mjs`, scenario p (`checkFailedLoad`): `SEAM_CONTROL=failed-load` runs it alone with every perturbation of `FAILED_CONTROLS` (one control: `SEAM_CONTROL=<name>`); `SEAM_REMOVE=<name>` leaves that control's assertion out (the proof that it trips its own); `SEAM_SHOTS=<dir>` writes WebKit's four pictures; `ENGINES=chromium|webkit`. `withControls` is the shared helper (scenario n keeps its own).
- `ui-next/plugins/fixture/process/main.go`: reads `<plugin dir>/start-mode` at start (`exit`: ends before it says it is ready; `hang`: silent for two minutes).
- Throwaway, outside the tree: `/tmp/pu2-mut/{mutate-go.py,mutate-ui.py}`, `/tmp/pu2-remove-proof.sh`, `/tmp/pu2-final/full-verify.sh`.

## Log

- 2026-11-20: worktree from `origin/main` a9eb87e3; `pnpm install --frozen-lockfile`, `task packages`.
- 2026-11-20: Go tests first, seen red (8 of 9, then the compile error of the cause tests), then `failed` and `timeout`, `failedLoad`, the start timeout, `task bindings` (one file).
- 2026-11-20: window tests first, seen red (36), then the store (causes, `supersedes`, `retry`/`restart`), the words, the inventory phase.
- 2026-11-20/21: fixture `start-mode`, seam scenario p and its 13 controls (WebKit and Chromium), screenshots, mutations (Go 11 of 11, window 15 of 15), the dev link and the refused reload told, lint findings fixed (two globals, one directive), wip push.
- 2026-11-21: stopped at the request budget; the final verification ran in the background (table above).
