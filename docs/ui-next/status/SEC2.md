# Status: SEC2 (the settings file keeps no copy of an erased credential; corrupt-database copies do not live for ever)

- Agent: SettingsResidue
- Goal: backend catalog B-65 and B-66, from the independent review of PR #613 ("Residue"): when a credential is erased (uninstall, or a user clearing or replacing a password) bbolt frees its page without zeroing it, so the value stays readable in `settings.db` until the page is reused; and the `settings.db.corrupt.<unix>` copy that corruption recovery keeps holds every plugin's secrets and was never pruned.
- Worktree: `~/Repos/omniviewdev/worktrees/sec2-settings-residue`; the base commit for measurements `~/Repos/omniviewdev/worktrees/sec2-settings-residue-base` (detached `9052c470`)
- Branch: `fix/sec2-settings-residue`; PR: the one opened from this branch against `main` (its number is in the lead's report; this file is committed with the branch, so it cannot name it)
- Base: `origin/main` `9052c470` (the merge of #613), fast-forwarded to `01c34f02` before the commit (nothing it changed overlaps these files)
- Files: `internal/settings/store/**` (new: `scrub.go`, `corrupt.go`, `backups.go`, `credentials.go`, `options.go`, `files.go`, `files_unix.go`, `files_windows.go` and their tests; changed: `store.go`, `plugin_schema.go`, `migrate.go`), `main.go` (the call that opens the store: 4 lines), `docs/plugin-development.md` (the residue paragraph), this file. `backend/pkg/plugin/resource/**` is not touched.

## Log

- 2026-11-20: read AGENTS.md, the review (`reviews/cred-613.md`, Residue and Credential-class stores), PR #613 and `docs/plugin-development.md`; read the store, every caller of it, every opener of `settings.db`, and bbolt v1.5.0 (`compact.go`, `db.go`, `tx.go`, the freelist).
- 2026-11-20: experiments on raw bbolt and on the store (table below); chose compaction into a new file with a verified, crash-safe swap.
- 2026-11-20: tests first: 9 black-box tests red on `9052c470` (planted value still in the file; copies never pruned).
- 2026-11-20: scrub, retention of corrupt copies and of `.gob.bak` backups written; 57 mutants run, 57 killed.
- 2026-11-21: measured; package `-race -count=3`; whole module; CI Go set; lint in CI form; one commit; branch saved to `wip/sec2-settings-residue`; PR opened from `fix/sec2-settings-residue` (one push, then CI).

## What is guaranteed now, in plain words

- **A credential you erase is no longer in the settings file.** Uninstalling a plugin, clearing a password, or replacing it with another value (a plugin's password or token, or the telemetry credentials of Omniview itself) rebuilds the settings file with only what is current, and overwrites the old file with zeros before deleting it. It happens at once (about 40 to 60 ms) and no other settings operation runs meanwhile.
- **A crash or a failure does not lose settings, and does not skip the erase.** At every step either the old file or the new one is a complete database. If the rebuild could not finish (disk full, the process died, another program held the file), the file says it is still owed, and the next start finishes it before any plugin loads. If an uninstall cannot finish the erase, the uninstall is reported incomplete and retried, as a failed erase already was.
- **The copy kept when the settings file is damaged (`settings.db.corrupt.<time>`) is kept for a week, one copy at most.** The newest stays if it is under 7 days old; older ones are overwritten with zeros and deleted at the next start. The copy made in the current run is never removed by that run. Only a plain file named exactly `settings.db.corrupt.` and a number is touched.
- **Backups of the old settings format (`settings.gob.bak`, from the migration to the database) go the same week** after their migration, overwritten first.

## What is not guaranteed

- **Disks keep old blocks.** Overwriting a file wipes the blocks the file system gave it, in place. A file system that never writes in place (APFS on every Mac, ZFS, btrfs, ReFS) keeps the older block, and so does an SSD, which remaps blocks whatever file system is on it (NTFS and ext4 overwrite in place on a hard disk, where the overwrite works). No application can reach those blocks; they stay until the drive reuses them. Full-disk encryption (FileVault, BitLocker, LUKS) is the answer to that: the old blocks are then unreadable without the key.
- **Backups and snapshots keep older versions of the file.** Time Machine and its local snapshots, Windows shadow copies and File History, cloud sync, a disk image. An erase does not reach them.
- **Other places a secret may be:** the plugin process log (`logs/plugin.<id>.log`), the activity history, files a plugin writes itself (for example under `~/.aws`), the copy a channel switch makes with "copy current data" (another profile; since SEC3 the copy is an allow-list with a rebuilt `settings.db`, and credentials still cross, B-76: `status/SEC3.md`), and the connection-credential files under the plugin's `store/` directory, which are unlinked with the directory, not overwritten (see "Other stores").
- **A value is only erased if the host knows it is a credential:** a plugin's value is one unless the plugin's remembered schema declares its setting ordinary; a core setting is one if its definition is `Sensitive` or a `Password` and `main.go` passes the definitions (it does). A secret kept in a setting declared ordinary is not found.
- **A rotated MCP token** is not scrubbed: the old token is revoked the moment the new one is set, so what is left opens nothing.
- **Not run on Windows.** The code closes the database, renames with `MOVEFILE_WRITE_THROUGH` and opens it again, and compiles for Windows (`GOOS=windows go vet` is clean), but no test of it has run there. See "Windows".

## Which approach: what was measured

All on macOS arm64 (16 KiB pages), bbolt v1.5.0, the store as on `9052c470`. "Copies" is the number of times a planted value occurs in `settings.db`, read as bytes.

| # | Experiment | Result |
|---|---|---|
| 1 | The store: plant a value, erase it, read the file | 1 copy after the erase (red on main); 0 after one more unrelated write |
| 2 | Raw bbolt: overwrite the value with the same number of zero bytes, then delete, in one transaction | 1 copy: the zeros go to a new page and the old page is freed as it was (`TestBboltLeavesAValueInTheFileAfterItIsOverwrittenWithZerosAndDeleted`) |
| 2b | Zeros in one transaction, delete in the next | 0 copies, only because the second transaction happened to reuse that page: nothing promises it |
| 3 | 8 rotations of a credential, then an erase, 1 / 10 / 100 plugins | 2 copies before the erase, 1 right after, 0 after the next write |
| 4 | A fragmented 400-entry bucket, 12 layouts, unrelated writes until the stale copy is overwritten | default (array freelist): the next write in 12 of 12; `NoFreelistSync`: 12 of 12; hashmap freelist: 1 1 200 1 1 1 1 1 23 1 1 200 (200 means still there after 200 writes) |
| 5 | A multi-page credential (a PEM key: 3 pages and a tail), default options, then unrelated writes to another bucket | still present after 30 writes in the committed test, after 300 in the experiment (`TestBboltLeavesAValueThatSpansPagesInTheFileThroughManyUnrelatedWrites`, run under the default, `NoFreelistSync` and both hashmap settings) |
| 6 | Prototype: zero, through a second file handle, every page `Tx.Page` calls free | removed the copy (7 pages, 30 ms at load 24, `tx.Check()` clean). **Not chosen**: it trusts bbolt's page accounting (a page neither reachable nor free is not found), writes into a file bbolt has mapped, and a bug zeroes a live page, which corrupts the live database in place |
| 7 | Prototype: compaction into a new file, swap, overwrite the old file | 25 / 32 / 41 ms for 10 plugin entries, 24 / 28 / 37 for 100, 20 / 21 / 27 for 1000 (compact+sync / +swap and reopen / +overwrite old), at load 24 |

Conclusion: overwriting before deleting does not work (2), no bbolt option wipes a page (4, 5), waiting for reuse is not a mechanism (4, 5), zeroing free pages in place works but is the riskier of the two working ones (6), compaction into a new file is correct by construction (a new file holds only live data; the old one is overwritten whole, whatever bbolt's accounting says) and costs the same order (7). The review's cost (25 ms, 91 ms, 0.8 s for 10 / 100 / 1000 entries) was for compaction alone; the complete scrub is measured below.

## How it works

- **The mark.** The transaction that deletes or overwrites a credential-class value sets `meta/scrub-pending` in the same transaction, so the change and the mark commit together or not at all. A value is credential-class by the rule the uninstall already uses (everything the plugin's remembered schema does not declare ordinary), or, for the host's core settings, by `WithCredentialSettings` (the `Sensitive` and `Password` settings of the definitions `main.go` already holds). The mark is set only when a credential that had a value is gone or different: first setting a password, adding one, rewriting the same value and changing a preference set none (tests: `TestAScrubIsOwedOnlyAfterACredentialIsDestroyed`, `TestCredentialsDied`).
- **The scrub** (`scrub.go`), under the write side of a lock that every store operation holds the read side of:
  1. write a compacted copy of the live database to `settings.db.scrub-new`, without the mark; flush it and its directory entry; reopen it from the disk and check that every bucket, key, value and nested bucket equals the live one (a copy that differs is discarded);
  2. close the database, rename `settings.db` to `settings.db.scrub-old` (flush the directory);
  3. rename `settings.db.scrub-new` to `settings.db` (flush the directory), open it;
  4. overwrite `settings.db.scrub-old` with zeros, flush, remove it.
  Nothing is destroyed until the copy is complete, verified and durable under its own name; the one destructive step is last.
- **Crash states**, resolved by `recoverScrub` before the file is opened (`TestACrashAtAnyStepOfAScrubLeavesAGoodDatabaseAndTheNextStartFinishesIt` takes the directory at each step and starts the store on each):

  | Directory | Cause | At the next start |
  |---|---|---|
  | `settings.db` (marked) | before the copy | the scrub runs again |
  | `settings.db`, `.scrub-new` | during or after the copy | the copy is overwritten and removed, the scrub runs again |
  | `.scrub-new`, `.scrub-old` | between the two renames | the copy is installed, the old file overwritten |
  | `.scrub-new` only | | the copy is installed |
  | `.scrub-old` only | | the old file goes back (the store never creates an empty database where data exists) |
  | `.scrub-new` (unreadable), `.scrub-old` (intact) | the copy proved unusable | the copy is moved aside as a corrupt copy and the old file opens, not an empty database |

  `recoverScrub` looks at the three names directly (`Lstat`), not at a listing of the directory, and fails when it cannot tell, so a directory that is searchable but not readable does not make it miss a file and start an empty database.
  | `settings.db`, `.scrub-old` | after the swap | the old file is overwritten and removed |

- **Failures** (`TestAFailedScrubStepLeavesTheStoreWorkingAndTheNextEraseFinishesIt` fails each step in turn): the store ends with the database open on a good file, the old one if the copy is not in place; an erase returns the result with an error that wraps `ErrScrubFailed`, so the caller's retry runs; a plain write that overwrote a credential is not reported as failed (it worked), the failure is logged by class, and the next erase or start retries; a leftover file keeps the scrub owed.
- **Other handles.** Every operation on the database goes through the one `Store`, which holds a read lock for the length of the operation; the scrub takes the write lock, so no operation sees the database without its file. The other openers of `settings.db`: `internal/devbaseline` opens a *staged copy* (`baseline.go:246`) and, for a source profile, a read-only handle that exists only while it holds the profile's `.lock`, which the running host holds (`snapshot.go:46-49`, `integrity.go:40`); `cmd/omniview-dev` only reads through `devbaseline`; plugins never open it. bbolt's own exclusive file lock keeps any other process out of a running host's database. A `settings.db` that is a symbolic link is followed, and the file it points to is the one replaced (`TestAScrubReplacesTheFileASymbolicLinkPointsToAndLeavesTheLink`).
- **Windows.** A file that is open cannot be renamed or replaced there, which is why the scrub closes the database first (the lock above is what makes that safe) and opens it again after; a rename that fails (a virus scanner holding the file) puts the old file back, keeps the mark, and is retried at the next start. `renameDurably` uses `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH`; Windows has no directory flush, so `syncDir` does nothing there.

## Retention of corrupt copies (B-66)

Verified against the only code that makes them (`store.go`, `openDatabase`: `<path>.corrupt.<unix seconds>`, mode 0600, made when `bolt.Open` fails with a corruption error). The proposal held with two additions.

- Kept: the copy made in this run; or, when this run made none, the newest copy that is not older than 7 days. Everything else that has the shape is overwritten with zeros and removed at `Open`. A copy of exactly 7 days stays.
- Shape: a regular file named `<database>.corrupt.<n>` with `n` canonical decimal digits (no sign, no leading zero, no suffix). A directory, a link, `…corrupt.123.bak`, `…corrupt.0123`, another database's copy and any other name are never touched; a link is not written through.
- Age is the time in the name. Addition 1: a name dated in the future (a clock that ran ahead, or a name the store did not write) is aged by the file's modification time instead, so one bogus name cannot keep a secret for ever and cannot cost the real copy its place. Addition 2: failures are logged by class and never fail `Open`.
- Tests with a fake clock: `TestCopiesToPrune` (13 cases: none, a week exactly, a second over, several, the copy of this run kept whatever the clock says, future-dated names), `TestParseCorruptCopyName` (19 names that are not copies), `TestOpenAppliesTheRetentionRuleByTheClock`, `TestCorruptionRecoveryNamesTheCopyByTheClockAndKeepsItWhateverItsAge`; and, with the real clock, `TestOpenLeavesEveryOtherFileAlone`. Overwriting is shown by a hard link to the file: after the prune it holds zeros (`TestAPrunedCopyIsOverwrittenBeforeItIsRemoved`).

## Other stores a plugin's secrets can live in (item 3)

"Same class" below means: written once, then unlinked, so the disk blocks keep the plaintext until reused. A plain file has no stale pages the way a bbolt database has, so the residue is the deleted file's blocks and nothing more.

| Store | Where | Same class? | What changed here / recommendation |
|---|---|---|---|
| `settings.db` | `internal/settings/store/store.go` | yes, and worse (stale pages) | **fixed** here |
| `settings.db.corrupt.<unix>` | `store.go` `openDatabase` | yes | **fixed** here (B-66) |
| `settings.gob.bak`, `.bak.N`: plaintext values of the old format, core settings included, at the state root and in each plugin's directory | `internal/settings/store/migrate.go` `renameToBackup` (`:179`) | yes, and never pruned (the one at the state root is never removed by anything) | **fixed** here: the migration dates the backup, `MigrateFromGOB` overwrites and removes backups older than a week (`backups.go`); `TestMigrateFromGOBRemovesBackupsOlderThanAWeek`, `TestABackupIsOverwrittenBeforeItIsRemoved`. The reviewer's list had only the per-plugin ones |
| MCP bearer token | `settings.db`, bucket `mcp`; set at `internal/mcprelay/server.go:223-228`, rotated at `service_wrapper.go:232-243`, saved at `server.go:244` | the old bytes are in a stale page like any other | not marked on purpose: a rotated token is revoked at once (`server.go:407` compares the current one only). The next scrub removes it anyway. No token file exists |
| Connection-credential files `plugins/<id>/store/connection-credentials-<uuid>` (0600, written once with `Sync`) | created `backend/pkg/plugin/resource/connection_profile_credentials.go:147-173`, removed with a plain `root.Remove` at `:189` when a profile's credentials are replaced or dropped, and with the plugin directory by `RemoveAll` at uninstall (`backend/pkg/plugin/uninstall_recovery.go:298`, `internal/appstate/scoped.go:144`) | **yes** | **not changed (another track owns `resource/**`)**. Recommend one helper, `ScopedRoot.RemoveSecure(name)` (open for write, zeros, `Sync`, remove), used at `:189` and for `store/` and `data/` before the uninstall's `RemoveAll`; zeroing the binary and assets of the plugin is not worth the I/O |
| `plugins/<id>/data/*.json`, whatever the plugin keeps | removed with the directory (`uninstall_recovery.go:298`) | yes, content unknown | same helper, applied to `data/` (files up to a size bound) |
| `resource-authorities-v1.<uuid>.tmp`, `connection-profiles-v1` | `resource/` | profiles hold no secrets by design (review) | none |
| Plugin log `logs/plugin.<id>.log`, `activities.json` | not deleted by an uninstall | yes, and the log is kept | outside this ticket; the redaction work is H1 |
| Channel switch "copy current data" | At the time of this step `internal/instance/switchseed.go:128-210` copied every entry of the source root except a short list (`:155`); **closed by SEC3 (#631, B-70, `status/SEC3.md`)**: `internal/instance/switchallow.go` carries an allow-list and `settings.db` is rebuilt by the store. `DeleteChannelData` removes an inactive channel with `RemoveAll` (`update_service.go:466`) | yes | the corrupt copies, scrub leftovers and `settings.gob.bak*` no longer travel (SEC3), with one exception: a plugin directory that is itself a link (a plugin installed by link) is copied as a link, so what it points at is not filtered (`switchallow.go:253-255`); credentials still cross (B-76, owner decision); recommend overwriting before `RemoveAll` at `update_service.go:466` (B-78, open) |
| `internal/devbaseline` | copies allowlisted preferences only (`baseline.go:246-267`) | no secrets reach it | none |
| OS keychain | not used by the host | n/a | |
| Renderer storage | not searched | not verified | |

## Performance

`uptime` at the runs: load average 14 to 21 on an 18-core M5 Max (other agents share the machine, rule 27), so each number is a range, not a point. macOS arm64, `go test -bench`, `BenchmarkOpenNothingToDo` (20 plugins, nothing owed, nothing to prune), `BenchmarkWriteThatDestroysNothing` (a patch of a preference of a plugin that has a credential), three alternating rounds of the old and the new code (`bench_test.go`).

| | `9052c470` | this change |
|---|---|---|
| `Open`, nothing to do | 8.2 to 11.9 ms | 7.8 to 11.0 ms |
| the part this change added to that start (read the directory, look for leftovers and corrupt copies, read the mark), a directory of 41 files | n/a | 22 to 72 µs (median 34 µs) |
| a settings write that destroys nothing | 7.7 to 9.9 ms | 8.0 to 11.2 ms |
| one scrub, 10 / 100 / 1000 plugins of 300 B, `BenchmarkScrub` | n/a | 41 / 41 / 43 ms |
| one scrub, 1000 plugins of 4 KiB (a 4 MB database) | n/a | 52 to 58 ms |

The start costs what it cost before: the added pass is 0.4% of it and the difference between the two builds is smaller than the difference between rounds. A start that finds the mark set scrubs once before `Open` returns (about 40 to 60 ms). The write path adds one read of the remembered schema and two small JSON decodes inside the transaction it already runs. A write that destroys a credential, or an erase, now takes about 40 to 60 ms more, and every other store operation waits for those milliseconds.

## Tests

Tests first, seen red on `9052c470`: 9 black-box tests (they use only the API that exists there) fail for the stated reason: `TestEraseLeavesNoCopyOfTheValueInAnyFile`, `TestEraseOfAValueLargerThanAPageLeavesNoCopy`, `TestClearingAPasswordLeavesNoCopyOfTheOldValue`, `TestReplacingACredentialLeavesNoCopyOfTheOldValue` (3 subtests), `TestDeletingAPluginsSettingsLeavesNoCopy`, `TestAnErasedValueDoesNotTakeAnotherPluginsValuesWithIt` ("Should be empty, but was [settings.db]": the planted value is still in the file), `TestOpenRemovesACorruptCopyOlderThanAWeek`, `TestOpenKeepsOnlyTheNewestCorruptCopy`, `TestOpenNeverRemovesTheCorruptCopyItMadeInThisRun` (the copy is still there). The tests that need the new internals (the mark, the hooks, the fake clock) cannot compile there; their reasons are shown by the mutants.

Mutation check: 57 mutants of the guards, each applied alone, the package run, each reverted: all 57 killed. They cover: the credential rule (never marks; ordinary counts; an empty value counts; no semantic compare; an unreadable document ignored; a removal or a change ignored), each writer's mark (erase, unreadable erase, delete, plugin save and patch, core save and patch), each trigger (after a write, at the open, after an erase, after a delete), the verification (none; values, keys, bucket count, nested buckets ignored), the swap (no restore, no reopen, no write lock), each recovery case and the refusal to start over an empty database, the leftover handling, the overwrite (only removed; only the first chunk; a link followed), the retention rule (boundary, newest only, the copy of this run, the name shape, links and directories, future dates, overwrite, never run), the backups (boundary, name, overwrite, dated by migration, never pruned, plugin directories) and the option and the link. First run: 5 mutants did not compile and were repaired, one survived (a clamp that changed no decision: removed) and one survived (a recovery test that passed for another reason: rewritten). The review round (below) added 6 mutants for its fixes (a restore that fails, a reopen that may create the file, preferring the intact old file to an empty database, numbers compared as float64, the flush check, a recovery that lists the directory): all 6 killed; two survived at first because the test failed the restore through the hook before the branch under test, and the code and the test were changed to share one return. Not covered by any test, by nature: the order of the flushes (file, then directory, then the next rename); it is held by the structure of `swapIn` and reviewed, not tested.

## Review: CodeRabbit on PR #625 (9 actionable comments and one low-value note, all answered in the PR)

| # | Where | Verdict | What changed |
|---|---|---|---|
| 1 | `backups.go:87` numbered backups kept when the bare one is gone | valid | the guard is gone; every plugin directory is listed (`TestANumberedBackupGoesAWeekAfterItsOwnMigrationWhateverBecameOfTheBareOne`; the orphan case now expects removal) |
| 2 | `corrupt.go:160` leftover found from a listing | valid | `finishOpen` overwrites `settings.db.scrub-old` by its path |
| 3 | `credentials.go:69` numbers compared as `float64` | valid | exact comparison (`json.Number`, `big.Rat`); an exponent or a number over 128 characters counts as changed, which only costs a scrub (`9007199254740992` vs `…993` differ; `1234` and `1234.0` do not) |
| 4 | `files_unix.go:22` overwrite before the renames are provably durable | valid, in part | where a directory cannot be flushed (`EINVAL`, `ENOTSUP`) the swap is done but the old file is overwritten at the next start, not at once; the leftover keeps the scrub owed (`TestAScrubOnAFileSystemThatCannotFlushADirectoryLeavesTheOldFileForTheNextStart`). The cost is the one the comment names: the old bytes stay until the next start on such a file system |
| 5 | `files_windows.go:25` paths longer than MAX_PATH | valid | `extendedLengthPath` (`\\?\`, `\\?\UNC\`) before `MoveFileEx`; compiled for Windows, not run |
| 6 | `scrub_test.go:186` Windows file identity | valid | `fileIdentity` stats an open handle; every `SameFile` comparison uses it |
| 7 | `scrub.go:303` an empty database created when the restore fails | valid | a failed restore keeps the old file and the copy and leaves the database closed; `reopen` cannot create the file (`TestARestoreThatFailsNeitherCreatesAnEmptyDatabaseNorLosesTheCopy`, `TestReopenNeverCreatesTheFile`) |
| 8 | `scrub.go:440` an unreadable directory taken for an empty one | valid | recovery looks at the names, and fails when it cannot look (`TestRecoveryDoesNotNeedToListTheDirectory`) |
| 9 | `scrub.go:445` `.scrub-new` promoted without being read | valid, by another route | an unusable copy is set aside as a corrupt copy and the intact old file opens instead of an empty database (`TestAnUnreadableCopyBesideTheOldFileDoesNotCostTheSettings`); the copy is not compared with the old file before the rename |
| 10 | `files.go:70` `pathExists` hides inspection errors | valid | it returns them; `scrubOwed`, recovery and the restore stop on one instead of going on as if the path were absent |

(The review header counts 9 actionable comments; the tenth, `files.go`, is a "low value" note in the review body. All ten are answered in the PR.)

## Checks run

macOS arm64, Go 1.27.4, `GOWORK=off GOTOOLCHAIN=local`, at `01c34f02` plus this change. `uptime` load average 10 to 40 (other agents share the machine); the store's tests have no timing assertion.

| Check | Result |
|---|---|
| `go test ./internal/settings/store/ -count=1` | pass (12 s) |
| `go test -race -count=3 ./internal/settings/store/ -skip TestSaveSpansExcludeValuesAndLogFailures` | pass (40 s). The skipped test fails with `-count>1` on `9052c470` too, as the review found (the global OpenTelemetry tracer provider); it passes with `-count=1` in the run above |
| `-race -count=10` of the concurrency and crash tests (`TestStoreOperationsRunWhileScrubsReplaceTheFile`, `TestErasePluginSettingsDoesNotLoseConcurrentWrites`, `TestACrashAtAnyStep…`, `TestAFailedScrubStep…`) | pass (38 s), no flake |
| `task check:fmt-check`, `task check:go-build`, `task check:go-vet` (the host modfile bootstrap, as CI) | pass |
| `task check:go-test` (the whole module, `-json` as CI runs it) | 71 packages pass, 9 have no tests, 0 fail; `internal/settings/store` 22.7 s, `backend/pkg/plugin` 55 s, `backend/pkg/plugin/resource` 56 s, `cmd/omniview-dev` 96 s, `internal/devworkspace` 144 s |
| `task check:go-test-devcontrol` | pass |
| `GOOS=windows GOARCH=amd64 go vet ./internal/settings/store/` (compiles the Windows files and the tests) | clean |
| `golangci-lint` v2.15.0, CI form (`--new=false --new-from-patch=<diff against origin/main>`) | 0 issues. A first run found one: a test variable named `real` redefined a builtin (`revive`); renamed |
| Mutation check | 57 of 57 mutants killed (see Tests) |
| CI on the PR | starts with the one push; the checks are in the PR and in the report to the lead, not in this file, which is committed before the run |


## Not verified

- Anything on Windows or Linux at run time: `GOOS=windows go vet ./internal/settings/store/` compiles the code and the tests; Linux and macOS packaging by CI. The package is not in the `Windows connection profiles` job (`.github/workflows/pr-checks.yml:96-135`); **recommend adding `go test ./internal/settings/store -count=1` to it** (the lead's call; a workflow change makes the PR run the whole suite, rule 32).
- A power loss. The ordering of the flushes was reasoned and the crash states were tested by taking the directory at each step, which models a process that dies, not a disk that loses writes it had acknowledged.
- A real plugin uninstalled in the real host with a real credential; the store was tested directly and through its public API, not through the plugin manager. The manager's retry on `ErrScrubFailed` is the path a failed erase already used; it was read, not run.
- The final claim "no application can fix": the behaviour of APFS and SSDs is from their design, not tested here.
- Databases larger than the 4 MB measured; a scrub holds the store's write lock for as long as the copy takes.

## Backend catalog

| Id | Class | Where | Evidence | Interim | Status |
|---|---|---|---|---|---|
| B-65 | BLOCKER (security) | host `internal/settings/store` | an erased credential stayed in `settings.db` (red tests above); a multi-page one survived 300 unrelated writes | none | **closed** by this PR |
| B-66 | TANGENTIAL | host `internal/settings/store` | `settings.db.corrupt.<unix>` copies held every secret and were never pruned | none | **closed** by this PR (one newest copy, 7 days, overwritten first) |
| B-69 | TANGENTIAL | host `backend/pkg/plugin/resource/connection_profile_credentials.go:189`, `uninstall_recovery.go:298`, `internal/appstate/scoped.go:144` | connection-credential files and a removed plugin's `store/` and `data/` are unlinked, not overwritten | none | open: `ScopedRoot.RemoveSecure` |
| B-70, B-78 | TANGENTIAL | host `internal/instance/switchseed.go:155`, `update_service.go:466` | a channel switch copies `settings.db.corrupt.*`, `.scrub-*` and `settings.gob.bak*` to another profile (B-70); `DeleteChannelData` removes an inactive profile without overwriting (B-78) | the target prunes what it received | B-70 **closed** by #631 (SEC3: an allow-list, `settings.db` rebuilt); B-78 open |
| B-71 | TANGENTIAL | `.github/workflows/pr-checks.yml:96-135` | the Windows job does not run `internal/settings/store`, which now has Windows-only code | none | **closed** by #630 (CI5): the job runs it (`pr-checks.yml:137`) |

## Dev tools

None kept. Throwaway, not committed: the experiment tests of the table above (raw bbolt, the two prototypes), and `mutate.py`, a 90-line script that applies one string replacement at a time to the store, runs the package and restores the file (the 57 mutants are in this file's "Tests" section by guard). Two benchmark helpers are kept in `bench_test.go` (`BenchmarkOpenNothingToDo`, `BenchmarkHousekeepingNothingToDo`, `BenchmarkScrub`, `BenchmarkWriteThatDestroysNothing`).
