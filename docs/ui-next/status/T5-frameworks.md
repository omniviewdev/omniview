# Status: T5-frameworks (issue #694 step 7, the framework part: the integration next to p10k, starship, oh-my-zsh, zim, z4h, bash-preexec)

- Agent: FrameworkFixtures. Worktree `~/omniview/wt/t694-frameworks`, branch `test/terminal-integration-frameworks` on `origin/main` `941289cdf`. Test code, fixtures, three fixes found by the tests.
- Files: `backend/pkg/terminal/integration_frameworks_test.go`, `backend/pkg/terminal/testdata/frameworks/` (`PROVENANCE.txt`, `vendor/`, `standins/`, `homes/`), `docs/ui-next/status/T5-frameworks/mutations.sh.txt`, this file. Fixes: `integration_scripts/zsh/zlogin`, `integration_scripts/bash/bashrc`, `marks/osc.go`, `marks/log.go` (+ two marks tests rewritten, `T5-scan.md` text).

## What is vendored and what is a stand-in

No framework is installed and no test downloads. Vendored files are UNCHANGED (sha256 in `PROVENANCE.txt`), licence next to them. Licences were read, none is copyleft.

| Framework | Kind | What | Licence |
|---|---|---|---|
| bash-preexec | VENDORED | `bash-preexec.sh` tag 0.7.0 (`d866eeef`) | MIT |
| starship | VENDORED init scripts + STAND-IN binary | `src/init/starship.{zsh,bash,fish}` at `b9432ccb` (templates, `::STARSHIP::` replaced at run time); `standins/starship` is a shell script that stands for the binary (`init`, `time`, `prompt --status=`); cites `src/init/mod.rs:163-171,243` | ISC |
| oh-my-zsh | VENDORED lib files + STAND-IN loader | `lib/termsupport.zsh`, `lib/functions.zsh` at `abfce729` (titles OSC 1/2, OSC 7 with ST, `add-zsh-hook`); `standins/ohmyzsh.zsh` stands for `oh-my-zsh.sh:310,334-340` and a theme that reads `%?` | MIT |
| Zim | VENDORED module + STAND-IN init | `zimfw/termtitle` `init.zsh` at `b0de7783`; `standins/zim-init.zsh` stands for the generated `init.zsh` (`src/templates/zimrc:18`); `.zshrc` of the home copies `README.md:86-92` (`ZIM_HOME` from `ZDOTDIR`) | MIT |
| powerlevel10k | STAND-IN | `standins/p10k.zsh`: `P9K_VERSION` as a shell variable (`internal/p10k.zsh:9539`), 133 A/B in the prompt (`8416-8418`), `_p9k_iterm2_precmd/preexec` with `133;D;n`, `133;C;cmdline_url=` (`8908-8930`, `9137`), hook arrays (`9155-9156`, `7117-7127`) | MIT |
| zsh4humans | STAND-IN | `standins/z4h.zsh`: `fn/-z4h-enable-iterm2-integration:28-41` (133 C/D, OSC 1337 CurrentDir), `fn/-z4h-init-zle:12-36` (hooks), `:33-34` (`add-zsh-hook`); `homes/z4h-zsh/.zshenv` copies `.zshenv:14-22` (`: ${ZDOTDIR:=~}`, `no_rcs` ... `rcs`) | MIT |

Each stand-in carries its citation in its own header and every test file says it is a stand-in. Honest limits: the stand-ins are what bites an integration, not the frameworks; the real p10k (9500 lines, gitstatus) and the real z4h bootstrap were never run. Zim's own `.zimrc` and `zimfw` were not run.

## Which shell and emulator ran

Every test uses the machine's REAL zsh 5.9, bash 5.2.37 (`/usr/bin/bash`; the earlier text said 5.3, which was wrong) and, for the bash-preexec PS0 path, bash 5.3.15 (Debian `bash_5.3-4+b1` unpacked into `/tmp/bash53`, not installed; chosen with `OMNIVIEW_TEST_BASHES=/usr/bin/bash:/tmp/bash53/root/usr/bin/bash`; every bash subtest name carries its version: `home@bash-5.3.15`; the older tests of `integration_bash_test.go` use the bash on PATH) and fish 4.0.2 on a pty (fish is not installed on this machine: the Debian 4.0.2 package was unpacked into `/tmp/fishdl` and made visible with an overlay mount of `/usr/share` in a user namespace, as in `T5-inject.md`; without fish its subtests skip as "NOT RUN"). There is NO emulator: the tests read the bytes of the pty and feed the host's scanner (`marks`), as the manager does. No Go test here uses a stub shell. pwsh is not installed and not part of this step.

## Tests

`integration_frameworks_test.go` (every one runs a case per framework home, in the real shell of that home):

- `TestAFrameworksUserStillGetsTheGenuineMarksTrustedWithTheRightExitCodes`: with the framework loaded, `true`, `false`, and a command that ends with 3 give exactly 3 records, each a trusted line as typed, exit codes 0, 1, 3, trusted cwd; no extra record from a framework's mark.
- `TestWhatAFrameworkPrintsOnItsOwnIsAcceptedAtLowTrustAndNeverAsACommandLine`: integration off, so the marks are the framework's alone (p10k, z4h, fish 4: C and D; oh-my-zsh, fish: OSC 7): records with the right exit codes, trust `unverified`, no command line (a `cmdline_url` is not one); cwd `unverified`.
- `TestAPowerlevel10kUserGetsNoHooksFromTheIntegrationAndKeepsTheirOwnMarks`: the `${+P9K_VERSION}` guard of `.zlogin` (T5-inject.md "not tested"): the fact is `on`, no `__omniview` function in the hook arrays, no 633 byte in the stream, p10k's marks are low trust with the right codes.
- `TestTheStatusAFrameworksHookSeesIsTheUsersAndEveryCommandReachesTheFramework`: the status the framework's own hook (or starship's `--status=`, or the `%?` of the oh-my-zsh theme, or fish's `$status` in starship's `fish_prompt`) saw is `0 1 3`, equal to the run with no integration; bash-preexec's `preexec` saw every command.
- `TestAFrameworksPromptTextIsUnchangedAndNothingIsPrintedOutsideTheMarks`: with the OSCs taken out the integrated stream equals the plain one (bytes; fish: typed text).
- `TestTheFilesOfAFrameworksUserAreByteIdenticalAfterASession`: sha256 of every file of the home.
- `TestTheZDOTDIROfZimAndZsh4humansIsTheUsersOwn`: `ZIM_HOME` is under the home; the z4h `.zshenv`'s `ZDOTDIR=~` is what the shell has afterwards, not the shim.
- `TestADirectoryWhoseNameHoldsAnEscapeByteNeitherEndsTheCwdMarkEarlyNorGivesAWrongPath` (d): a directory named with ESC, an OSC 133;D;9, a forged 633;E, BEL and ST; real zsh, bash, fish, and the oh-my-zsh and z4h homes: the script's cwd mark is one whole sequence carrying the escaped name; the tracked cwd is right or unknown; `GetCwd` (`Manager.Cwd`) names the real directory; no forged record. In fish the name's `133;D;9` DOES arrive, from fish's own OSC 0 title (raw name): proved by a control run with the setting off; it is fish's mark, not the integration's.

## Bugs found and fixed (red test first)

Red `ccfbe0cc4` (fixtures and tests; red by assertion: `expected: ["true","false","(exit 3)"] actual: ["","",""]` for z4h; `fewer than 3 commands ran` for bash-preexec and starship+bash-preexec; `bash-preexec's preexec ... expected "true\nfalse\n..." actual "false\n..."`; the ESC directory: tracked directory `".../esc]133;D;9]633;E;forged;0000\\dir"` for zsh, bash, fish, oh-my-zsh, z4h; the two marks tests). Green `b448e41ef`.

1. zsh: the integration's `preexec` was appended, so z4h's (and p10k's) own `133;C` came BEFORE the `633;E` line: the scanner drops a line that comes while a command runs, so every command had no trusted line. Now first in `preexec_functions`.
2. bash: bash-preexec installs itself at the first prompt, in the middle of the prompt commands, and ends with `__bp_interactive_mode force`; our last hook ran after and bash-preexec's DEBUG trap put the mode out again: the FIRST command of every session never reached the user's `preexec` (a user-visible regression for atuin and others: seen: preexec log `false`, `echo hi`, `true` with the integration, `true`, `false`, ... without) nor our trap. The last hook now says the prompt is shown when bash-preexec is installed. Not fixed, and not ours: bash-preexec itself does not see a subshell command `(exit 3)` (its log lacks it with the integration off), so the bash-preexec homes use `sh -c 'exit 3'`.
3. marks (agreed with Main): a directory with a control byte (percent-encoded in OSC 7, or `\xHH` in 633;P) was STRIPPED to a path that does not exist (`/x/esc]133;D;9...dir`, trust nonce). Now the mark is dropped, counted in `Stats.Malformed`, and the tracked directory becomes unknown (also not the one from before the `cd`); the next sound directory sets it again (tested, both marks). Only the mark was wrong: `GetCwd` already gave the real path (its SameFile rule refuses the stripped one); the new test asserts it. A raw control byte inside the OSC stays ignored by the scanner, as in a terminal (unchanged). The contract text that said "stripped" is `T5-scan.md`, updated; `T1-go.md` and `T2-go.md` have no such text; "Ghostty strips control bytes" is replaced for directories only, command lines and titles are unchanged.

fish with starship: no bug seen. The `printf` calls of our `fish_prompt` handler do not reset the `$status` that starship's prompt reads (the status log is `0 1 3`); the control below proves the test would see it.

## Controls (`docs/ui-next/status/T5-frameworks/mutations.sh.txt`)

Same harness as `T5-inject` (`go test -overlay`, the worktree is never edited; half 1 the red set is exactly the named tests, half 2 with them skipped the fault passes). Run under an environment where fish runs (`/tmp/fishdl/run.sh bash docs/ui-next/status/T5-frameworks/mutations.sh.txt`).

| Control | Red in |
|---|---|
| p10k-guard-removed | the p10k guard test |
| zsh-preexec-last | genuine marks (z4h) |
| bash-preexec-first-command | genuine marks, status/preexec |
| bash-status-clobbered | status/preexec |
| zsh-status-read-late | genuine marks (exit codes) |
| fish-status-clobbered | status/preexec (fish, starship) |
| user-file-edited | user files byte-identical |
| script-prints-outside-its-marks | prompt text unchanged |
| zdotdir-not-given-back | ZDOTDIR test, prompt text (optional: genuine marks) |
| zsh/bash/fish-esc-not-escaped | the ESC directory test |
| foreign-osc7-trusted | what a framework prints is low trust |
| path-with-control-byte-stripped (terminal) and ...-marks | the ESC directory test; the two marks tests |

Not controlled, said plainly: a script fault that makes a DUPLICATE record. Installing the hooks twice did not produce one (the scanner takes a repeated mark for the same command), so the "no duplicate" half of the genuine-marks test is held by its counts (3 records, 3 trusted) and guarded by the two controls that make a trusted line MISSING, not by a duplicating fault.

## Commands run and results

Environment: Go 1.27.4, `GOWORK=off GOTOOLCHAIN=local`; fish through `/tmp/fishdl/run.sh` (user namespace, overlay of `/usr/share`).
- `go test -race ./backend/pkg/terminal/...` (with fish visible): `ok terminal 264s`, `ok terminal/marks 12.6s` (on the green commit `b448e41ef`; the later commit changes test code layout and `decodePercent`'s named returns only, and the controls run below ran the framework tests on it).
- `bash docs/ui-next/status/T5-frameworks/mutations.sh.txt` whole, on `f7ae8a9bf` plus the two optional-set edits of this commit: 15 controls, both halves, exit 0.
- `~/gl215/golangci-lint run --new-from-rev=origin/main ./backend/pkg/terminal/...`: 0 issues (the first run found 4: gochecknoglobals, gocognit, 2 nonamedreturns; fixed).
- vitest `ui-next/shell/panel/terminal` with the main checkout's `node_modules` linked: 1532 tests pass, 19 test FILES fail to load (workspace packages not resolvable in this worktree: environment, not run to green). The page reads a mark's `cwd` as optional and `directoryOf` treats `''` as no directory (`execFeed.ts:205-212`), and the host only puts a cwd in a command when its trust is `nonce` (`channel_marks.go:129-145`), so a command with no cwd is the existing case.

## Not verified

- macOS, any other zsh, bash or fish version; real p10k, real z4h, real Zim, real starship, real oh-my-zsh (stand-ins and vendored single files only); bash-preexec on bash 4.x; bash 5.3.15 ran the framework tests and the existing integration tests (see the review round), not the whole existing bash suite under 5.2 AND 5.3 at once.
- The page: vitest of `ui-next/shell/panel/terminal` (see below).

## Review round (ReviewFrameworks)

1. bash 5.3 + bash-preexec (P1, true; the status said 5.3 where the machine's bash is 5.2.37). bash-preexec 0.7.0 uses PS0 on bash >= 5.3 (`bash-preexec.sh:465`) and leaves our DEBUG trap in place; the trap took `__bp_invoke_preexec_from_ps0` (history is still the previous line: the previous command's `633;E`) and the epilogue `__bp_interactive_mode` for the user's command: 4 records, wrong lines. Red `a1dd002c6` on 5.3.15 (3 commands, `fewer`/4 records), fix: the trap ignores `__bp_*` commands. Both bashes green; `TestBashPreexecOnBash53RecordsEveryCommandWithItsOwnLine` names the version and is NOT RUN, by name, when no 5.3 is in `OMNIVIEW_TEST_BASHES`. Control `bash-preexec-ps0-not-ignored`; the script now refuses to run without `OMNIVIEW_TEST_BASHES`.
2. A forged OSC 7 cleared the proved directory (P2, true). `forgetCwd(trusted)`: a unreadable OSC 7 clears the loose slot only; an unreadable 633;P clears both. Red test `TestAForgedOSC7WithAControlByteLeavesTheDirectoryTheShellProved`, control `forged-osc7-clears-proved-directory`.
3. zsh4humans' default prompt is p10k (`fn/-z4h-init-zle:713-717`): home `z4h-p10k-zsh` (z4h and p10k stand-ins, `P9K_VERSION` set): hooks skipped, both frameworks' C/D at low trust, no command line; runs in `TestAPowerlevel10kUser...` with p10k alone.
4. `standins/p10k.zsh` and `z4h.zsh` carry the MIT notice and source in their headers; the full texts are `standins/LICENSE.powerlevel10k` and `LICENSE.zsh4humans`.
5. DEL: kept as disclosed. A raw control byte inside an OSC (DEL too) is ignored by the scanner like a terminal does; `T5-scan.md` says so. Percent-encoded or escaped control bytes (including DEL) drop the mark.

## Round 3 (narrow `__bp_` match; fish 3.7)

- The trap ignores only bash-preexec's exact commands (`__bp_precmd_invoke_cmd "$_"`, `__bp_interactive_mode`, `__bp_install "$_"`, and by caller `__bp_invoke_preexec_from_ps0`, `__bp_load_this_command_from_history`); `TestAUsersCommandNamedLikeBashPreexecsIsStillRecorded` (user `__bp_mine`, `__bp_mine; echo x`; both bashes; red `__bp_*` broad match on 5.2, control `bash-preexec-match-too-broad`).
- fish 3.7 (CI image, Ubuntu noble `fish_3.7.0-1`, unpacked into `/tmp/fish37`, same overlay trick): fish 3.7 prints no marks of its own, so our `fish_postexec` prints the end mark; it did `test $__omniview_native = 0; or return` BEFORE reading `$status`, and `test` sets `$status` to 0: every end mark said 0 (`false` = trusted line, exit 0). Fix: `set -l __omniview_last $status` first. fish 4 prints its own D, so it never showed. Red `TestFishGivesTheRightExitCodesOnEveryVersionUnderTest` on 3.7 (`[0 0 0]`), control `fish-status-read-after-test`.
- fish versions are chosen with `OMNIVIEW_TEST_FISHES` (colon list), named `fish-<version>`, NOT RUN when absent; ONE fish per run (each needs its share directory overlaid): run once per fish with `/tmp/fishdl/run.sh` (4.0.2) and `/tmp/fish37/run.sh` (3.7.0). The own-marks test is NOT RUN on fish < 4 by name; the ESC-directory control reads the raw bytes so it also works on 3.x.
- Results: `go test -race ./backend/pkg/terminal/...` ok under fish 4.0.2 (273 s) and fish 3.7.0 (272 s), both with `OMNIVIEW_TEST_BASHES` = 5.2.37:5.3.15; lint 0 issues; the controls script whole under fish 3.7 (`OMNIVIEW_TEST_FISHES` = 3.7) exited 1 once on three controls whose optional sets were incomplete; fixed and those three rerun green (not rerun whole after).
