# Status: KL6 (the host keeps each connection's last answered metadata, for every plugin)

- Agent: HostLastKnown
- Goal: a connection carries metadata a plugin's backend answers after a successful connect (SDK `Config.ConnectionMetadata`, read by the runtime's `useConnectionMetadata`). It lived in memory on both sides: a stop turned the entries `stale`, and a restart of the plugin or the host left a connection that is not connected with nothing to show. The host now keeps the last answer of every plugin's connections itself and serves it as `stale` entries with the time each was observed, exactly as entries look after a stop; a fresh answer replaces them. Generic: no plugin changes anything, and no plugin's vocabulary is in the code.
- Worktree: `~/Repos/omniviewdev/worktrees/metadata-last-known`
- Branch: `feat/connection-metadata-last-known`, from `origin/main` 05e889346: the change (1c6966953), and the fixes of its independent review (rule 36) on top. Nothing pushed or opened as a PR: the lead does that.
- Go only. No TypeScript changed (a stale entry already carries `observedAt` in `ConnectionMetadataEntry`, `connection/metadata.ts`, and the curated `ui/v1` type exports it), no binding changed (no exported type or method), no wire or SDK change.

## What changes

- `backend/pkg/plugin/resource/connection_metadata_last_known.go` (new): the store. One `lastKnownMetadata` on the controller; per plugin the entries of each connection; read once, written debounced, erased on request.
- `connection_metadata.go`, `admitMetadata`: fences once before anything is read (a retired registration reads nothing), `warm`s the plugin's file and `prepare`s what the snapshot would add before any lock, then, under `pluginsMu` after the epoch, registration and revision fences, `observe`s (record and overlay) or, for a tombstone, `forget`s. The one log line is deferred before the unlock so it runs after it.
- `connection_profiles.go`: `writeStoreFile` is the body of `writeDesiredConnections` with the file name as a parameter (the same temporary file, fsync, rename and directory sync; `writeDesiredConnections` still answers `RESET_REQUIRED` when the rename took effect and the directory sync failed). `changeConnectionProfile` forgets the connection after every committed operation.
- `controller.go`: the field, the constructor, `ServiceShutdown` writes what is pending, `OnPluginStop` settles the plugin's pending write, `LoadConnections` drops what a plugin that no longer lists a connection kept for it.
- `uninstall_state.go`: `OnPluginUninstalled` erases the plugin's copy (memory, pending writes, file).
- `testutil_test.go`: the test controller closes the copy before the state service closes.
- Tests: `connection_metadata_last_known_test.go` and `connection_metadata_last_known_lifecycle_test.go` (new): 26 tests.
- Docs: `docs/connection-metadata-design.md` (sections 5, 7, 10 and a new 13) and `docs/plugin-development.md` say what the host keeps and what it does not know.

## How it works

| Question | Answer |
|---|---|
| Where | `plugins/<pluginID>/store/connection-metadata-v1` under the channel's state root: the plugin's store, where the profile and authority stores are. It goes with the plugin directory on an uninstall. [INFERENCE] It survives an update: `internal/appstate` says an archive replacement moves the plugin's state directories into the new plugin directory; no update was run here. |
| Format | `{"version":1,"connections":{"<id>":{"entries":{"<key>":{"state":"stale","value":…,"observedAt":"…"}}}}}`. The entry is the SDK's own type, so the file is read back through the SDK's validation of an entry (JS-safe numbers, depth, bytes, UTC time). Mode 0600. No error, generation, revision, configuration or `sensitiveData`: the file has no field for them. |
| Kept | The value and time of each `current` or `stale` entry of an admitted snapshot. A current entry replaces what was kept, and so does an observation at the same time whose value differs (compared by the digest of its encoding); a stale entry of the plugin's memory only if observed later. A **complete answer** (active, not refreshing, no refresh error, with at least one entry) also drops the kept keys it leaves out, which is how a provider's `remove` reaches the copy. |
| Served | The plugin's own entries plus, for each kept key it has none for, a stale entry (kept value, its time). A key the plugin says is `unavailable` and the host has a value for is served `stale` with the plugin's error, as the SDK serves a failed refresh of a key it has a value for. A snapshot that holds kept entries and no generation of the SDK's gets the opaque generation `host-last-known`, and what is served is checked with the SDK's `ValidateConnectionMetadataSnapshot`: a result it would refuse (more than 128 entries or 256 KiB) is the plugin's snapshot as it came. |
| When | Through the one funnel every snapshot passes (`admitMetadata`: the watch, `Get`, `Refresh`), so on start, and when the plugin's connections are listed before any connect, the inventory snapshots (inactive, empty) are shown with what was kept. |
| Writes | Debounced 2 s and coalesced (one timer for a plugin, whatever the number of changes), one write at a time for a plugin (its `writeMu`), each through `writeStoreFile`. An erasure is armed at 0, also while a write is in flight. What is pending is written before `OnPluginStop` returns (the lifecycle lock is released first) and by `ServiceShutdown`, which waits for the disk 3 s at most. A failed write leaves the file owed (retried by the next change and at the quit); a missing plugin directory drops it. When nothing is kept the file is removed. |
| Reading | Once for a plugin, before any lock. A file that cannot be read for another reason than being absent leaves the plugin unloaded: nothing is kept or written for it until a later read succeeds, so the file is never replaced by a copy that holds only what this run saw. A file that is not what this version wrote is moved aside (`appstate.Quarantine`, as `activities.json` is) and the copy starts empty. A `connection-metadata-v1.*.tmp` that a cut-short write left is removed at load. |
| Caps | 32 entries for a connection (earliest observed go first), 16 KiB of JSON for a value (what the SDK admits for an entry; a value over it is not kept and removes the older value of its key), 4 MiB for a plugin (the connections observed earliest go first); the file read is at most 8 MiB. One `Warn` line per admission that left something out: counts, the first key, no value. A refusal is remembered by its observation time and the digest of its value, so it is reported once, and forgotten when a complete answer stops carrying the key. |
| Erasure | A tombstone; every change of the connection's profile (`SaveConnectionProfile`, `ImportConnectionProfile`, `ResetConnectionProfile`, `RemoveConnection`); the snapshot the SDK publishes when it clears a connection whose endpoint or credentials changed (`clearedBySDK`: inactive, no generation, no entries, after one of a generation; a stop keeps its generation and entries); a `LoadConnections` that no longer lists the connection; and `OnPluginUninstalled` (the path H3 added: the manager calls it once the uninstall is durable, and again at the next start if it failed). A plugin that stops, crashes or restarts keeps its copy. The uninstall cancels the plugin's timer, waits for a write in flight, and removes the file with the plugin's entry still in the map (marked gone), so that no `warm` reads the file back; the entry goes once the file is gone. A plugin this run never used has nothing in memory, and its file went with its directory. |
| Redaction | A heuristic, not a guarantee. The key, the connection ID, every string of a value and every member name in it pass `devdiag.Redact` and `devdiag.SensitiveKey`, the redaction the log sinks apply, and an object whose `name` or `key` member is the name of a credential (the shape of a list of environment variables) is refused. A match is **refused, not redacted in place** (`https://[REDACTED]@host` would be a false fact); a connection whose ID matches keeps nothing. A secret with no such shape under a harmless name is not found. A window is still shown what the plugin published. The same test runs again on what is read from disk. |
| Concurrency | The copy's mutex is a leaf: it guards maps and write bookkeeping only, never held across disk I/O, a log call, a controller callback or a plugin call; the order is `pluginsMu`/`profilesMu`/`connsMu`, then it; a plugin's `writeMu` is taken before it, never under it. What a snapshot would add (encoding, redaction, sizes) is prepared before any lock. Admission calls the copy inside `pluginsMu` after the fences, so an entry from a retired epoch, a replaced plugin generation or an older revision never reaches it. `StartConnection` and `StopConnection` never call it. |

## The review (rule 36) and what it changed

The independent review found 11 things (its stress and probe files are at `/tmp/kl-review/`, not in the repository). All are fixed, each with a test:

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | Kept facts survived an endpoint or credential change the SDK clears on purpose. | `clearedBySDK` in `admitMetadata`; `changeConnectionProfile` forgets for every operation. | `…IsForgottenWhenTheSDKClearsAChangedConnection` (a real SDK controller, `ApplyConnections` with changed `Data`; a plain stop keeps), `…IsForgottenWithAProfileChange` |
| 2 | The debounced writer could hold a file under the store after a stop (Windows: an uninstall or update rename fails). | `OnPluginStop` calls `settle`: cancels the timer, waits for a write in flight, writes what is pending. | `…IsSettledWhenThePluginStops` (fake clock) |
| 3 | `erase` deleted the entry before the file went, so a `warm` could re-read it; `warm` ran before the registration fence. | The entry stays, marked gone, until the file is removed; a fence before `warm`. | `…ErasureKeepsTheEntryUntilTheFileIsGone`, `…ARetiredRegistrationCannotBringAnUninstalledPluginBack` |
| 4 | Redaction holes. | The connection ID is refused; so is an object whose `name` or `key` member names a credential; the docs say it is a heuristic. | `…KeepsNothingForAConnectionIDThatLooksLikeACredential`, `…RefusesAnObjectNamedForACredential` |
| 5 | An observation at the kept time with another value was dropped. | Compared by the digest of the encoding. | `…PersistsAChangedValueObservedAtTheSameTime` |
| 6 | A transient read error started the copy empty, and the next write replaced the file. | Nothing is kept or written until a read succeeds; a corrupt file is quarantined. | `…NeverOverwritesAFileItCouldNotRead`, `…MovesAFileItCannotParseAsideAndSweepsLeftovers` |
| 7 | An erasure that raced a write in flight was re-armed at the full debounce. | A timer is armed whenever a change comes (the smallest delay wins); the plugin's `writeMu` orders the writes. | `…ErasureDuringAWriteIsWrittenAtOnce` |
| 8 | A snapshot of kept entries alone was not valid by the SDK's own validation. | The opaque generation, and the validation at serve time. | The merge table validates every served snapshot; `…ServesWhatThePluginPublishedWhenTheKeptEntriesWouldNotFit` |
| 9 | The Kubernetes `unavailable_api_groups` fact can reach about 12 KiB. | The cap for a value is 16 KiB (what the SDK admits). | `…KeepsTheLargestFactTheKubernetesPluginPublishes` |
| 10 | Simplify. | `writeMu` replaces `writing`, `idle`, `begin` and `end`; `hasKeepable` is gone; the encoding and redaction moved out from under `pluginsMu` (`prepare`). | The stress, below |
| 11 | A leftover temporary file; a quit that a hung disk could block. | Swept at load; `shutdown` and `close` wait 3 s at most. | `…MovesAFileItCannotParseAsideAndSweepsLeftovers`, `…QuitIsNotHeldByAHungDisk` |

The fixes grew the store file (855 to 1,047 lines; the write path itself is shorter) and the production code by 218 lines in all.

## What the copy does not know (limits, and decisions that are mine)

1. **It follows a connection's ID.** The SDK clears a connection's facts when its endpoint or credentials change while the host runs, and the host drops its copy with them and with every change made through its profile operations. A connection that is deleted and created again under the same ID, or pointed elsewhere, while the host is closed (a kubeconfig edited in an editor) shows its old facts, stale and with their observation times, until it connects and answers.
2. **The complete-answer rule needs at least one entry.** The SDK publishes, at a connect, an active snapshot with no entries, then the refreshing one; without the guard the first drops everything kept and the window blinks for the length of the probe. The cost: an acquisition that completes with no entries at all does not drop what was kept (the reviewer's probe `EmptyCompleteAnswerKeepsOldFactsForever`); a fact is retired by an answer that carries another entry and leaves it out. The real-SDK test holds the probe open and checks that what was known is still shown; control M16 is caught only by it.
3. **A successful `LoadConnections` that lists no connections** (a kubeconfig that is briefly empty) drops the copy of every connection of the plugin; the next connect writes it again.
4. **A channel switch copies this file with the store.** "Copy my current data to this channel" copies the plugin stores (`channels.md`), so the other channel serves the same last-known facts, stale, until it connects.
5. **Keys the plugin's complete answer leaves out are dropped.** The Kubernetes plugin removes environment keys it no longer infers (`update.Remove`), and the SDK cannot tell the host when the key was never in this generation's entries. The price is a short gap for a fact a plugin publishes in a later acquisition than its first.
6. **Refuse, never redact in place; the window is not held to it.** Only the copy that outlives the run is. A snapshot of an inactive connection can carry stale entries and the generation `host-last-known`.
7. **A `forget` while the file is unreadable is not applied** (nothing is kept then); the connection is pruned at the next `LoadConnections` that does not list it, and an uninstall erases the file whole.
8. **`changeConnectionProfile` drops the copy for a rename too**, not only for an endpoint change: the reviewer asked for every operation; while connected the plugin's own entries still show and the next snapshot keeps them again.
9. The caps (32, 16 KiB, 4 MiB, 2 s, 3 s) are my numbers.

## Checks

macOS arm64, Go 1.27.4, `GOWORK=off GOTOOLCHAIN=local`; the machine is shared (load 10 to 20 during the first run, not a benchmark).

- `go build ./...` and `go vet ./backend/pkg/plugin/resource/...`: exit 0. `gofmt -l`: nothing.
- `go test ./backend/pkg/plugin/resource/...` without `-short`: ok (26 s); with `-race`: ok (71 s). The package has 585 top-level tests (571 at the first commit), none failed or skipped. The 26 new tests also passed 10 runs in a row with `-race`.
- The reviewer's stress (`zz_review_stress_test.go`, copied in temporarily and removed; in the copy `p.writing` became a `TryLock` probe of `writeMu`, and the model learned the two rules this review changed: the SDK's clearing, and an observation at the kept time with another value). Mode 1 (normal limits, the store reachable at `OnPluginUninstalled` in half the cycles, `KL_KEEPDIR=1`), 20 s: 430,134 operations, 278 uninstalls, 25 restarts, pass. Mode 2 (tight limits), 20 s: 432,651 operations, 276 uninstalls, 24 restarts, pass. Mode 1 under `-race`, 10 s: 52,173 operations, 129 uninstalls, pass. The probes that assert (late admission after an erase, an erasure during a write, a transient read error, the SDK's clearing, no write after shutdown) pass; the ones that only log now say: the connection ID with a password is not written, the served restart snapshot has the generation `host-last-known` and validates, the empty-answer limit above.
- Changed-lines lint (the recipe of `status/N24-L2.md`, golangci-lint v2.15.0, the patch from the merge base to the working tree through a temporary index, so that the new files count): 0 issues. The first run of this round found `nestif` and `exhaustruct` on lines the change re-indented; the revision fence of `admitMetadata` is back to its original text.
- `task check:go-test -- -short` was run for the first commit: every package ok but `backend/pkg/plugin/exec` and `backend/pkg/terminal`, which fail the same way on an export of `HEAD` without this change. Not repeated: this round touched only the resource package.
- TypeScript, bindings, the runtime build and its API report: not run, nothing changed there.

### What the race detector found (first commit)

`retainLastKnownMetadata` read the IDs of the slice `LoadConnections` returns, which a start or a stop writes in place under `connsMu`, with no lock. It now reads them under `connsMu`, and only for a plugin that keeps metadata. `TestConnectionMetadataLastKnownReadsTheListedConnectionsUnderTheirLock` holds it (control M19, caught only under `-race`).

## Controls (rule 28)

`KL6/mutants.py.txt`: 33 faults, each planted alone in a scratch copy of one file that `go test -overlay` substitutes (four at a time), so the repository is never edited. 33 of 33 are caught by the tests named for them in the last run (M01 did not build in the full run, because the fault left `added` unused; it was fixed and re-run). M05 trips the assertion named for it and then a panic of the test's own cleanup, which has been fixed in the test since (it waits for the blocked goroutine before the service closes); M07 trips the 5 s guard of the coalescing test and deadlocks the test of an erasure during a write until the 150 s timeout, which is the symptom of a lock held across the disk. M05 and M07 were not re-run after that cleanup fix. The faults: kept entries never served, a complete answer keeping omitted keys, no redaction of values or keys, an uninstall that neither marks the plugin gone nor cancels its write, every change arming its own write, the write holding the lock across the disk, no limit on a value, on a connection or on a plugin, a refused value leaving the older one standing, a refusal reported again, a snapshot kept before the fences, a shutdown that writes nothing, the connect snapshot or a failed refresh counted as a complete answer, the refusal memory never pruned, the list read without `connsMu`, the SDK's clearing not recognised, a profile change that does not drop the copy, a stop that does not settle, a retired registration that reads the file, a changed value at the kept time dropped, a failed read treated as an empty copy, a corrupt file not moved aside, leftovers not swept, a quit that waits for a hung disk, an erasure during a write that waits for the debounce, no generation for kept entries alone, an object named for a credential kept, a connection ID that looks like a credential kept, and what is served not held to the SDK's validation.

## Log

- 2026-11-25: read `CLAUDE.md`, `AGENTS.md` (rules 22, 31, 36, 40), `useConnectionMetadata`, the SDK's metadata controller, `connection_metadata.go`, the profile and authority stores, the uninstall hook path; wrote the store and its tests; negative controls (19) found the test that did not trip (M10) and the lock-held-across-I/O test that hung instead of failing; the real-SDK test confirmed the SDK's sequence and the need for `len(entries) > 0`; lint (5 findings, fixed) and the race above, fixed; docs.
- 2026-11-26: the independent review (11 findings) fixed in one commit on top, each with a test: see the table; the store file rewritten around a per-plugin `writeMu`, a `loaded` state and a `prepare` step; 33 controls; the reviewer's stress and probes run from a temporary copy.

## Not verified

- The real host with the Kubernetes plugin and a cluster, and the window: `TestConnectionMetadataLastKnownWithTheSDKAcrossHostRestarts` and the SDK clearing test run the host in front of a real SDK controller in process (not over gRPC), which is the path, but the Wails event and the hook in a window were not run. Nothing in the runtime changed.
- Windows: the rename over an existing file, the directory sync that the profile store also skips there, and the claim of finding 2 (that no file is held under the store after a stop) rest on the code and the fake-clock test, not on a Windows run.
- A host killed inside the 2 s debounce loses the last answer: by design.
- `ServiceShutdown` and the 3 s bound at quit in a running app: the tests call them (with a disk that hangs), the app was not run.
- The effect of an update on the file (inferred from `appstate`).
- A second independent review of this round's changes (rule 36): the first review's findings were fixed and checked by its own stress, not re-reviewed. Look first at `touchLocked`/`flush`/`settle`/`erase` (one writer, the document taken under the mutex and written outside it, a timer that is always cancelled by whoever flushes), at `warm` (the `loaded` state and its retry), and at `admitMetadata` (the fence before the read, `cleared`).

## Backend catalog

| Class | Where | What | Interim in the UI |
|---|---|---|---|
| TANGENTIAL (a generic gain, closed by this change) | host Go: `backend/pkg/plugin/resource/connection_metadata_last_known.go`, `connection_metadata.go` (`admitMetadata`) | Connection metadata was in memory on both sides (`docs/connection-metadata-design.md` section 7 said "Application restarted: no observations retained"), so a connection that is not connected showed nothing after a restart of the plugin or the host. The host now keeps the last answer for every plugin and serves it as stale entries with their observation times; no plugin and no SDK change. The SDK still forgets on a restart, and does not need to. | None needed: the entries arrive in the shape the hook already reads (`stale`, `observedAt`). A page that says "stale" for them is the page's own words. |

## Dev tools

`docs/ui-next/status/KL6/mutants.py.txt` (drop the `.txt`; run from the repository root): the 33 negative controls above. Scratch only, not committed: the reviewer's `zz_review_stress_test.go` and `zz_review_probe_test.go` in `/tmp/kl-review/` and the script that copied them in, patched them as described, ran them and removed them.

## Round 2 of the review (rule 36)

The second review's verdict was merge, with four small items. All are fixed in the next commit (3fb2532bc), each checked as below. The two rounds together: round 1 found 11 things (table above), round 2 four.

| # | Item | Fix | Test |
|---|---|---|---|
| A | A write could land after `settle` returned: `forget` and `retain` have no registration fence, so a profile change that captured the plugin's copy before a stop armed a timer after `OnPluginStop` (the reviewer's probe: `[0s]` armed after the stop). | A `settled` flag, set by `settle` and cleared by the plugin's next admitted `observe`. While it is set `touchLocked` marks the file owed and arms nothing; the next admitted snapshot arms the write (which carries what the change left owed) and the quit writes it too. | `…ARacingProfileChangeArmsNothingAfterTheStop` (fake clock; both ways out: the next admission of a registration that starts again, and the quit) |
| B | The design doc said the SDK's clearing drops the copy "while the host runs". | Section 13's first limit now says it holds only for a connection connected in this run: after a restart with no connect, `ApplyConnections` with changed `Data` publishes nothing (the SDK deduplicates the identical empty snapshot), so only the host's own profile operations drop the copy. | docs |
| C | `shutdown` and `close` each waited `quitWait` (6 s in all), and a hung disk could stall a plugin's stop. | One deadline for both (3 s in all). `settle` is bounded by the same 3 s: on timeout one `Warn`, and the file is left owed for the quit's flush. | `…AHungDiskDelaysNeitherAStopNorTheQuitBeyondTheBound` |
| D | `prepare` ran for a snapshot that is not newer than the mirror's, and the read retry ran on every admission while a read kept failing. | `admitMetadata` skips `prepare` for a snapshot whose revision is not newer than the mirror's. A read that has failed twice in a row is tried again once a second at most, by the store's clock (`now`); the first failure is tried again at the next admission. | `…BacksOffAReadThatKeepsFailing` (the skip has no test of its own: its effect is the cost of an admission that is discarded) |

Checks of round 2 (macOS arm64, Go 1.27.4, `GOWORK=off GOTOOLCHAIN=local`):

- Build, vet and `gofmt -l`: clean. The resource package without `-short`: ok (26 s); with `-race`: ok (70 s); 588 top-level tests (585 before), none failed or skipped. The 29 tests of this change passed 10 runs in a row under `-race`.
- The reviewer's round-2 stress (`/tmp/kl-review/*.r2.go.txt`, copied in temporarily and removed), mode 1, 20 s, under `-race`, the store reachable at `OnPluginUninstalled` in half the cycles: pass (51,982 operations, 324 stops, 261 uninstalls, 23 restarts).
- Changed-lines lint (the recipe of `status/N24-L2.md`): 0 issues.
- Controls: round 2 changed the text that M15 and M28 plant and added M34 (a change that raced a stop arms a write), M35 (the quit waits twice for a hung disk) and M36 (a failing read is tried on every admission); the script is updated, and those five were not run.

### Not verified (both rounds)

- Windows: the claim that no file is held under the store after a stop (finding 2 of round 1, item A of round 2) rests on the code and the fake-clock tests, not on a Windows run. The rename over an existing file, and the directory sync that the profile store also skips there, were not run either.
- The real host with the Kubernetes plugin and a cluster, and the window: the tests run the host in front of a real SDK controller in process (not over gRPC); the Wails event and the hook in a window were not run. Nothing in the runtime changed.
- The effect of an update on the file (inferred from `appstate`), and `ServiceShutdown` and the 3 s bounds in a running app (the tests call them, with a disk that hangs).
- A third look at round 2's changes: they were checked by the tests above and the reviewer's own stress, not re-reviewed. Look first at `touchLocked`/`settle` (the `settled` flag) and `within` (the shared deadline).
