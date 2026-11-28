# Status: T5-step7-seam (the seam scenario r10, the shell integration, issue #694 step 7)

- Agent: IntegrationSeam. Worktree `~/omniview/wt/t694-seam`. Branch `test/terminal-integration-seam`, on `origin/test/terminal-open-where-seam` (PR #802, r9; rebase onto `origin/main` once it lands). Epic #692, issue #694. No push, no PR.
- Owned: `ui-next/plugins/e2e/seam.check.mjs` (scenario r10, `checkTerminalIntegration`, phase and control group `terminal-integration`, `INTEGRATION_CONTROLS`), `scripts/ci/seam-units.mjs`, `scripts/ci/seam-shards.mjs` (one table name) and its test. No product file. No probe change: every claim of the step is reachable by the seam (a probe has no real shell), so none was added.

## What r10 proves

Real host, real bash 5.3 and zsh 5.9 of this machine (the check STOPS with a message when the host lists either one missing: the CI image now holds both, #798), both engines, a real xterm in the page. For each shell, in a terminal the page made from the menu of the `+`:

| Acceptance line of #694 step 7 | What the check does | Controls |
|---|---|---|
| exit codes, gutter | `true`, `false`, `(exit 3)`: the typed marks the host sent (`command-start` with its nonce-proven line, `command-end` with `exit`) and the host's record (`ChannelTerminalCommands`) say 0, 1, 3. A command whose end mark carries no status (what pwsh sends; a program prints `OSC 133;D`) has no `exit`. The gutter (the page's decorations, `[data-state]`, in view, top to bottom) is success, error, error, incomplete. | `integration-exit-true`, `-false`, `-three`, `integration-gutter-success`, `-error`, `-incomplete` |
| Ctrl-C at an empty prompt | A window of the output of its own holds a prompt and an input start, no `command-start`, no `command-end`, no command that ran in the record. | `integration-ctrlc-none` |
| a jump moves the viewport | After 100 lines of output no mark is in view; the terminal's chord (Control or Command + Up) says `Command N of N, Succeeded...: seq 1 100` in its live region and the one mark in view is that command's. | `integration-jump` |
| Select output | The chord with Shift selects the output of the command before; the copy equals `SEL_1..SEL_4`, and equals the lines the host's record cuts out of the output bytes (`output_start`, `output_end`; zsh's `%` redraw trimmed). | `integration-select-output` |
| forged marks | `cat` of a file with 133, 633;E, 633;P and OSC 7 marks, wrong nonce and none: no mark carries a command line or a directory other than the shell's, and the record has no such command. With the nonce (read by the check from `$__omniview_nonce` into a file only the check reads): the line `FORGED_RIGHT` is `trust: nonce` in the marks and the record, and the directory `/usr` is a `nonce` cwd mark. | `integration-forged-line`, `-forged-cwd`, `-trusted-line`, `-trusted-cwd` |
| user files | `~/.zshrc`, `~/.zprofile`, `~/.bashrc`, `~/.bash_profile` of the seam host's HOME are seeded with content the shells run (the check asserts both shells ran them), hashed (sha256) before the first terminal and after both sessions. | `integration-file-zshrc`, `-zprofile`, `-bashrc`, `-bash-profile` |
| opt-out | `terminal.shellIntegration` false through the host's settings (`Commit`), then a new terminal from the menu: the record and the stream's `ready` say `off`; the shell has no `__omniview*` function or parameter and no nonce variable, the environment none of `OMNIVIEW_*`, `__omniview*`, `ZDOTDIR=...omniview-integration`; no typed mark, no 133/633/7 in the output, no command in the record. The setting is put back (also on failure). | `integration-optout-fact`, `-optout-env`, `-optout-marks` |
| reload | The page reloads (as r3); the gutter in view is as it was. | `integration-reload-gutter` |
| canary | The session's nonce is in no DOM node (`outerHTML` and text), no host log line (the host's output and its state root's log files), no frame the page receives that is not an output frame (marks, `ready`, events socket), no record or answer of the host (`ChannelTerminalCommands`, `Busy`, `Cwd`, the list, every answer the page was given), no page error or console line. The nonce IS in the raw output (asserted: the search looked for something that exists). | `integration-canary-dom`, `-log`, `-frames`, `-records`, `-errors` |

26 controls; 22 run in each shell (44) and the 4 file controls once: 48 `NEGATIVE CONTROL ... detected` lines per engine.

## Decisions

- **A forged end mark is how "incomplete" is made.** The bash and zsh scripts always send a status, so the incomplete state (no status, pwsh's) cannot come from them. A program prints `OSC 133;D` with no code (`printf '\033]133;D\007'`); the host's end mark has no `exit`, the gutter shows incomplete. It is a program's forged mark, honest as the state "ended with no status", not a real pwsh.
- **A trusted command line needs a start at a prompt.** The host takes `633;E` only for the start of a command at a prompt (`log.start`: "a second start is not the shell's"). A forged file printed inside `cat` first fails: the real `cat` is the running command. So both files first print `133;D;0` (end the shell's command) then A, B, E, C. The right-nonce file is then trusted; the wrong-nonce and no-nonce start marks carry no line. This is the host's rule, written into the check, not a product change.
- **Faults point the assertion at real data of the opposite event**, not at doctored values: the forged assertions are tried against the window of the right-nonce file (`forgedW = lineW`, `cwdW`), Ctrl-C against the window of `true`, the opt-out ones against the terminal that has the integration, a glyph's `data-state` swapped for the gutter and the reload, a nonce planted in a sink for the canary, the user's file appended for the files. The assertions with a single act and no fault of their own are premises (tried before the act): exit codes, jump, Select output, the two trusted ones.
- Windows of the output are offsets (`mark.at`), so they hold across the reload (marks come again with the replay and are counted once).
- The wait for the next prompt is the next `input-start` mark after the typed line, never a time. The first CI of webkit showed the jump's mark drawn a frame after the live words: the act waits for the mark in view.
- Fish: not installed here (`command -v fish` empty), so no fish pass and no `config.fish` control (a control that cannot run on a machine fails the plan's check that every control was detected). NOT RUN. Add it when the CI image's fish is exercised.
- The seam host's HOME is `<work>/home`; the check finds it from `host.logFile` and restores or removes the files it seeded in `finally`.
- `scripts/ci/seam-shards.test.mjs` hard-coded 4 shards; the table's seconds now plan 5 (1646 s), so the numbers (8 reports, `--shards 4`) are 10 and 5. The unit seconds are ESTIMATES (40 s phase, 70 s controls) from the laptop.

## Shas

See `git log` of the branch: the scenario, units and shard tables are one commit (`test(seam): r10 ...`), the waits that the first WebKit run needed are the next, this file the last.

## Checks run

Linux amd64, Go 1.27.4 toolchain, Node 26, bash 5.3.0, zsh 5.9. Load average 1 to 6 (`uptime`).

- `task local:seam -- terminal-integration,controls-terminal-integration` (env -i, `SEAM_SHELL=/bin/bash`): after the wait fix exit 0; phase 24.1 s (WebKit) and 25.5 s (Chromium); 48 of 48 controls detected in each engine, bash and zsh both exercised.
  Before the fix the first run failed in WebKit only: `a jump moves the viewport to the previous command's line: it says "Command 7 of 7, ..." and the marks in view are []` (the page drew the mark a frame after it said where it went); Chromium 48 of 48.
- Controls with their assertion removed (`SEAM_CONTROL=<c> SEAM_REMOVE=<c>`, all 26, both engines, 52 runs, 3 at a time): every run exit 0 and printed `NOT DETECTED ... with its assertion removed, as it must be` once for each of its shell passes (2 for the 22 per-shell controls, 1 for the 4 file controls); none was detected.
- `node scripts/ci/seam-shards.mjs check`: ok (31 phases, 255 controls, 25 units). `node --test scripts/ci/seam-shards.test.mjs`: 35 of 35.

## Not verified

- macOS, Windows, a real WKWebView; fish; pwsh.
- The CI image run (zsh and fish there since #798): the nightly sets the seconds.
- `SEAM_REMOVE` passes by construction for a control whose act has one assertion (nothing else sees the fault); r9 says the same.
- The `SEAM_CONTROL` run in CI is the one table (`terminal-integration`).

## Dev tools

- `SEAM_TERMINAL_ONLY=r10`, `SEAM_PHASES=terminal-integration`, `SEAM_CONTROL=terminal-integration|<control>`, `SEAM_REMOVE=<control>`.

## Backend catalog

- Nothing for the host or the SDK. A product observation, not a bug: a program that prints the right nonce can make a command line trusted only at a prompt (see the decision above); `cwd` from `633;P` with the nonce is trusted anywhere, by design.

## Review round (ReviewIntegrationSeam, FIX FIRST on `ed3ba3ba3`): what changed

- **Canary after the end (blocker).** After `endTerminals` the nonces of every session (zsh, bash, fish) are searched in the host's log (`host.output()`), in every file of the state root of any type (not only .log/.txt/.json), and in every file written to the temporary directory since the check began (depth 3, any type, at most 20 MB each). Controls: `integration-canary-end-log` (a log line at the end), `-end-state` (a `terminal-planted.state` in the state root), `-end-tmp` (a file in TMPDIR). The in-session canary is unchanged. The files the check itself writes with the nonce (the forged and signed files) are deleted when their section ends.
- **Jump (blocker).** `integration-jump-top`: the one command mark in view must be on row 0 of the emulator's screen (the mark's own placement, from the DOM geometry of the emulator's decoration, 18 px rows), not the announced words. The fault scrolls the view up by wheel until the mark is on row 3 (detected: `it is on row 3`). `integration-jump` keeps the words and the one success mark; its fault rewrites the live region's text.
- **Flaky premise.** Before "no command line in view" the check waits until the emulator has drawn line `100` of `seq 1 100` (the buffer copied as a person does, polled), then asserts. The act waits for the mark of the jumped-to command to be drawn, not for a row.
- **Mark inside a running command.** `integration-forged-midcommand`: a file with the RIGHT nonce (`633;E;MID_RIGHT`, `133;C`) and no `133;D` first, printed by a running `cat`: no trusted line in the marks or the record. Fault: the window of the file the nonce signed at a prompt. Rule written into `terminal-channel-protocol.md` 4a. Scratch product with the rule removed (`marks/log.go` `setLine`, `case r.State != StateRunning:` replaced by `case true:`, built with `go build -overlay` to `/tmp/t694-mut`, swapped into `bin/` for one run and restored): r10 goes red with `a mark with the session's nonce printed inside a running command gives no trusted command line ... the record ["MID_RIGHT"]`.
- **fish.** When the host lists fish, r10 runs the whole scenario in it and seeds `~/.config/fish/config.fish` (hashed, control `integration-file-config-fish`). A host that does not list fish prints `NEGATIVE CONTROL "integration-file-config-fish": NOT RUN in <engine>: fish is not listed on this machine` and the scenario's note says the fish pass is NOT RUN; the plan's report counts only `detected` lines, so a machine with fish (the CI image) is the one that detects it and a machine without it cannot pass that unit silently in CI. The shells differ in a few typed lines (`SHELL_USES`: `sh -c 'exit 3'` for fish; the variables each shell's own files set; a fish form of the line that counts the integration's variables). What fish needed that bash and zsh did not: its output starts a line with a bare `\r` (the check's `INTEG_DONE`/`INTEG_RC` patterns no longer rely on a line feed before them: the typed echo is made unmatchable instead); it prints nothing at all for Ctrl-C at an empty prompt (an empty Enter makes it draw the prompt that is waited for; the window still holds no `command-start`/`command-end`); it prints `ESC ( B` (stripped in the lines of the output copy); fish 4 prints OSC 133 and OSC 7 itself, so with the integration off the check asks that fish prints no `633` (the integration's) rather than no mark at all.
- Local fish: fish 4.0.2 from `/tmp/fishdl` (T5-frameworks method), an overlay mount of `/usr/share` and of `/usr/bin` in a user namespace (`/tmp/fishdl/run2.sh`, because the host lists shells from `/bin`, `/usr/bin`, ...). In that namespace the user is root, so zsh's prompt character is `#`: the output lines trim `%` and `#`.

### Results of the review round (2026-11-27, load average 12 to 15)

- `task local:seam -- terminal-integration,controls-terminal-integration --no-build`, run inside the fish overlay (`/tmp/fishdl/run2.sh`, so zsh, bash and fish are all listed), exit 0: phase 56 s (WebKit) and 51 s (Chromium); controls 80 of 80 detected in each engine (24 per shell x 3, the 3 end-of-session canary controls, the 5 file controls). Earlier runs of this round failed on flakes that are fixed: the jump's undo (WebKit and Chromium: the view is taken back to the bottom and the jump made again) and a glyph fault the emulator repainted away (an observer of the screen holds the faulted state).
- Without fish (this machine's own bash and zsh): phase passes, `integration-file-config-fish` prints NOT RUN and the note says the fish pass is NOT RUN.
- `SEAM_REMOVE` for `integration-jump`, `-jump-top`, `-forged-midcommand`, the three `-canary-end-*` and `-file-config-fish`, both engines (14 runs): every one `NOT DETECTED ... with its assertion removed`.
- Scratch product with the at-a-prompt rule removed: red by `integration-forged-midcommand`'s words.
- Seam units: phase 80 s and controls 150 s, ESTIMATES. `seam-shards.mjs check` ok (31 phases, 261 controls, 25 units); `seam-shards.test.mjs` 35 of 35; eslint on `ui-next/plugins/e2e` and `scripts/ci` exit 0.
- The nonce search of the temporary directory reads files written since the check began, to depth 3, at most 20 MB each (39 files in these runs); a file written deeper or larger is not read.
