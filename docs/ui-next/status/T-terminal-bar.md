# T-terminal-bar: what an IDE terminal does, what ours does, and the slices that close the gap

Status: written during T1 (PR #660) as the plan the lead dispatches from; T2a (`T2a.md`) and T2b (`T2b.md`) have since built the rows marked T2a and T2b. Everything else here is still a plan.

The owner's ruling (2026-11-22): "for the terminal you don't need to follow the mock exactly but it needs to be an exceptional functional terminal that does what you would expect in an ide". So the bar is the integrated terminal of VS Code and of JetBrains IDEs. The mock still guides the placement, the tokens and the words of the chrome (toolbar, lane, empty state); it does not limit what the terminal does.

Sources, read on 2026-11-22: VS Code, Terminal Basics (https://code.visualstudio.com/docs/terminal/basics), Terminal Shell Integration (.../shell-integration), Terminal Appearance (.../appearance), Terminal Advanced (.../advanced), Terminal Profiles (.../profiles); JetBrains, Terminal (https://www.jetbrains.com/help/idea/terminal-emulator.html) and its settings page (https://www.jetbrains.com/help/idea/settings-tools-terminal.html). A cell says "VS Code" or "JB" for the product that documents the behaviour; "both" where they agree, which is where the repository's rule says to follow them.

## How to read the table

- **Have**: built in T1 and covered by a named check (seam scenario `r`, block `r2`, on the real host: the programs of the machine, not a stand-in), or built into the emulator and shown by the probe.
- **Missing**: the host can build it with what it has today (a UI step).
- **Backend**: the feature needs a fact or an option the host's terminal service does not give today. The cause is on the Go side (`backend/pkg/terminal/**`, the exec controller) and is listed once under "What the backend must give", with the file and line. The UI never guesses what the shell knows.
- **Slice**: the slice that closes it (T2 to T6 below).

## The table

### The emulator (what a program sees)

| Feature | What the products do | Ours | Slice |
|---|---|---|---|
| Alternate screen programs (vim, less, top) | both: full-screen programs take the screen and give it back, with the prompt, the output and the scrollback intact | Have (seam `r2`: less, vim and top; the prior output and 80 lines of scrollback came back) | T1 |
| Resize while a program holds the screen | both: the program is told (SIGWINCH) the new size | Have (seam `r2`: a script in the alternate screen printed the new `stty size` after the panel grew) | T1 |
| 24-bit colour | both; VS Code sets `COLORTERM=truecolor` | Have in the emulator (seam `r2`: `rgb(255,100,0)` drawn as itself); **Backend**: the host does not set `COLORTERM` | T4 (env), T1 |
| Wide characters, emoji, combining marks | VS Code: `terminal.integrated.unicodeVersion` 6 or 11, "should match the Unicode version used by the shell/OS"; JB: the reworked engine is based on libghostty | Have: Unicode 11 widths (the `@xterm/addon-unicode11` dependency, added in #660). Seam `r2` compares the cursor column the emulator reports (CSI 6n) with what the shell counts | T1 |
| Bracketed paste | both: a pasted block reaches the shell as one piece and is not run line by line | Have (seam `r2`: a program that asked got the wrapped paste; the shell prompt kept two pasted lines without running them) | T1 |
| Mouse reporting | both: on while a program asks (a click moves vim's cursor), off otherwise so selection works; VS Code: Option forces selection on macOS (`macOptionClickForcesSelection`) | Have (seam `r2`: a click was reported at its cell; vim moved its cursor to the clicked line). Missing: the forced selection | T1, T6 |
| Bell | VS Code: `enableBell`, a visual mark next to the terminal's name, `bellDuration`; no sound | Have: the screen fades once (no sound, none under reduced motion). Missing: the mark on the tab, and a setting | T2, T6 |
| Title from the program (OSC 0 and 2) | VS Code: the tab title variables `${sequence}`, `${process}`, `${cwd}`; JB: the tab follows the shell | Missing: tabs say "Terminal" | T2 |
| Hyperlinks (OSC 8) | VS Code: terminal links | Missing | T3 |
| Reflow on resize | both | Emulator's own (xterm reflows wrapped lines); not asserted by a named check | T6 (add the check) |
| Images (Sixel, iTerm) | VS Code: off by default | Not planned | none |

### Keys

| Feature | What the products do | Ours | Slice |
|---|---|---|---|
| Copy and paste | both: Cmd C/V on a Mac; Ctrl Shift C/V on Linux; Windows: Ctrl C copies while there is a selection | Have (seam `r2`: a double click selected a word and the chord copied it; paste is the platform's paste event) | T1 |
| Select all | VS Code: Cmd A on a Mac, nothing on Windows and Linux ("Terminal: Select All"); GNOME Terminal and Windows Terminal: Ctrl Shift A | Have: Cmd A on a Mac, Ctrl Shift A elsewhere (seam `r2` reads the buffer with it) | T1 |
| Clear | both: **Cmd K on a Mac** (VS Code Advanced: "On macOS, Cmd+K is a common keyboard shortcuts in terminals to clear the screen so VS Code also respects that, which means Cmd+K chords will not work"; JB: "To clear the terminal screen, press ⌘ K") | Have: the terminal takes Cmd K while it has the focus, ahead of the palette (a deviation from S52/S66, see T1.md); the button is the other way. Windows and Linux: the button only, as VS Code has no default chord there | T1 |
| Word and line movement | VS Code (macOS defaults, `sendSequence`): Option Left/Right word, Cmd Left/Right line ends, Option/Cmd Backspace | Have (seam `r2` reads the bytes the shell received) | T1 |
| Option as Meta | VS Code: `macOptionIsMeta`, off by default | Off, so Option types characters; the setting is missing | T6 |
| Control chords belong to the shell; the window keeps the rest | VS Code: `commandsToSkipShell`, `sendKeybindingsToShell`, chords skip the shell | Have (S52: the terminal takes every Ctrl chord on macOS; F6 leaves; Escape never leaves) | T1 |
| Send a sequence from a key binding | VS Code: `workbench.action.terminal.sendSequence` | Missing | T6 |
| Scroll the buffer by key | VS Code: Cmd Home/End, Page Up/Down; Cmd Up/Down jumps by command | Shift Page Up/Down only (the emulator's); the jumps need shell integration | T3, T5 |
| Alt click moves the cursor | VS Code: `altClickMovesCursor` | Missing | T5 |

### Sessions

| Feature | What the products do | Ours | Slice |
|---|---|---|---|
| Several terminals, tabs | both | Have (the panel's session tabs) | T1 |
| Split panes | both (VS Code: Cmd \ ; JB: split right/down) | Missing; needs the panel to hold more than one body, which is the shell's | T6 |
| Terminal in the editor area | both (JB: open as editor tab, with a confirm before closing it while a command runs) | Missing; a shell decision | T6 |
| Rename | both (JB: rename tab) | Missing | T2 |
| Tab icon, colour, status | VS Code: icon, colour, status (bell, task) | Missing | T2 |
| Kill | both: JB "To terminate a running session, close the tab ... and confirm the process termination" | Have (T2a): the page asks the host `IsBusy` when a running terminal is closed. Idle closes with no question; busy asks and names the program; unknown, or no answer in 1.5 s, asks in general words. The answer is Cancel by default. Not covered: the host's `idle` means the shell itself holds the foreground and "background jobs do not count" (`T1-go.md` 2.3), so a stopped or background job is closed with no question | T1, T2a, T4 |
| Restart an ended terminal | Not in the pages read; listed because the mock offers Restart on an exited session (Enter) | Built (#695 step 5, `T4-restart.md`): the lane of an ended session offers Restart, Enter is its key, a new terminal with the same shell, directory and environment in the same tab, the transcript kept above it | T2 |
| Exit status of an ended shell | both show it | Have (T2a): the lane says "Exited with code 3", "Ended by SIGKILL" (with "core dumped" when the host says so) or who closed it, and the transcript ends with `[Process exited with code 3]`. Not covered: the status of each command (T5, OSC 133) | T2a, T5 |
| Reattach after a reload | VS Code: persistent sessions (`enablePersistentSessions`, reconnect after a reload) | Have (T2b, T2d): the window keeps a page key in a slot of its own, every terminal is made with it, and a reloaded window lists its terminals, gives each saved tab its terminal again and attaches: the replay is written into a new emulator with its replies muted and its size and modes applied, then the live output follows, byte for byte (an event is dropped by its offset), and the input goes on from the host's own count. The panel comes back as it was (open or closed, its tool and session: T2d). A terminal taken over by another tab, detached with its window or closed when its lease ran out says so, and once the tab that took it has gone the first tab offers "Take it back" (T2d). When the page's events connection drops and opens again, each RUNNING terminal that the page still holds and that has a key re-joins by offset, and a tab that lost its terminal re-checks with the host whether it is free (T2d). Not covered: the detach at `pagehide` in WebKit (the host retires the window about 3 s later instead) | T2b, T2d |
| Restore after quitting the app, scrollback kept | VS Code: revive, `persistentSessionScrollback`; JB: saves tab names, directories and shell history | Missing and **Backend** (nothing outlives the host's process) | T5 |

### Creating a terminal

| Feature | What the products do | Ours | Slice |
|---|---|---|---|
| Default shell detection | both (JB: predefined sessions for bash, zsh, fish, pwsh found in /bin, /usr/bin, /usr/local/bin, /opt/homebrew/bin) | Have, in this order: the first word of an explicit command (the Terminal tool sends none: T4); `$SHELL` when it names an installed shell; the account's shell (asked only when `SHELL` is empty); then `/bin/zsh`, `/bin/bash`, `/bin/sh` (Windows: `powershell.exe`). It starts as a login shell (`-i -l`; PowerShell `-Login -NoLogo`) (`shellenv.Default`, `shellenv.Resolve`). T2a: the tab is named after the shell the host started (the create answer's `shell.name`), and when none can be started the page shows the host's sentence with every path it tried (`SHELL_UNAVAILABLE`) | T1, T2a |
| Choose a shell or a profile | VS Code: profiles dropdown; JB: shell path setting and predefined sessions | Missing and **Backend**: the create call names no shell | T4 |
| Starting directory | VS Code: the workspace root; JB: the project root | Have: the home directory (right with no project open). Missing: a project or context directory, and "same directory as the terminal I am in" (that needs OSC 7) | T4, T5 |
| Environment | VS Code: `env`, extension contributions, a relaunch warning; JB: injects JAVA_HOME and PATH of the project SDK | **Backend**: the create call takes no environment; the child gets the host's own (including `OMNIVIEW_*`) with `SHELL` and `TERM` set | T4 |
| Login shell with the user's profile | both; the classic defect is a PATH without Homebrew when the app is launched from the Dock | Have: `-i -l` (seam `r2`: a login shell, every directory of /etc/paths on its PATH). Not covered: the packaged app launched from the Dock | T1 |
| Initial size | both start at the size of the view | Have: the page measures the screen before it asks, tells the feed no size until the GPU renderer is in place (its cells are the final ones), and the create call carries that size: the host starts the pty at it and answers with the size it used, and no resize follows (T2a, seam and probe) | T1, T2a |
| Run something in a terminal from another part (the pod exec button with a container picker, "Open in Terminal" from a file or folder, run selected text) | both | Missing: needs an API a plugin calls (additive to the plugin contract) and a create call that takes a command, a directory and an environment | T4 |

### Reading and acting on the output

| Feature | What the products do | Ours | Slice |
|---|---|---|---|
| Find in the scrollback | both: Cmd F, case, whole word, regex | Have (T3a): Cmd+F (Ctrl+F and Ctrl+Shift+F elsewhere) or the toolbar's Find opens a bar over the screen: case, whole word, regex (an invalid pattern says so and searches nothing), "k of N" / "No results" / "20,000+", Enter and Shift+Enter (F3 too) step, Escape closes it from the field and from the terminal; the search addon is a lazy chunk (0 bytes before the first find); it finds in the replayed scrollback after a reload. Not covered: the highlight limit counts from the oldest row (the newest matches are the ones left out past 20,000), Find in the alternate screen of a full-screen program is the addon's | T3a |
| Clickable links | VS Code: URLs, files with line and column (`file:1:2`), folders, words, "Open Detected Link"; JB: files and folders on Ctrl click | Have for URLs (T3a): http and https links in the output, tooltip "Follow link (cmd + click)" or "(ctrl + click)", the modifier click opens through the host's open-external call. Missing: files with a line and folders (they need a host route that opens a file at a position) | T3a, T3 |
| Context menu | both: Copy, Paste, Select All, Clear, Find, Split | Have (T3a): right click, Shift+F10 and the Menu key open the kit's menu: Copy (off without a selection), Paste, Select all, Clear, Find; a program that asked for mouse reports gets the right click unless Shift is held. Missing: Split (T6) and a link's own entries | T3a, T6 |
| Copy on select | VS Code: `copyOnSelection` | Missing | T3 |
| Paste safety | VS Code: a multi-line paste warns when the shell lacks bracketed paste | Bracketed paste works when the shell asks. Missing: the warning for a shell that does not (the emulator knows the mode) | T3 |
| Drag a file in to paste its path | both: the path, escaped for the shell; JB: dropping on the tab area opens a tab in that directory | Missing; a browser drop gives a name, not a path, so it needs the desktop window's file drop | T3 |
| Shell integration (OSC 133 and 633): command marks, exit status, jump between commands, sticky scroll, run a recent command, recent directories | VS Code (with auto injection for bash, zsh, fish, pwsh); JB: command separators | Missing and **Backend**: the host starts the shell and must inject the integration scripts; the parser is a UI step | T5 |
| Working directory tracking (OSC 7) | both | Missing | T5 |
| Command completion | VS Code: terminal IntelliSense; JB: Ctrl Space popup | Not planned | none |

### Appearance, settings, accessibility

| Feature | What the products do | Ours | Slice |
|---|---|---|---|
| Font family, size, line height, letter spacing, weight, ligatures | both | Fixed to the theme's mono face and 12 px; no settings | T6 |
| Cursor style, width, blinking, inactive style | VS Code: all four | Fixed: a solid block while focused, a hollow one otherwise, no blink (a blink is a timer, and idle is zero timers) | T6 |
| GPU renderer with fallback | VS Code: `gpuAcceleration` auto, on, off with a DOM fallback | Have (the GPU renderer while shown, the DOM while hidden or when it cannot start); no setting | T6 |
| Minimum contrast ratio | VS Code: `minimumContrastRatio` 4.5 | Missing | T6 |
| Scrollback size | VS Code: `scrollback`, default 1000; JB: buffer setting | A fixed 5,000 lines (measured, bounded) | T6 |
| Themes | both | Have: nine themes, the palette from tokens | T1 |
| Screen reader | VS Code: accessibility help, announcements, and the emulator's screen reader mode when its accessibility support is on (`editor.accessibilitySupport`: auto, on or off), not unconditionally | The input is labelled and described. **The printed output is in the accessibility tree only while the emulator's `screenReaderMode` is on** (the DOM renderer's row container is `aria-hidden="true"` in the emulator's own code, and the GPU's canvas is not text; CodeRabbit on #660, major). Built in T1 as a person's switch, **off by default**: the palette command `Terminal: Toggle Screen Reader Mode` turns it on and off at run time for every terminal of the window, **the choice is kept in the window's session document** (`terminalScreenReader`, `ui-next/shell/session`, beside the rail's choice), and the input's description says in both states whether the output is read aloud and how to change it; the result is announced once through the shell's live region. Probed (`screenreader`, `screenreader-cost`) and in seam `r`; the cost is measured in `T1.md` section 16 and decision 18. **Missing, T6:** turning it on by itself where the platform reports assistive technology (a web view gives the page no way to know today; VS Code's `editor.accessibilitySupport` is `auto`); a read-only accessible buffer view, as VS Code has; the Settings row with the terminal settings slice (which also becomes the place the choice is kept); a check with a real screen reader | T1, T6 |
| IME composition | both | The emulator's composition helper; not verified with a real input method | T6 |

## The slices, by what a person gains first

1. **T2, a terminal that survives and says what it is.** Reattach after a reload is built (T2b); the rest: tab titles from the program (OSC 0 and 2), rename, the bell mark on the tab, restart an ended terminal. Mostly UI, and the worst surprise it removed: a reload dropped a running shell.
2. **T3, find, links and the context menu.** Cmd F with case and regex, URL and file links (files open at the line once the host can), the context menu, copy on select, the multi-line paste warning, OSC 8. UI only except the file drop.
3. **T4, terminals that open where and how a person means.** The create call takes a shell or profile, a directory, an environment, a command, an initial size; the host sets `COLORTERM` and friends; the close event carries the exit code; the foreground process is known (so the close question is asked only when something runs). The plugin contract gains an additive "open a terminal" call (the pod exec button with a container picker uses it). This is mostly Go, and it unblocks T5.
4. **T5, shell integration.** The host injects the integration for bash, zsh, fish and pwsh; the UI parses OSC 133, 633 and 7: command marks and exit status, jump between commands, the directory of a terminal (a new terminal in the same place), restore after quitting with the directory and the scrollback.
5. **T6, settings and the rest.** Font, cursor, scrollback, contrast, Option as Meta, bell, GPU choice, screen-reader announcements, split panes and terminals in the editor area (these two need the shell's layout), the reflow check, an input-method check.

## What the backend must give (for the Go step; the seam and the probe name each)

While T1 was in review the Go step (agent `TerminalSignals`) opened PR #658 (`feat/t1-go-terminal-signals`, contract in `docs/ui-next/status/T1-go.md` section 2, the terminal items are 2.8, and 2.8.6 is binding for flow control). By its author's message it gives: `COLORTERM=truecolor`, `TERM_PROGRAM=Omniview` (and `TERM_PROGRAM_VERSION`, a UTF-8 `LANG` if unset), the initial size, a typed close event, `IsBusy` (a foreground process), the shell and the directory in the create answer, `GetCwd`, a `cwd` option, hang-up before kill, flow control that a terminal UI **must** turn on and keep (`AckTerminal`: see the flow row; its final message made acks a requirement, not an option) and ordered input. In its later review round its author adds: the `flow` option is gone; a close may carry `drain_capped` and `dropped_bytes`; a host shutdown hangs up the shells (`closed_by: 'shutdown'`); `WAILS_*` and the launching terminal's identity variables are stripped from the shell's environment. It leaves the host's `OMNIVIEW_*` and `GOWORK` reaching the shell (message of the first round). This file's author has NOT read or tested that PR: the last column says what its author says, and T1's seam prints each gap as `GAP` and asserts nothing about it, so the seam stays green on either side of that merge (the day it merges, the seam's `COLORTERM` line becomes an assertion).

| Need | Where it was (T1's base) | Class | In PR #658, as its author says |
|---|---|---|---|
| `COLORTERM=truecolor` (and a terminal identity such as `TERM_PROGRAM`) in the child environment | `backend/pkg/terminal/manager.go:142` set only `SHELL` and `TERM` | TANGENTIAL (the emulator draws 24-bit; programs that decide on `COLORTERM` fall back to 256 colours) | yes |
| Shell, directory, environment, command and initial size in the create call | the create answer named no shell; `manager.go:111-142`, `backend/pkg/plugin/exec/controller.go` | WIRE | the shell and the directory in the answer, a `cwd` option and the initial size; an environment option and a command are not named |
| Exit code or signal in the close event | fixed text, `backend/pkg/terminal/manager.go` | WIRE | yes (a typed close); the page reads it since T2a |
| The foreground process of a session | none; `ioctl TIOCGPGRP` on the pty works (T1.md section 7) | WIRE | yes (`IsBusy`); the page asks it at close since T2a |
| Sessions the page forgot (a reload) are listed and reclaimed | `ListSessions` lists them, nothing reclaims them | BLOCKER for T2 | yes, T2-go (#674): the page key, `ListTerminals`, `AttachTerminal`, `DetachTerminal` and the leases; the page reads them since T2b |
| Shell integration injected at spawn (OSC 133, 633, 7) | none | BLOCKER for T5 | not named (`GetCwd` gives the directory without it) |
| The host's own environment (`OMNIVIEW_*`, build variables) is not inherited by a terminal | `manager.go:141` passes the host's environment on | TANGENTIAL | no, stays open |
| Flow control: **a terminal UI must turn flow on and acknowledge every byte it parses, dropped bytes included.** The first `AckTerminal(sessionId, n)` call turns it on; `n` is the bytes of decoded stdout payload taken in since the last call (written into the emulator or dropped, not characters), batched from the emulator's write callback. From then on only the page's acks credit and what the transport takes credits nothing. The host stops reading the pty when 1 MiB (`flow_high_bytes`) is delivered and not acknowledged and reads again at 256 KiB (`flow_low_bytes`); a page that stops acknowledging pauses the shell and loses nothing; `AttachSession` forgets the debt, so the page acknowledges from the attach on | none at T1's base; PR #658 adds it, with no `flow` option (per its author, `docs/ui-next/status/T1-go.md` 2.8.6, which is binding) | WIRE (UI), **required** | yes. **Done in T2a (`T2a.md`).** The page makes the first call, with zero bytes, as soon as the create call answers (flow is on before any output), then acknowledges what the emulator parsed from its write callback: one call in flight, what was parsed meanwhile summed into the next, no timers and no thresholds. The 4 MiB hold-and-drop-oldest is deleted, so nothing is dropped. A session that is NOT shown goes on reading, parsing and acknowledging (a build in a background tab is never stalled by the view, as in VS Code), in frames of at most 256 KiB and drawing nothing itself; its cost is measured, not zero (`T2a.md` 5.1). The retention inside Wails' event path for a healthy reader in server mode (B-110) is after the credit point and acks do not fix it, shown or hidden: T2a measured it on the real host (`T2a.md` 5.3) and it stays open |
