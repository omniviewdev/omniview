# Status: KL6 (the host keeps each connection's last answered metadata, for every plugin)

- Agent: HostLastKnown
- Goal: a connection carries metadata a plugin's backend answers after a successful connect (SDK `Config.ConnectionMetadata`, read by the runtime's `useConnectionMetadata`). It lived in memory on both sides: a stop turned the entries `stale`, and a restart of the plugin or the host left a connection that is not connected with nothing to show. The host now keeps the last answer of every plugin's connections itself and serves it as `stale` entries with the time each was observed, exactly as entries look after a stop; a fresh answer replaces them. Generic: no plugin changes anything, and no plugin's vocabulary is in the code.
- Worktree: `~/Repos/omniviewdev/worktrees/metadata-last-known`
- Branch: `feat/connection-metadata-last-known`, from `origin/main` 05e889346. `origin/main` has since moved by two UI commits (#771, #780) that touch none of these files. Nothing committed, pushed or opened as a PR: the lead does that.
- Go only. No TypeScript changed (a stale entry already carries `observedAt` in `ConnectionMetadataEntry`, `connection/metadata.ts`, and the curated `ui/v1` type exports it), no binding changed (no exported type or method), no wire or SDK change.

## What changes

- `backend/pkg/plugin/resource/connection_metadata_last_known.go` (new): the store. One `lastKnownMetadata` on the controller; per plugin the entries of each connection; read once, written debounced, erased on request.
- `connection_metadata.go`, `admitMetadata`: `warm` the plugin's file before any lock; under `pluginsMu`, after the epoch, registration and revision fences, `observe` (record and overlay) or, for a tombstone, `forget`; the one log line is deferred before the unlock so it runs after it.
- `connection_profiles.go`: `writeStoreFile` is the body of `writeDesiredConnections` with the file name as a parameter (the same temporary file, fsync, rename and directory sync; `writeDesiredConnections` still answers `RESET_REQUIRED` when the rename took effect and the directory sync failed). `RemoveConnection` forgets the connection.
- `controller.go`: the field, the constructor, `ServiceShutdown` writes what is pending, `LoadConnections` drops what a plugin that no longer lists a connection kept for it (`retainLastKnownMetadata`).
- `uninstall_state.go`: `OnPluginUninstalled` erases the plugin's copy (memory, pending writes, file).
- `testutil_test.go`: the test controller closes the copy before the state service closes.
- `connection_metadata_last_known_test.go` (new): 12 tests.
- Docs: `docs/connection-metadata-design.md` (sections 5, 7, 10 and a new 13) and `docs/plugin-development.md` say what the host keeps.

## How it works

| Question | Answer |
|---|---|
| Where | `plugins/<pluginID>/store/connection-metadata-v1` under the channel's state root: the plugin's store, where the profile and authority stores are. It goes with the plugin directory on an uninstall. [INFERENCE] It survives an update: `internal/appstate` says an archive replacement moves the plugin's state directories into the new plugin directory; no update was run here. |
| Format | `{"version":1,"connections":{"<id>":{"entries":{"<key>":{"state":"stale","value":…,"observedAt":"…"}}}}}`. The entry is the SDK's own type, so the file is read back through the SDK's validation of an entry (JS-safe numbers, depth, bytes, UTC time). Mode 0600. No error, generation, revision, configuration or `sensitiveData`: the file has no field for them. |
| Kept | The value and time of each `current` or `stale` entry of an admitted snapshot. A current entry replaces what was kept; a stale entry of the plugin's memory only if observed later. A **complete answer** (active, not refreshing, no refresh error, with entries: only an acquisition produces those) also drops the kept keys it leaves out, which is how a provider's `remove` reaches the copy. |
| Served | The plugin's own entries plus, for each kept key it has none for, a stale entry (kept value, its time). A key the plugin says is `unavailable` and the host has a value for is served `stale` with the plugin's error, as the SDK serves a failed refresh of a key it has a value for. |
| When | Through the one funnel every snapshot passes (`admitMetadata`: the watch, `Get`, `Refresh`), so on start, and when the plugin's connections are listed before any connect, the inventory snapshots (inactive, empty) are shown with what was kept. |
| Writes | Debounced 2 s and coalesced (one timer for a plugin, whatever the number of changes), one write at a time for a plugin, each through `writeStoreFile`. An erasure is written at once. `ServiceShutdown` writes what is pending. A failed write leaves the file owed (retried by the next change and at shutdown); a missing plugin directory drops it. When nothing is kept the file is removed. |
| Caps | 32 entries for a connection (earliest observed go first), 8 KiB of JSON for a value (a value over it is not kept and removes the older value of its key), 4 MiB for a plugin (the connections observed earliest go first); the file read is at most 8 MiB. One `Warn` line per admission that left something out: counts, the first key, no value. A refusal is remembered by its observation time, so it is reported once, and forgotten when a complete answer stops carrying the key. |
| Erasure | A tombstone, `RemoveConnection`, a `LoadConnections` that no longer lists the connection (it went while the plugin was not running), and `OnPluginUninstalled` (the path H3 added: the manager calls it once the uninstall is durable, and again at the next start if it failed). A plugin that stops, crashes or restarts keeps its copy. The uninstall hook cancels the plugin's timer, waits for a write in flight and removes the file only for a plugin this run used (so it can never create a directory for one that is gone: after `ReleasePluginRoots` the store lookup answers not-exist). |
| Redaction | The key and every string of a value, and every member name inside it, pass `devdiag.Redact` and `devdiag.SensitiveKey`, the redaction the log sinks apply. A match is **refused, not redacted in place** (`https://[REDACTED]@host` would be a false fact). A window is still shown what the plugin published. The same test runs again on what is read from disk. |
| Concurrency | The copy's mutex is a leaf: it guards maps and write bookkeeping only, never held across disk I/O, a log call, a controller callback or a plugin call; order is `pluginsMu`/`profilesMu`/`connsMu` then it. Admission calls it inside `pluginsMu` after the fences, so an entry from a retired epoch, a replaced plugin generation or an older revision never reaches it. The disk is read once per plugin (`warm`, before any lock) and written by one flush at a time per plugin: the document is taken under the mutex, written after it is released, and a change that arrives during a write is scheduled as one more. `StartConnection` and `StopConnection` never call it. |

## Decisions that are mine (review these)

1. **The complete-answer rule needs `len(entries) > 0`.** The SDK publishes, at a connect, an active snapshot with no entries and then the refreshing one. Without the guard the first drops everything kept and the window blinks for the length of the probe. The real-SDK test holds the probe open and checks that what was known is still shown; control M16 is caught only by it.
2. **Keys the plugin's complete answer leaves out are dropped.** The Kubernetes plugin removes environment keys it no longer infers (`update.Remove`), and the SDK cannot tell the host that when the key was never in this generation's entries. The price is a short gap for a fact a plugin publishes in a later acquisition than its first.
3. **Refuse, never redact in place; the window is not held to it.** Only the copy that outlives the run is.
4. **A snapshot of an inactive connection can carry stale entries and an empty `generation`.** The SDK's own validation says entries need a generation, but the host does not re-validate what it serves and the runtime never reads `generation`. Documented in section 13 of the design doc.
5. **The listing prune is `LoadConnections` only.** A connection a plugin stops listing while it runs comes as a tombstone. A transient empty listing erases the copy of every connection; it is a cache, and the next connect writes it again.
6. **`writeStoreFile` is extracted from the profile writer, not copied.** The log texts of its failures say "plugin store" and not "connection profile"; nothing asserts them.
7. **The caps are my numbers** (32, 8 KiB, 4 MiB, 2 s). The Kubernetes `kubernetes.unavailable_api_groups` fact (32 groups) is about 4 KB.

## Checks

macOS arm64, Go 1.27.4, `GOWORK=off GOTOOLCHAIN=local`, load average 10 to 20 (other agents share the machine: not a benchmark).

- `go build ./...` and `go vet ./backend/pkg/plugin/resource/...`: exit 0.
- `go test ./backend/pkg/plugin/resource/...` without `-short`: ok (25 s); with `-race`: ok (70 s). The package: 571 top-level tests (and 497 subtests), 0 failed, 0 skipped. The new tests also passed 3 runs in a row with `-race` before the last two were added, and the two that run starts, stops and loads together passed 40 runs in a row with `-race`.
- Changed-lines lint, the recipe of `status/N24-L2.md` (golangci-lint v2.15.0; nothing is committed, so the patch is `git diff --cached HEAD` against a temporary `GIT_INDEX_FILE` that holds the new files too): 0 issues. The first run found 5 (an unchecked type assertion and a package variable in the test, a shadowed `err` in `writeStoreFile`, a string built in a loop, `assert` where `require` is wanted); all fixed.
- `task check:go-test -- -short`: every package ok but two, which fail the same way on an export of `HEAD` without this change (`git archive HEAD`, checked): `backend/pkg/plugin/exec` (`TestTheListOfShellsMarksTheShellThatStartsWhenTheSettingCannotStart` and `TestTheListMarksTheShellThatStartsWhenTheEnvironmentShellIsNotAShell`: TempDir cleanup "directory not empty") and `backend/pkg/terminal` (`TestBashXtraceNeverPrintsTheNonceAndTheStatusesAreRight`, `TestZshXtraceNeverPrintsTheNonce`). Neither touches the resource controller.
- TypeScript, bindings, the runtime build and its API report: not run, nothing changed there.

### What the race detector found

The first full `-race` run after the tests were written failed an existing test, `TestFailuresKeptStayWithinTheListUnderOverlappingStartsStopsSyncsAndReads`: `LoadConnections` returns the slice the controller published as its own list, a start or a stop writes it in place under `connsMu`, and `retainLastKnownMetadata` read its IDs with no lock, and for every plugin, because the argument was built before the plugin was asked whether it keeps anything. Now a plugin that keeps nothing never reads the list, and one that does reads it under `connsMu`. `TestConnectionMetadataLastKnownReadsTheListedConnectionsUnderTheirLock` holds that (control M19: caught only under `-race`).

## Controls (rule 28)

`KL6/mutants.py.txt`: 19 faults, each planted alone in a scratch copy of one file that `go test -overlay` substitutes, so the repository is never edited; 19 of 19 are caught by the test named for the rule (a stale entry replacing a later one, a complete answer keeping omitted keys, no redaction of a value or of a key, an uninstall leaving its write, every change arming a timer, the write holding the lock across the disk, no limit on a value, on a connection or on a plugin, a refused value leaving the older one standing, a refusal reported again, a snapshot kept before the fences, a shutdown that writes nothing, the connect snapshot or a failed refresh counted as a complete answer, the refusal memory never pruned, the list read without `connsMu`). M10 survived once: I had extended a test with a last event that dropped the key anyway and hid the fault; the case was split and M10 is caught.

## Log

- 2026-11-25: read `CLAUDE.md`, `AGENTS.md` (rules 22, 31, 36, 40), `useConnectionMetadata`, the SDK's metadata controller (its snapshot sequence at connect, refresh, stop and restart), `connection_metadata.go`, the profile and authority stores, the uninstall hook path (`uninstall_cleanup.go`, `types/controller.go`).
- Wrote the store and the tests; first run all green; negative controls found the test that did not trip (M10) and the lock-held-across-I/O test that hung instead of failing (the blocked write is now released on failure).
- Wrote the real-SDK test (host restarts in front of a real SDK controller): confirmed the SDK's sequence and the need for `len(entries) > 0`.
- Lint (5 findings, fixed), then the full `-race` run: the race above, fixed.
- Docs: the design doc and the plugin guide.

## Not verified

- The real host with the Kubernetes plugin and a cluster, and the window: `TestConnectionMetadataLastKnownWithTheSDKAcrossHostRestarts` runs the host in front of a real SDK controller in process (not over gRPC), which is the path, but the Wails event and the hook in a window were not run. Nothing in the runtime changed.
- Windows (the rename over an existing file, the directory sync that the profile store also skips there).
- A host killed inside the 2 s debounce loses the last answer: by design.
- `ServiceShutdown` at quit in a running app: the test calls it, the app was not run.
- The independent review rule 36 asks for (locking, file handling, uninstall) is not done here. Look first at `observe` and `touchLocked`/`flush`/`begin`/`end` (one writer, the document taken under the mutex and written outside it), at `erase` (waits for a write in flight, then removes), and at `retainLastKnownMetadata` (the race above).
- The `OnPluginUninstalled` path of an uninstall that failed and is retried at the next start finds nothing in memory and removes nothing: the file went with the plugin directory.

## Backend catalog

| Class | Where | What | Interim in the UI |
|---|---|---|---|
| TANGENTIAL (a generic gain, closed by this change) | host Go: `backend/pkg/plugin/resource/connection_metadata_last_known.go`, `connection_metadata.go:147-199` (`admitMetadata`) | Connection metadata was in memory on both sides (`docs/connection-metadata-design.md` section 7 said "Application restarted: no observations retained"), so a connection that is not connected showed nothing after a restart of the plugin or the host. The host now keeps the last answer for every plugin and serves it as stale entries with their observation times; no plugin and no SDK change. The SDK still forgets on a restart, and does not need to. | None needed: the entries arrive in the shape the hook already reads (`stale`, `observedAt`). A page that says "stale" for them is the page's own words. |

## Dev tools

`docs/ui-next/status/KL6/mutants.py.txt` (drop the `.txt`; run from the repository root): the 19 negative controls above, each a scratch copy of one source file substituted through `go test -overlay`. Scratch only, not committed: `/tmp/klmut/` (the first version of it) and `/tmp/kl-base`, an export of `HEAD` (`git archive`) used to see that the `exec` and `terminal` failures are not this change's.
