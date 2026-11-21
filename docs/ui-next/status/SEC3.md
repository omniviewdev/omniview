# Status: SEC3 (a channel switch copies what a profile needs, and nothing a profile has erased)

- Agent: SwitchSeedResidue
- Goal: backend catalog B-70 (security), from SEC2: a channel switch with "Copy my current data" copied every entry of the old profile (`internal/instance/switchseed.go:155`), so the corrupt copies of the settings database, the leftovers of a scrub, the `settings.gob.bak*` backups, the pages of erased credentials inside `settings.db`, the logs and the process records of one profile lived on in another, and a fresh profile started with files it never made.
- Worktree: `~/Repos/omniviewdev/worktrees/sec3-switch-seed-residue`
- Branch: `fix/sec3-switch-seed-residue` (work saved on `wip/sec3-switch-seed-residue`); PR: the one opened from this branch against `main` (its number is in the lead's report; this file is committed with the branch)
- Base: `origin/main` `c1042d3b` (the merge of #630); the work was done on `2de6b57a` (the merge of #628) and rebased, with the build, the package tests and the lint run again after the rebase
- Files: `internal/instance/switchallow.go` (new: the allow-list and the staging), `internal/instance/switchseed.go` (changed: the staging call, the resume rule, `copySwitchEntry` takes a filter), tests `switchseed_test.go` (names moved to allow-listed ones), `switchseed_residue_test.go`, `switchseed_overwrite_test.go`, `switchseed_scrub_test.go` (new), this file. `internal/settings/store/**` is not touched.

## Log

- 2026-11-21: read AGENTS.md, SEC2.md, channels.md, the seed code, its callers (`main.go:280` applies it before any state side effect, `update_service.go:347` writes it), every reader of the state root (`RootDir()`, `Plugins()`, the plugin manager's state files, the metric controller, the activity service, the Grafana provider, the window service) and the real `~/.omniview` (names only).
- 2026-11-21: tests first, seen red on `2de6b57a`: 3 of the 6 black-box tests of that first commit (`TestSwitchSeedCarriesNoResidue`: 34 residue files and `settings.db` still holding the sentinel; `…ExactlyWhatAProfileNeeds`; `…DoesNotCarryAnUnreadableDatabase`); the other 3 hold behaviour that must stay (the live settings arrive, the source is untouched, a profile with no database still seeds). Pushed to `wip/sec3-switch-seed-residue`.
- 2026-11-21: allow-list and staging written; the existing tests' names moved to allow-listed ones. A second read of the writers found `metrics/configuration.json` (the user's metric definitions): added to the list, with two more residue names and the directory in the tests.
- 2026-11-21: the real Go host booted on a seeded profile (section 6); mutants run (section 5); package `-race -count=3`, whole module, CI Go set, lint in CI form (section 6).

## 1. What the switch copied before, and what it copies now

Code path before: `ApplySwitchSeed` (`switchseed.go`, called from `main.go:280` for a production profile, before the state directory, the store, telemetry or a plugin exists) takes the source's profile guard and its `.lock`, then `os.ReadDir(source)` and `copySwitchEntry` for **every entry** except `runtime`, `.lock`, `switch-seed.json`, `update-checkpoints.json` and `update-checkpoints.lock`. `copySwitchEntry` copied files byte for byte, directories recursively and links as links. A stage in `.switch-seed-staging`, a manifest `.entries.json`, then one rename per entry into the new root (retryable at any step).

"Needed" is what the host reads at start or on use. Evidence is the reader, not the name.

| Entry of the source root | Before | Now | Why (reader) |
|---|---|---|---|
| `settings.db` | copied as is: every freed page of every erased value came with it | **carried, rebuilt**: only what is live; see section 2 | `main.go:407` opens it: core settings, plugin settings (credential-class values included), the MCP relay config and bearer token (`mcp` bucket), remembered plugin schemas, the telemetry client id |
| `settings.db.corrupt.<unix>` | copied | **never** | a whole earlier database, every secret in it; SEC2 prunes it after a week in the profile that made it |
| `settings.db.scrub-new`, `settings.db.scrub-old` | copied | **never** | an interrupted scrub's leftovers: the old file holds the erased bytes |
| `settings.gob.bak`, `settings.gob.bak.N` (root, and in each plugin directory) | copied | **never** | plaintext values of the pre-database format; SEC2 removes them after a week |
| `settings` (root), `plugins/<id>/settings` | copied | **never** | the old gob settings, migrated and renamed to `.gob.bak` by the source's own start (`migrate.go`); a database exists |
| `plugin` (a gob, 2.4 KB in a real profile) | copied | **never** | nothing reads it (`WriteToGlobalStore` has no caller) |
| `plugin_state.json` | copied | **carried** | `backend/pkg/plugin/state.go:15`: which plugins are installed, their versions, enabled or not |
| `plugin_state.json.tmp`, `*.invalid.<unix>` (a state file the host set aside; `appstate/quarantine.go` says it "can hold sensitive text") | copied | **never** | residue |
| `activities.json` | copied | **carried** | `main.go:540`: the activity history. Flag: SEC2 lists it as a place a secret may be; it is copied as before |
| `metrics/configuration.json` | copied | **carried** | `backend/pkg/plugin/metric/configuration.go:85`: the user's metric definitions, bindings and defaults (a provider keeps its own connection secrets) |
| `builtin/grafana/connections.json` | copied | **carried** | `internal/builtinplugins/grafana/config.go`: the built-in Grafana provider's connections, **with a plaintext `secret` per connection** |
| `builtin/grafana/connections.tmp`, any other `builtin/**` | copied | **never** | a temporary file of an unfinished write; nothing else lives there |
| `plugins/<id>/plugin.yaml`, `bin/`, `assets/` | copied | **carried** | what the install laid down (`installer.go`, `loader.go:497`, the asset handler `main.go:734`) |
| `plugins/<id>/data/`, `plugins/<id>/store/` | copied | **carried**, minus `*.tmp` and `*.invalid.<unix>` | the plugin's own files, its connection profiles, its resource authorities and its **connection-credential files** (`store/connection-credentials-<uuid>`, 0600, `resource/connection_profile_credentials.go`). Plugin-defined, so carried whole |
| anything else in `plugins/<id>/` (`logs/`, `settings`, `settings.gob.bak`, a stray file) | copied | **never** | not part of an install and not read by the host |
| `plugins/.uninstall-<id>-*`, `plugins/.archive-*` (a transaction's stage), a name that is a quarantined or temporary file | copied | **never** | a half-finished install or uninstall holds the previous and the candidate plugin, and the `store/` the uninstall was erasing |
| `.archive-recovery-<id>.json`, `.uninstall-recovery-<id>.json` | copied | **never** | journals bound to the source's file identities (device and inode); in a copy they prove nothing, and the plugin manager would try to resolve them |
| `plugin_pids.json`, `devserver_pids.json` | copied | **never** | the source's process records. A new host that read them would try to settle processes that are not its own (`pids.go:48-70`) |
| `plugin-channel-sync.json` | copied | **never** | the marker that the plugin sync ran for a host channel (`release_channel.go:84`). It must not cross: a first start on a feature channel has to run the sync |
| `windows.json`, `windows.json.bak` | copied | **never** | the window session. The old shell keeps `pages` and `drawer` in it, the new shell keeps `session` (`status/S3a.md`): neither reads the other's slot, so the copy is dead weight that carries tab titles and paths. The new window starts empty (decision A17) |
| `logs/` (`ui.log`, `app.log`, `omniview.log`, `plugin.<id>.log`) | copied | **never** | logs of another profile's life; the plugin logs and the UI log can hold anything a plugin or a page printed (SEC2: "the plugin process log") |
| `diagnostics/` (captures) | copied | **never** | the source's performance captures |
| `runtime/` | skipped | skipped | sockets, tokens, discovery |
| `.lock`, `switch-seed.json`, `update-checkpoints.json`, `update-checkpoints.lock` | skipped | skipped (not on the list) | |
| any name a later host starts to write | copied | **never** until it is named in `switchallow.go` | the point of an allow-list |

There is no cache directory in the state root (checked in a real profile and in the writers); caches live outside it.

What decides "carried": `seedFiles`, `seedNestedFiles`, `seedPluginEntries` in `switchallow.go`, one line each with its reason. A link is copied as a link where a file or a plugin directory is one (as before).

## 2. How the database is carried

1. The source file is read and copied into `.switch-seed-staging/`. The source is never opened for writing.
2. The copy must open as a bbolt database (read-only, a panic on a damaged page counts as unreadable). One that does not is **not carried**: the new profile starts with default settings, which is what the store's own recovery of a damaged file would have given it (it would also have kept a `.corrupt` copy, which is residue). The plain copy is overwritten and removed.
3. The settings store's marker `meta/scrub-pending` is set in the copy and the store is **asked to open it** (`store.Open`, SEC2): its own scrub rebuilds the file from its live contents (`bolt.Compact`), compares the rebuilt file with the live one, installs it and overwrites the old one with zeros. No function was added to `internal/settings/store`.
4. The result is checked: the marker is gone (the rebuilt file lacks it; the store logs a scrub that fails and still opens, so the marker is what proves it), nothing named `settings.db.*` is left beside the file (a scrub on a file system that cannot flush a directory leaves `.scrub-old` until the next start: it is overwritten and removed here), and a scrub that did not finish is an error, which stops the seed and is retried at the next start.
5. A staging that an interrupted start left (no manifest) has its plain database copy overwritten before the directory is removed.

Cost: one `store.Open` of the copy, about the 40 to 60 ms SEC2 measured for a scrub, once, at the first start of a new profile.

**Coupling to say plainly.** Step 3 writes two names the store keeps private (`meta`, `scrub-pending`, in `switchallow.go`). A test fails if they drift (`TestSwitchSeedCarriesNoResidue`, `TestTheStagedDatabaseIsRebuiltNotCopied`: the planted pages stay), and so does the check in step 4. The cleaner form is **one exported function in `internal/settings/store`**, `func CopyCompacted(sourcePath, destinationPath string) error` (open the source read-only, `compactInto`, `verifyCopy`, flush, no marker), which would replace steps 2 to 4 and take the marker names out of the instance package. I did not add it (the assignment says not to edit that package); say if you want it.

## 3. What a user gets when they switch to the new-UI channel

With "Copy my current data to this channel" ticked (the box is offered for a new profile only):

- **Gets**: every setting (the core settings, each plugin's settings, the MCP relay's configuration and its token), the installed plugins with their binaries and assets and the inventory that says which are on (a feature host then moves the ones without an explicit channel to the `feature-ui-next` stream at its first start, as `channels.md` section 4 describes), each plugin's data and store (connection profiles, authorities, recent-cluster lists, the connection-credential files), the Grafana provider's connections, the metric definitions and bindings, the activity history.
- **Does not get**: the window session (an empty window, tabs and panel from scratch), the logs, the diagnostic captures, any backup or corrupt copy, the process records, the old settings formats, any half-finished install or uninstall (the source's next start finishes its own), and the pages of any value the source ever erased.
- **Not ticked**: nothing at all, as before.
- A copy, once: later changes in either profile do not follow. The source is left as it was (a test hashes every file of it before and after).

## 4. Credentials cross channels today: the list, and the question for the owner

Policy is unchanged here. What crosses with the current allow-list (and crossed before):

| Where | What | Note |
|---|---|---|
| `settings.db`, `plugins` bucket | every plugin's credential-class setting values (a password, a token a plugin keeps as a setting) | classified by the plugin's remembered schema (SEC2) |
| `settings.db`, `core` bucket | core settings declared `Sensitive` or `Password` (the telemetry credentials of Omniview itself) | |
| `settings.db`, `mcp` bucket | **the MCP bearer token** and the relay configuration | the same token then opens the relay of both profiles (`server.go:407` compares the current token only) |
| `settings.db` | the telemetry client id | the two channels report as one installation |
| `plugins/<id>/store/connection-credentials-<uuid>` | connection credentials, 0600 | a plugin's cluster, cloud or database logins |
| `plugins/<id>/data/*`, `store/*` | whatever a plugin keeps | content unknown, so carried whole |
| `builtin/grafana/connections.json` | Grafana connection secrets, plaintext in the JSON | |
| `activities.json` | the activity history | may hold a secret an operation printed (SEC2 flagged the history) |

**Should credentials cross at all?** For the owner. The trade:

- *For carrying them*: the user switches to see the new UI, not to sign in again to every cluster, cloud account, Grafana and MCP client; a switch that loses connections is a switch most users will not make, and the channel exists to be tried.
- *Against*: (1) the secret now lives in two profiles with separate lives: SEC2's erase, rotation and scrub work in the profile that is running and do not reach the other one, and deleting a channel's data (`update_service.go:466`, `RemoveAll`) unlinks without overwriting; (2) the channel builds are development builds of the same host by design, held to less release testing than stable, and they now hold stable's credentials; (3) one MCP token and one telemetry id span two profiles.
- *Middle ways, each small*: tell the user in the switch dialog what is copied ("your saved passwords and tokens too"); do not carry the MCP token (a new profile makes its own, the old one stays revoked-on-rotation); carry connection profiles but not their credential files, so the first connect asks again; zero the files of a deleted channel's data. I recommend the first two (the notice, and a fresh MCP token), which need no policy decision about the connections themselves. I changed none of it.

## 5. Tests

Tests first, seen red on `2de6b57a` (the planted source holds the sentinel in `settings.db`'s freed pages and in every residue file; a precondition test proves it, so a detector that cannot see the bytes cannot pass):

| Test | What it proves | Red on `2de6b57a` |
|---|---|---|
| `TestSwitchSeedCarriesNoResidue` | no file of the new profile holds the sentinel bytes (raw read of every file), and none of 36 residue names exists | yes: 34 residue files (36 now) and `settings.db` itself |
| `TestSwitchSeedCarriesExactlyWhatAProfileNeeds` | the new profile's files and directories are exactly the allow-list's | yes |
| `TestSwitchSeedCarriesTheLiveSettingsAndNotTheErasedOnes` | the store opens the carried database; the live value is there, the erased one is not; nothing is left beside it | no (it is a keeps-working test) |
| `TestSwitchSeedLeavesTheSourceAsItWas` | the source's files are byte-identical after the switch (apart from the `.lock` the switch creates there, as before) | no; kept |
| `TestSwitchSeedDoesNotCarryAnUnreadableDatabase`, `TestAnUnreadableDatabaseLeavesNoCopyInStaging` | a database that cannot be read is not carried and leaves no plain copy | yes / new |
| `TestTheStagedDatabaseIsRebuiltNotCopied` | the carried file is the rebuilt one (smaller than the source) | new |
| `TestScrubbingTheStagedDatabaseRemovesWhatIsLeftBesideIt`, `TestAStagedDatabaseThatCouldNotBeRebuiltIsNotCarried` | a leftover is overwritten and removed; a scrub that did not finish is an error (the directory is made unwritable; skipped as root and on Windows) | new |
| `TestOverwriteAndRemoveZeroesTheFile`, `TestAnUnfinishedStagingLosesItsPlainDatabaseCopy` | the plain copy is overwritten before it is removed (a hard link to the file shows zeros) | new |
| `TestAResumedStagingInstallsOnlyWhatIsAllowed` | a staging an earlier build made, naming `logs` or a backup, installs neither | new |
| `TestStagingAFileThatIsAbsentMakesNoDirectory`, `TestSwitchSeedMakesNoDirectoryForAFileItDoesNotCarry`, `TestSwitchSeedWithoutADatabaseStillSeeds` | no empty directories; a profile with no database still seeds | new |
| the seven older tests (`switchseed_test.go`) | locks, overlap, retry, partial install, ownership, initialized target: unchanged, with names moved to allow-listed ones | pass |

Mutants (one change each, the package run on the final code, the file restored from a copy; "killed" = a named test turned red; 18 of 18 killed; M10, a mutant of cleanup code that was then removed as not needed, is gone):

| # | Mutant | Result |
|---|---|---|
| M1 | skip the store's scrub of the staged copy | killed (`CarriesNoResidue`, `RebuiltNotCopied`) |
| M2 | do not set the marker | killed (the same two) |
| M3 | add `windows.json` to the list | killed (`CarriesNoResidue`, `CarriesExactly…`) |
| M4a | stop leaving out `*.tmp` | killed |
| M4b | stop leaving out quarantined names | killed |
| M5 | do not overwrite a stale staging's database | killed (`AnUnfinishedStaging…`) |
| M6 | install a resumed manifest's names unchecked | killed (`AResumedStaging…`) |
| M7 | copy dot-named plugin directories (stages) | killed |
| M8 | add `logs` and `settings.gob.bak` to a plugin's entries | killed |
| M9 | leave `settings.db.*` leftovers in place | killed (`ScrubbingTheStagedDatabase…`) |
| M11 | do not probe the database before staging it | killed (`DoesNotCarryAnUnreadableDatabase`) |
| M12 | leave the plain copy when staging fails | killed (`AnUnreadableDatabaseLeavesNoCopy…`) |
| M13 | add another file under `builtin/` | killed |
| M14 | ignore the marker after the store opened the copy | killed (`CouldNotBeRebuilt…`); it survived until that test was written |
| M15 | rename the marker key (the store's name drifts) | killed (6 tests) |
| M16 | overwrite with nothing before removing | killed (`OverwriteAndRemove…`, `AnUnfinishedStaging…`) |
| M18 | leave `metrics/configuration.json` off the list | killed (`CarriesExactly…`) |
| M19 | add `plugin_pids.json` to the list | killed (`CarriesNoResidue`, `CarriesExactly…`) |

Two first-draft survivors taught the planted database its shape: with one 25 KB value and missing buckets, opening the copy (which creates the buckets) reused the freed pages and the sentinel was gone with no scrub at all (M1 and M2 survived); the planted credential is now 120 KB over every top-level bucket, so only a rebuild removes it.

## 6. Checks run

macOS arm64, Go 1.27.4, `GOWORK=off GOTOOLCHAIN=local`, the host modfile bootstrap as CI uses it, at the head of this PR. `uptime` load average 25 to 96 during the runs (other agents share the machine, rule 27); nothing here asserts a time.

| Check | Result |
|---|---|
| `go test -race -count=3 ./internal/instance/` | pass (353 s; 364 s on the revision before the lint fixes) |
| `go test ./...` (the whole module; CI runs it with `-json`) | 70 packages pass, 9 have no tests, **1 fails**: `internal/devworkspace` `TestWatchRecoveryCannotDeclareReadyWithUnrebuiltSDKBackend` (`watch_recovery_test.go:107`, "runtime repair was not processed": a 14 to 15 s context ran out). It failed the same way in both whole-module runs (load 50 to 95), and passes alone: 3 of 3 with `-count=3`, and the whole package `-count=1` (104 s). A timing test starved by the load, not a result of this change (the package reaches `internal/instance` only to compile); not reproduced alone, so **a green CI run is the check that settles it** |
| `internal/instance` and `internal/settings/store` inside the whole-module run | pass (143.6 s; cached) |
| `task check:fmt-check`, `check:go-build`, `check:go-vet`, `check:go-test-devcontrol` | pass |
| `GOOS=windows GOARCH=amd64 go vet ./internal/instance/` | clean (compiles the Windows build and the tests) |
| `golangci-lint` v2.15.0, CI form (`--new=false --new-from-patch=<diff against origin/main> --path-prefix=`, change committed first) | 0 issues. The first run found 29 (gochecknoglobals 5, govet shadow 17, mnd 5, gocognit 1, nonamedreturns 1); all fixed, none suppressed |
| The real Go host, `-tags production,server` (stub `dist/`, so no frontend), `HOME=<temp> OMNIVIEW_CHANNEL=feature-ui-next`, a `switch-seed.json` naming a planted source of 25 entries (the 36 residue names, the live files and a database with an erased 120 KB credential in its freed pages). Run on the revision before the lint refactor (no change of behaviour since; the package tests above ran on the final one) | booted and served on 34115. The new root held: `settings.db` (131,072 bytes from the source's 262,144, the live value in it), `plugin_state.json`, `activities.json`, `metrics/configuration.json`, `builtin/grafana/connections.json`, `plugins/p1/{plugin.yaml,bin,assets,data,store}`, and the files the host itself made (`.lock`, `logs/`, `runtime/`, the quarantine of my fixture's invalid `activities.json`). `grep -r` for the sentinel over the whole new root: 0 files (the source: 37). The host loaded the carried plugin `p1`, and the window service had no session to restore (`windows.json` is not carried). Not the native window. |

## 7. Not verified

- A real switch: the packaged feature channel does not exist yet (the channel is not registered), so no app switched itself. `ApplySwitchSeed` was run by tests and, see section 6, through the real host's start.
- Windows (the code compiles for it with `GOOS=windows go vet`; no test ran there; the unwritable-directory test skips there) and Linux at run time.
- A source whose own start had not finished a scrub, an install or an uninstall when it closed: the seed copies the plugin directories as they are and not the journals; the source's next start finishes its transaction and the copy keeps what it caught. Not run.
- Large profiles: the staging was seen only on the 260 KB fixture (the tests that build it take 0.04 to 0.10 s, planting included). SEC2 measured its scrub at 41 to 58 ms for 1,000 plugins; a switch copies the plugin binaries as before, which is the larger cost.
- An old profile with the pre-database settings (`settings` gob, no `settings.db`): not carried now. The source host that wrote the seed has run its own migration at start (`main.go:414`), so a source that can switch has a database; a profile that never saved a setting has none and starts with defaults either way.
- The kit `verify`, the probes and the seam check (rule 17): not run, nothing under `ui-next/` or `packages/kit/` changed. CI runs them anyway, because a Go input changed (rule 32).

## Backend catalog

| Id | Class | Where | Evidence | Interim | Status |
|---|---|---|---|---|---|
| B-70 | BLOCKER (security) | host `internal/instance/switchseed.go` | the red tests above: 34 residue files and the erased value's pages reached the new profile | none | **closed** by this PR |
| new | TANGENTIAL | host `update_service.go:466`, `channel_data_unix.go`, `channel_data_windows.go` | `DeleteChannelData` removes a profile with `RemoveAll`; the files are unlinked, not overwritten (`settings.db`, the connection-credential files) | none | open: overwrite, as SEC2's helper does, before the remove |
| new | TANGENTIAL | host `internal/settings/store` | an exported `CopyCompacted(source, destination string) error` would let the seed drop its two private marker names | the seed sets the marker by name; tests guard the names | open (the lead's call) |
| new | docs | `docs/ui-next/channels.md` section 3 ("copies every entry of the source root except…", `switchseed.go:155`), `docs/ui-next/status/SEC2.md` (the channel-switch row and the catalog row) | both describe the old behaviour | none | open: the lead updates them from this file (not in this step's paths) |
| new | policy | the credentials of section 4 | they cross channels and have separate lives there | none | open (the owner) |

## Dev tools

None kept. The mutation runs were a shell function that applies one `sed` replacement to `switchallow.go` or `switchseed.go`, runs the package and restores the file from a copy.
