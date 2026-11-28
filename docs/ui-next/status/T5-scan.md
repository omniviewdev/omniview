# Status: T5-scan (the mark scanner and the per-session command record, issue #694 step 1)

- Agent: MarksScanner. Goal: the terminal's Go side can read the shell's marks (OSC 133, 633, 7) out of the output, with a trust level backed by a per-session nonce, into a bounded record of commands addressed by byte offset, without changing a byte, in a leaf package that the manager adopts later (step 4) and that the SDK's `pkg/v1/exec/scan` (X4a) replaces by an import. No injection, no wiring: `backend/pkg/terminal/manager.go` and everything else under `backend/pkg/terminal` are untouched (PR #704 edits the manager).
- Worktree: `~/omniview/wt/t5-scanner`. Branch: `feat/terminal-marks-scanner` on `origin/main` `adf21b89`. Epic #692, issue #694.
- Owned: `backend/pkg/terminal/marks/` (new), `docs/ui-next/status/T5-scan.md`, `docs/ui-next/status/T5-scan/mutations.sh.txt`.

## Decision (to repeat in the first pull request)

One scanner, as the issue binds: a leaf package with the SDK's API shape, so that X4a (`exec-lane.md` 7, `pkg/v1/exec/scan/{scanner,marks,modes,nonce}.go`) takes the shapes over and the host then deletes its copy. It is not a pure move: X4a adds what this package does not have, the ground state at a chunk boundary and a UTF-8 boundary for the replay start (additive, and it merges the two tokenizers).

- Package `marks`, directory `backend/pkg/terminal/marks`. It is the `marks.go` and `nonce.go` part of the SDK's `scan`; the SDK's `scan` also holds the terminal-modes tracker, which stays in `backend/pkg/terminal/modes.go` until then (a second tokenizer for the modes is not worth merging into a package that must not touch the manager now). The tokenizer (ground, ESC, CSI, OSC, strings) is a second copy of the states of `modes.go` cut to what marks need; the SDK's X4a merges both into one.
- Names: `Mark{Kind, AtOffset, ExitCode, HasExitCode, Cwd, CommandID, CommandLine, Trust, DurationMS, Redraw}` is the SDK's `Mark` (`exec-lane.md` 4.3) with `Kind` for `MarkKind` and `Trust` for `MarkTrust` (`TrustUnverified` = 0, `TrustNonce` = 1; the zero value is the safe one). `ExitCode` is `int32` plus `HasExitCode` where the generated Go has `*int32`: a pointer would allocate per command end. `MARK_INPUT_START` is `KindInputStart`.
- Not in the SDK's `Mark` and kept out of it: the record (`Record`, `Log`) is the host's (`exec-lane.md` H1c: "the per-command record is kept in Go from the marks").

## What it does

- `New(Config{Nonce, Now, MaxRecords, StartOffset}) *Scanner`; `Scanner.Feed(p, out) []Mark` appends the marks of the next read, `Offset()`, `Stats()`, `Log()`. `Feed` never changes or keeps `p`; one goroutine feeds; the `Log` and the counters are readable from any.
- `Log`: `Records()` (a copy, oldest first), `Last()`, `Running()` ("a command is running", B-106), `At(offset)`, `Cwd()`. A ring of `MaxRecords` (512 by default); a command line is cut at 4 KiB, a directory over 4 KiB is dropped, an OSC payload over 17 KiB is dropped and counted, and OSC that are none of ours (titles, clipboard) are skipped without being kept.
- `Record{CommandID, State, Ran, CommandLine, Trust, Cwd, CwdTrust, ExitCode, HasExitCode, StartedAt, EndedAt, PromptOffset, OutputStart, OutputEnd}`. `[OutputStart, OutputEnd)` is the output: `OutputStart` is the offset after the C sequence, `OutputEnd` the offset of the D sequence; `Mark.AtOffset` is the offset of the ESC that begins a sequence. Times come from `Config.Now` (the producer's clock), read at C and at D only. `DurationMS` is monotonic only when `Config.Now` is `time.Now` (a wall time with its monotonic reading, which is the default); an injected clock gives the difference of its own readings, clamped at 0.
- Trust. Only `633;E;<line>;<nonce>` and `633;P;Cwd=<path>;<nonce>` can be trusted, and only when the field after the last `;` equals the session's nonce (`crypto/subtle`, a configured empty nonce trusts nothing). A wrong, empty or missing nonce gives no command line and no directory, is counted in `Stats.Forged`, and emits nothing. Every OSC 133 and OSC 7 mark is `TrustUnverified`: navigation only. A directory sent with the nonce wins over OSC 7 for `Log.Cwd()` and for `Record.Cwd` (`CwdTrust` says which); the command line is on the C mark of the command and in the record, set by a verified E that comes before C.
- The nonce: `Nonce` prints as `«secret»` from every verb, `String`, `GoString`, JSON, text and `slog`; `Mark`, `Record`, `Scanner` and `Log` print without any string of the user's (no line, no directory) from every verb and from `slog`. The only reader is `Nonce.Reveal`, for the code that hands it to the script (step 2). `ParseNonce` errors never contain the input.
- Lifecycle, as tested: A opens a command (a second A at the prompt is the same command, `Redraw`); B moves it to input; C starts it (without B, or without A, too); D ends it (a D with no code, as pwsh, has no exit code; a D at the prompt, Ctrl-C at an empty prompt, ends a command that never ran); a stray A, B, C or forged D inside a running command does not open a command. A lone D with no open command is a mark with no id and no record. `633;A..D` are read as `133;A..D`.
- Sequences: BEL and ST end an OSC; a raw ESC inside an OSC ends it (the OSC is dispatched with what came before, as the DEC parser does) and begins the next sequence; CAN and SUB cancel it; other C0 bytes and DEL are ignored inside an OSC; `%HH` in an OSC 7 path is decoded; a path that then holds a control byte (an encoded one, or an escaped one of 633;P) is NOT stripped (stripping names another directory): the mark is dropped, counted in `Stats.Malformed`, and the tracked directory becomes unknown until the next sound one (step 7, `T5-frameworks.md`). A raw control byte inside the OSC (a raw DEL too) is ignored by the scanner, as a terminal does, and is not a reason to drop the mark: the host's scripts never print one raw, and a program that does is forging an unverified mark. An OSC 7 that cannot be read clears only the directory OSC 7 gave, never the one the shell proved with the nonce. DCS, SOS, PM and APC contents are never marks, but an ESC inside one that is not followed by `\` ends it and starts a new sequence (a `DCS ... ESC ] 133;A BEL` is a mark, as the emulator reads it). 8-bit C1 controls are not read (a UTF-8 terminal).
- Not done, on purpose: the host of an OSC 7 is not checked or reported (a remote shell's OSC 7 is unverified like any); a decision for step 4 with the page's use of the directory.

## Log

- 2026-11-24 `d568e6e8db` (red): the tests against a stub with the final API and no behaviour. All 44 tests fail by their own assertions (for example `the marks have the kinds [], want [5 5 1 2 3 4]`, `the log keeps 0 commands, want 3`, `the scanner counts 0 bytes, want ...`, `"": error <nil>, want ErrBadNonce`); the tests that would pass on a stub by nature (bounded, unchanged, allocation-free, strings-are-not-marks, concurrent read) carry a check that a stub which reads nothing cannot satisfy.
- 2026-11-24 green: the scanner, the log and the nonce.

## Verification

Linux amd64, Go 1.27.4 (`PATH=$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.4.linux-amd64/bin:$PATH GOWORK=off GOTOOLCHAIN=local`):

- `go test -race -count=3 ./backend/pkg/terminal/marks/...` green; `go vet` clean for linux, darwin and windows.
- golangci-lint v2.15.0 (installed into a temporary `GOBIN`), the CI form of `N24-L2.md`: 0 issues on the diff.
- The 16 MB flood (genuine and forged marks, 32 KiB reads): the log keeps at most 64 of the commands it is set to, the heap grows by under 4 MiB (the test's bound), and every byte is counted. A 1 MB OSC (a command line, a directory, a prompt option) is dropped, counted once in `Stats.Oversize`, and the next command is read; the same megabyte as a title is skipped and not counted.
- Split at every byte offset gives the same marks, records and stats (every single cut, every byte alone, every pair of cuts of a short command); 200 random streams are never changed and the offset equals the bytes fed; `FuzzFeed` (seeds only run in `go test`) checks no change, cut-independence, no control byte in a directory and the limits.
- Allocations per read, `testing.AllocsPerRun`: 0 for plain text, SGR colors, titles and other OSC, DCS, a repeated OSC 7 and OSC 633;P; at most 1 for a read cut inside a sequence and for a whole command (its id). Benchmarks (`go test -bench . ./backend/pkg/terminal/marks/`, one machine, x86-64, 16 threads, `-benchtime 300x`, load average 5.45 / 8.86 / 9.69 (1, 5, 15 min, `uptime`) before and 5.34 / 8.78 / 9.66 after: a shared machine, so read them as orders of magnitude): plain text 12.3 GB/s, 0 allocs; ESC-dense text (4 sequences every 66 bytes) about 94 MB/s, 0 allocs; whole commands with marks about 162 MB/s, about 3 allocs per command (its id, its command line, and the log's growth until it is full). The SDK's X4a target (>= 1 GB/s with all consumers) is met for text and not for ESC-dense output: a CSI fast path inside the tokenizer is left to X4a, which merges the two tokenizers.

## Negative controls (AGENTS 28)

`docs/ui-next/status/T5-scan/mutations.sh.txt`, run from the worktree (`bash docs/ui-next/status/T5-scan/mutations.sh.txt [name]`). Each fault is in a scratch copy under `go test -overlay`; the worktree is never edited. Half 1: the tests that go red are exactly the ones named. Half 2: with those tests skipped, the same fault passes (nothing else sees it). All 25, both halves, on this head (the first ten from the first pass, the next fourteen from the independent review, the last from CodeRabbit, each a guard no test noticed):

| Control (the fault) | Red in (half 1) | Without them (half 2) |
|---|---|---|
| nonce-not-checked (`verified` always true) | `TestAForgedDirectoryNeverChangesTheTrustedOne`, `TestAForgedMarkInTheOutputNeverReplacesTheGenuineOne`, `TestANonceAfterOtherBytesIsRefused`, `TestAWrongOrMissingNonceNeverGivesACommandLine`, `TestNoNonceInTheConfigTrustsNothing`, `TestTheDirectoryOfTheShellNeedsTheNonceToBeTrusted` | pass |
| empty-nonce-trusted (no `len(nonce) > 0` guard) | `TestNoNonceInTheConfigTrustsNothing` | pass |
| forged-directory-accepted-as-trusted (an OSC 7 writes the trusted slot) | `TestAForgedDirectoryNeverChangesTheTrustedOne`, `TestOSC7GivesTheDirectoryDecodedAndUnverified` | pass |
| line-taken-after-the-start | `TestAForgedMarkInTheOutputNeverReplacesTheGenuineOne`, `TestAVerifiedLineBeforeAnyPromptBelongsToTheNextCommand` | pass |
| scanner-changes-a-byte (blanks the bytes of an OSC in `p`) | `FuzzFeed`, `TestTheScannerNeverChangesAByte` | pass |
| record-unbounded (no eviction) | `TestACommandIsFoundByAnOffsetInIt`, `TestTheLogDefaultIsBounded`, `TestTheLogKeepsTheNewestCommandsAndIdsGoOn`, `TestTheRecordStaysBoundedUnderA16MBFlood`, `TestTheRecordStaysBoundedWhateverTheFloodIsMadeOf` | pass |
| state-lost-between-reads (ground state at the end of `Feed`) | `FuzzFeed`, `TestMarksAreTheSameWhenTheStreamIsSplitAtEveryOffset` | pass |
| control-bytes-kept-in-a-directory (a percent-encoded ESC is kept) | `TestADirectoryWithAControlByteInItsNameMakesTheTrackedDirectoryUnknown`, `TestATrustedDirectoryWithAnEscapedControlByteIsUnknownAndNeverAStrippedPath` (renamed in step 7) | pass |
| nonce-printed-by-the-scanner (`Scanner.Format` adds the nonce) | `TestTheNonceNeverShowsInAnythingThatPrintsIt` | pass |
| directory-allocates-on-every-read (no reuse of the same directory) | `TestReadsOfOrdinaryOutputAllocateNothing` | pass |
| end-twice-rewrites (a second D reopens an ended command) | `TestASecondEndOfAnEndedCommandChangesNothing` | pass |
| exit-overflow-wraps (no bound on the digits: 2^64+1 reads as 1) | `TestAnExitCodeThatDoesNotFitIsNoCodeAndNeverWraps` | pass |
| exit-negative-dropped (the sign is lost) | `TestANegativeExitCodeIsRead`, `TestAnExitCodeThatDoesNotFitIsNoCodeAndNeverWraps` | pass |
| vscode-letters-not-read (633;A..D) | `TestVSCodePromptLettersAreReadLikeOSC133` | pass |
| redraw-option-ignored (`redraw=1`) | `TestRedrawIsReadFromTheOptionAndFromARepeat` | pass |
| st-end-offset (an ST-ended sequence ends one byte early) | `TestAnEndedByTheSTAndByBELGiveTheSameOutputStart` | pass |
| mark-prints-directory (`Mark.Format`) | `TestAMarkOfADirectoryPrintsNoDirectory` | pass |
| trusted-directory-keeps-controls (an escaped `\x1b` kept) | `TestATrustedDirectoryWithAnEscapedControlByteIsUnknownAndNeverAStrippedPath` | pass |
| first-semicolon-ends-the-line / first-semicolon-ends-the-directory (the two `LastIndexByte` guards) | `TestASemicolonInAGenuineLineOrDirectoryIsPartOfIt` | pass |
| nonce-matched-by-suffix | `TestANonceAfterOtherBytesIsRefused` | pass |
| nonce-matched-by-prefix | `TestANonceAfterOtherBytesIsRefused`, `TestAWrongOrMissingNonceNeverGivesACommandLine` | pass |
| nonce-text-prints-value / nonce-gostring-prints-value | `TestTheNonceTextAndGoFormsNeverPrintTheValue` | pass |
| pending-line-dropped (a verified line with no command open is dropped) | `TestAVerifiedLineBeforeAnyPromptBelongsToTheNextCommand` | pass |

## Not verified

- The constant-time compare of the nonce (`crypto/subtle` in `verified`, `osc.go`) is held by review, not by a test: timing is not observable in a unit test, and a test that reads the source is not allowed here.
- No real shell, no real prompt framework (p10k, starship, oh-my-zsh): the foreign sequences are written from what each is documented to print, not recorded. The seam fixtures are step 7.
- Not wired: no manager, no event, no page, no `integration` fact; the scanner has not seen a real pty.
- The `-race` run does not cover the manager's reader and a client reading the log together (there is no manager here); the test reads the log from four goroutines while one feeds.
- Windows and darwin: `go vet` only, no test run.

## Dev tools

| Tool | What | Where | Keep? |
|---|---|---|---|
| `mutations.sh.txt` | The negative-control runner (scratch copies under `go test -overlay`, both halves) | `docs/ui-next/status/T5-scan/mutations.sh.txt` | yes: re-run when the scanner or the log changes |
| `Benchmark*` | Throughput and allocations of `Feed` for plain text, ESC-dense text and commands | `backend/pkg/terminal/marks/bounds_test.go` | yes |

## Backend catalog

| Class | Where | What | Evidence | Interim in the UI |
|---|---|---|---|---|
| MISSING | `backend/pkg/terminal/manager.go` `read` | The scanner is not fed: marks, the record and `Running()` are not reachable from the host or the page. Step 4 feeds it beside `modes.go` and exposes the record's read call. | this step adds the leaf package only | none: no gutter, no "command running" |
| MISSING | `backend/pkg/terminal/env.go`, `internal/shellenv` | No nonce is generated and no script prints marks (step 2 and 3): until then every mark in a session is a forged or foreign one and none is trusted. | `Nonce` and `NewNonce` exist, nothing calls them | none |
| TANGENTIAL | SDK `pkg/v1/exec/scan` (X4a) | The same shapes (`Mark`, `Trust`, `Nonce`) and one tokenizer for marks and modes; the move deletes this package's tokenizer copy and the host's. The `Mark` here has `HasExitCode` for the SDK's optional `exit_code`. | `exec-lane.md` 4.3 and X4a | none |
