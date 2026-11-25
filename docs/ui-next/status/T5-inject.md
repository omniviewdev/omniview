# Status: T5-inject (shell integration for zsh and fish, issue #694 step 2)

- Agent: ShellInjection. Goal: the host starts the user's local zsh or fish so that the shell prints OSC 133, OSC 7 and the 633;E and 633;P marks with a per-session nonce, through the shell's own startup mechanism, never editing a user file, never typing into the pty; the create answer says it with a typed `integration` fact; the user can turn it off. Not wired into the output path (step 4), no page (`ui-next/` untouched), no bash or pwsh (step 3).
- Worktree: `~/omniview/wt/t5-inject`. Branch: `feat/terminal-shell-integration-zsh-fish` on `origin/main` `c310b52b`. Epic #692, issue #694. Step 1 is `backend/pkg/terminal/marks` (#709, `T5-scan.md`).
- Owned: `backend/pkg/terminal/**` except `marks/` (`integration.go`, `integration_types.go`, `integration_scripts/`, the launch of `manager.go`), `internal/settings/terminal.go`, this file and `T5-inject/mutations.sh.txt`. One line outside the list: `backend/pkg/plugin/exec/terminal.go` hands the setting to the manager (`startTerminals`), because nothing else in the host holds both.

## Decisions (to repeat in the pull request)

- **The nonce stays in the host.** It is `marks.Nonce` (crypto/rand, 128 bits) in the unexported field `session.nonce`; the step 4 scanner reads it with `Reveal`. It is not in `Session`, so it is in no answer, list, event, log or error; the page never needs it. The fact is `Integration{State, Reason}` and nothing else.
- **The nonce does not travel in the environment.** The host writes two lines onto a socket pair (`AF_UNIX`, `SOCK_STREAM`, close-on-exec on both ends) before it starts the shell, and gives the shell the other end as file descriptor 3 (`cmd.ExtraFiles`). Line 1 is the nonce. Line 2 is the user's value of the variable the injection replaces (`s:<value>` or `u:`: `ZDOTDIR` for zsh, `XDG_DATA_DIRS` for fish). The script reads both into shell variables that are not exported and closes the descriptor. So no child of the shell has the nonce in its environment, `/proc/<pid>/environ` of the shell does not show it, and a shell started inside finds no descriptor, no nonce and so no integration. The issue says "read then unset": this is stronger (nothing to unset). zsh moves the descriptor above 9 (zsh closes those on exec) and closes 3 at once. fish cannot close a descriptor: it reads the lines with `head` (fish's own `read` does not read a socket) and keeps descriptor 3, whose other end the host has closed, so there is nothing left to read from it; that is the one residue and is stated here.
- **The shell tells the host it is up.** The script writes `ready` to the socket: at the end of `.zlogin` (zsh) and at the first prompt (fish). `Start` waits for the first of: `ready` (the fact is `on`), the end of the shell (the shell is started once more without the integration and the fact is `failed{exited-early}`), 500 ms (the shell is slow or the script never ran: `unconfirmed{no-ready}`). The wait costs the answer of the create the time the shell takes to start, 500 ms at most, and only when the integration is on.
- **The directory is removed as early as it can be.** At `ready` (every startup file has been read), at the end of the early-exit path, and when the session ends (`finish`: a close, a crash of the shell, a shutdown of the host). `os.MkdirTemp` makes it `0700` with a name nobody else can have made; the scripts are `0600` inside.
- **The fact.** `integration: {state, reason?}`; `state` is `on`, `off` (the setting), `skipped` or `failed`; `reason` is a token and never text (so no path or message of the user's reaches an answer). Skipped: `command` (`-c`, `--command`, a short option group with `c`), `arguments` (any argument that is not `-i -l --login --interactive`), `posix`, `powerlevel10k` (`P9K_VERSION` in the launch environment), `multiplexer` (`TMUX` or `STY` in the launch environment, or a `TERM` of screen or tmux), `unsupported-shell` (bash and pwsh until step 3, and every other shell). Unconfirmed: `no-ready`. Failed: `setup` (the host could not make the directory, the channel or the nonce: the shell starts without it) and `exited-early`.
- **The relaunch happens once** (the loop is `spawnIntegrated`: one second `spawn`, with no injection, whatever happens to it). A shell that ends within 500 ms without the integration is nobody's relaunch.
- **The setting** is `terminal.shellIntegration`, a `Toggle`, default on, read for every terminal (`controller.shellIntegrationOn`); with no settings provider it stays on, and with an unreadable value the integration is skipped (`setting-unreadable`). It applies to the terminals opened after the change.
- **One shell start.** The arguments (`-i -l`) and the launch environment of `T1-go.md` 2.8 are untouched; the injection adds one variable (`ZDOTDIR` or `XDG_DATA_DIRS`) that the script gives back, and one descriptor. `TestTheShellStartsFromTheLaunchEnvironmentSoTheUsersPathOrderSurvives` stays green; `TestTheIntegrationKeepsTheUsersPathOrderOnTheLaunchEnvironment` is the same with the integration on, zsh and fish.
- The shell reaper now runs from the start of the shell (`process.reaped`), so that the start can see an early end; `wait` reads its result.

## What the scripts do

Embedded from `backend/pkg/terminal/integration_scripts/` (`embed`); each has a provenance comment (written from the protocols and the shells' manuals; VS Code and Wave were read as references for the idea of a ZDOTDIR shim only; no copyleft script was read for them).

- zsh: `ZDOTDIR` is the shim directory. `.zshenv`, `.zprofile`, `.zshrc` and `.zlogin` of the shim each give ZDOTDIR back to the user's value (the launch one, or the one the user's own `.zshenv` set), source the user's namesake at the top level (so a `typeset` is global, as it is in the user's own file), then point ZDOTDIR at the shim for the next file; `.zlogin` leaves the user's value (or none) and installs the hooks. A history file that a system file put in the shim is moved to the user's. The hooks: `precmd` first (prints `D;<status>`, keeps `$?`), `preexec` (prints `633;E;<escaped line>;<nonce>` then `133;C`), `precmd` last (prints `7`, `633;P;Cwd=...;<nonce>`, and puts `133;A` and `133;B` into `PS1`, where the prompt is drawn). Nothing is printed outside an OSC sequence.
- fish: `vendor_conf.d/omniview-integration.fish` under a directory put in front of `XDG_DATA_DIRS`, which it gives back at once. **fish 4 prints OSC 133 A, C and D and OSC 7 itself** (seen in 4.0.2) and prints C before the handlers of `fish_preexec` run, too late for a command line that the nonce vouches for, which has to come before C (a line that comes while a command runs is dropped by the scanner). So with fish 4 the script adds what fish does not: `633;E` (from a binding of Enter and of Ctrl-J, installed at the first prompt only when the user has no binding of their own for the key), `633;P` and `133;B` (the prompt is wrapped); with an older fish it prints every mark from `fish_preexec`, `fish_postexec` and `fish_prompt`. The older path is not run here (no fish below 4 on this machine).

## Review round (ReviewInjection on `84d0c43c`)

Tests first (`22395b2446`, red by assertion), then the fixes (`129f0876ca`).

1. fish `__omniview_escape` dropped newlines (`for i in 1 2⏎echo $i⏎end` was recorded trusted as `for i in 1 2echo $iend`). Now one string, every control byte (a newline too) as `\xHH`, as in zsh. `TestAMultiLineCommandIsRecordedWithItsNewlinesAndNotWithoutThem`, both shells (zsh uses `do`/`done`: zsh's `for` takes a short body, so `end` is a command of its own there).
2. Enter. The tests now send CR, as xterm does (they sent LF, which is Ctrl-J). A user's own `bind \r` wins (no `633;E`, by design): `TestAFishUserWhoBoundEnterKeepsTheirBindingAndTheCommandHasNoTrustedLine`. Decision, abbreviations: the trusted line is the EXPANDED text, what ran, as `fish_preexec` gives it (and so VS Code's script); the Enter binding is `expand-abbr` then the host's function: `TestAFishAbbreviationIsRecordedExpandedAsWhatRan`.
3. Escape cost, a direct call, 3900 bytes of which 2600 are bytes to escape (the worst case of the loop): the per-character version took 14329 ms; the per-value version takes about 130 ms (126 to 142 ms over runs). Bound in the test: 400 ms. The common case (no control byte, a pre-check) is a few `string` calls.
4. The fact says `on` only after `ready`. No `ready` within 500 ms is `unconfirmed{no-ready}` (the script may still run, or never: `setopt norcs` in `.zshenv` stops zsh before the shim's `.zshrc`, tested with a real zsh). The nonce and the directory are kept until the session ends in that case.
5. zsh hooks turn `xtrace` off before they touch the nonce (`TestZshXtraceNeverPrintsTheNonce`). `$?` is read first in the two `precmd` hooks: a `setopt` before it had made every status 0 (seen by the tests).
6. A settings provider error is not a yes: `skipped{setting-unreadable}`, the shell untouched (`TestASettingThatCannotBeReadFailsClosed`, and in the exec package `TestAShellIntegrationSettingThatCannotBeReadSkipsTheIntegration`). `SetIntegration` takes `func() (bool, error)`.
7. Recorded, no code:
   - fish children inherit descriptor 3 (fish cannot close it). After `ready` the host's end is closed, so it is inert: nothing to read, nothing to write to.
   - A relaunch (the shell ended within 500 ms) runs the user's login files twice: once in the shell that ended and once in the one that stays.
   - With the integration, zsh does not show `zsh-newuser-install` (the user's directory is the shim's for `.zshenv`, and the shim's files exist): a user with no `.zshrc` does not see the first-run menu.
   - The wait of `Start` (measured on this machine): zsh 13 ms and fish 71 ms with a plain rc, 502 ms for an rc that takes 0.7 s (the wait ends at 500 ms; the fact is `unconfirmed`).

## Log

- 2026-11-25 `1495a8dd8e` (red): the tests against a stub (the field, `SetIntegration` and the types exist and do nothing). Every test of the integration fails by its own assertion (`expected: Integration{State:"on"} actual: Integration{State:""}`, `the shell was started twice: []`, `the command line "" carries the nonce`, `no directory ... Condition never satisfied`); the three that pass on a stub by nature (`...PrintsNothingOnTheTerminalOutsideItsMarks`, the crash-by-itself subtest, ...) carry a check that a stub cannot satisfy.
- 2026-11-25 `52653ada5c` (green): the integration, the scripts, the setting and its wiring.

## Negative controls (AGENTS 28)

`docs/ui-next/status/T5-inject/mutations.sh.txt`, run from the worktree (`bash docs/ui-next/status/T5-inject/mutations.sh.txt [name]`). Each fault is in a scratch copy of one file (Go or an embedded script) under `go test -overlay`; the worktree is never edited. Half 1: the tests that go red are exactly the ones named. Half 2: with those skipped, the same fault passes.

| Control (the fault) | Red in (half 1) | Without them (half 2) |
|---|---|---|
| nonce-exported (the nonce is also put in the shell's environment (`OMNIVIEW_NONCE`)) | `TestTheNonceIsInNoVariableOfTheShellAndNoChildGetsIt` | pass |
| user-file-edited (the `.zlogin` shim appends a line to the user's `.zshrc`) | `TestAZDOTDIRTheUserSetIsHonouredAndRestored`, `TestTheUsersStartupFilesAreByteIdenticalAfterASession` | pass |
| script-prints-outside-its-marks (the `.zlogin` shim prints text on the tty outside a mark) | `TestTheIntegrationPrintsNothingOnTheTerminalOutsideItsMarks` | pass |
| relaunch-loop (a shell that ends early is started again with the integration, up to 5 times) | `TestAShellThatAlwaysDiesIsStartedTwiceAndNoMore`, `TestAShellThatDiesAtOnceWithTheIntegrationIsStartedOnceMoreWithoutIt` | pass |
| temp-dir-left-behind (`injection.close` does not remove the directory) | `TestAShellThatAlwaysDiesIsStartedTwiceAndNoMore`, `TestAShellThatDiesAtOnceWithTheIntegrationIsStartedOnceMoreWithoutIt`, `TestTheIntegrationDirectoryIsRemovedOnEveryEnd`, `TestTwoHundredStartsAndKillsLeaveNoDirectoryNoProcessAndNoDescriptor` | pass |
| integration-with-the-setting-off (the setting is ignored (`integrationPlan` never says off)) | `TestAShellThatDiesAtOnceWithoutTheIntegrationIsNotStartedAgain`, `TestTheFactSaysWhyTheIntegrationIsOffOrSkipped`, `TestTheSettingIsAskedForEveryTerminal`, `TestWithTheSettingOffARealShellStartsWithNothingOfTheIntegration` | pass |
| dir-world-readable (the directory is made `0755`) | `TestTheIntegrationDirectoryIsOwnerOnlyAndOwnedByTheUser` | pass |
| zdotdir-not-given-back (the `.zlogin` shim leaves ZDOTDIR at the shim) | `TestANestedLoginShellDoesNotInheritTheIntegration`, `TestAZDOTDIRTheUserSetIsHonouredAndRestored`, `TestTheIntegrationPrintsNothingOnTheTerminalOutsideItsMarks`, `TestTheNonceIsInNoVariableOfTheShellAndNoChildGetsIt` | pass |
| channel-left-open (the `.zshenv` shim does not close descriptor 3) | `TestNoDescriptorOfTheChannelReachesAProgramOfTheUser` | pass |
| command-flag-not-skipped (`-c` is not a reason to skip) | `TestTheFactSaysWhyTheIntegrationIsOffOrSkipped` | pass |
| powerlevel10k-not-skipped (`P9K_VERSION` is not a reason to skip) | `TestTheFactSaysWhyTheIntegrationIsOffOrSkipped` | pass |

All 11, both halves, on `52653ada5c`.

## Verification

Linux amd64, Go 1.27.4 (`PATH=$HOME/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.4.linux-amd64/bin:$PATH GOWORK=off GOTOOLCHAIN=local`). zsh 5.9 is the machine's. fish 4.0.2 is not: it is the Debian package unpacked into a scratch directory with its asset files made visible at `/usr/share/fish` by an overlay mount in a user namespace (`unshare -Urm`), which is how every fish test here ran.

- Tests: `go test -race -count=3` on the integration tests and the PATH-order test (`./backend/pkg/terminal/`): green, 28 s. The whole `./backend/pkg/terminal/` once: green, 160 s (`TestAShellThatIsNotInstalledFallsBack...` passed on this run). `go test -race ./internal/shellenv/ ./internal/settings/`: green. `./backend/pkg/plugin/exec/` `-race -count=3 -run ShellIntegration`: green. `./internal/auditgate/...`: green (no binding method was added or changed: the pins are untouched).
- Bindings: `task bindings` regenerated `packages/omniviewdev-runtime/src/bindings/.../terminal/{models,index}.ts` (the new `Integration`, `IntegrationState`, `IntegrationReason` and the `integration` field of `Session`); committed. `ui-next/` was not touched: its fixtures build the session as `Record<string, unknown>`.
- `go vet`: linux, windows (`./backend/pkg/terminal/... ./internal/... ./backend/pkg/plugin/exec/`), darwin (`./backend/pkg/terminal/ ./internal/shellenv/ ./internal/settings/`; the exec package does not vet for darwin on this machine: the wails cgo guard).
- The 200 start-and-kill cycles (8 at a time, a real zsh and a real fish): 0 temporary directories, 0 processes, descriptors within 2 of the baseline.
- golangci-lint v2.15.0, the CI form of `N24-L2.md`: 0 issues on the diff (v2.15.0 built with go1.27.4, `--new-from-patch` of `origin/main...HEAD`); the first run found six (gci, exhaustruct, nonamedreturns, revive, testifylint x2), fixed.
- The shell of the issue's Proof, as tested: marks with the nonce around `echo`, `false` and a line with `;` and `\`; sha256 of `.zshenv .zprofile .zshrc .zlogin` and `config.fish` equal and no new file in a zsh home; ZDOTDIR from the launch environment and from the user's own `.zshenv`; the nonce in no exported variable (`env`, `printenv`, `typeset -x` or `set -x`, `/proc/<pid>/environ`), in no log record, answer, list, `Sprintf` of the session or end; a nested `-i -l` shell with none of the integration's functions and, for zsh, ZDOTDIR unset again; the stream with its marks taken out equal to the stream with the setting off (zsh byte for byte, fish by what it shows: its repaint of the line differs once Enter is bound).

## Not verified

- macOS: no run at all (`GOOS=darwin` vet only). In particular `/etc/zshrc` and `path_helper` of macOS, `unix.Socketpair` and `ForkLock` on darwin, and fish from Homebrew.
- Real prompt frameworks: powerlevel10k (skipped by `P9K_VERSION`, which is only seen when it is in the launch environment: p10k sets it as a shell variable, so the script also leaves the hooks out when `${+P9K_VERSION}` is set at the end of `.zlogin`, and that is not tested), oh-my-zsh, starship, zim, z4h. The user's files of the tests are four lines each.
- fish below 4 (the path that prints every mark); fish's vi key bindings with the Enter binding; a fish where the user bound Enter (no `633;E`, by design).
- zsh below 5.9; bash and pwsh (step 3).
- The 500 ms wait is not timed on a slow startup file (the fake shell that never answers shows `unconfirmed` after the wait).
- The scanner of step 1 reads what the shells print in the tests, but it is not wired: no event, no page.
