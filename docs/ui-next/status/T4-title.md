# Status: T4-title (title from the program, and rename; issue #695 step 4)

- Agent: TitleRename. Worktree `~/omniview/wt/t695-title`, branch `feat/terminal-title-rename` on `origin/main` `427640e38` (after #784 marks, #777 New terminal here, #767 profiles). Epic #692. No push, no PR.

## Design

- **The producer states the title and the word that a program runs.** The host reads OSC 0 and 2 in the step that appends output to the replay ring (`backend/pkg/terminal/title.go`), so a tab no body is mounted for still has its title and a reload gets it (a page-side scan would need a mounted view and would lose a title older than the 1.25 MiB ring). It keeps the last title and says it in a frame of its own, `0x8c` `{"v":1,"title","program"}`, to a page whose attach says `"title":1` (protocol section 4b). The same pair is not said twice.
- **`program` is the host's fact**, never the page's: a command the shell proved it started (nonce'd start mark, not ended), or a foreground process group other than the shell's. It is taken after the output that set the title and again after every read **while it is true** (one `TIOCGPGRP` and a `getpgid`; no timer, no goroutine, nothing asked of a terminal that has no title). A title set AFTER the last prompt was drawn (after the input-start mark: bash's PS1, which may set a title, sits between the prompt-start and it) and BEFORE the vouched start mark (zsh runs the user's preexec, where oh-my-zsh and p10k set it, before the integration's) is decided when the start mark comes (a mark read is a reason to look, no syscall); a title from before the prompt (the shell's precmd) is not borrowed by a command that sets none. The end of a program is said by the first output after it (the prompt) or by the end mark. A forged start mark does not make a title a program's (test).
- **Rule (JetBrains'):** the tab shows the title only while `program` is true; else the shell's name (`shellenv.Name`, as before). VS Code's default shows the process name; recorded here.
- **Untrusted text.** Host: valid UTF-8, no control (C0, DEL, C1: so no ESC), no separators, no format character (Cf: zero-width, bidirectional, the tags) but the emoji joiner U+200D, no fillers (U+115F, U+1160, U+3164, U+FFA0, U+2800), trimmed, at most 256 bytes at a rune boundary; the scanner holds at most 1,026 bytes of one title (100 KB costs 1 KiB). Page: `title.ts` cleans and bounds again; the panel model strips the same characters from every title it is given (`retitleSession`, `renameSession`); tabs draw titles as React text.
- **Feed-level fact.** `TerminalFeedSnapshot.title`: present only while the host says a program runs and the cleaned title is not empty; gone with the terminal (ended, taken over, failed). `localShell.ts` `retitle` = `status.title ?? status.program`; the registry retitles through `retitleSession` as before (the A22 twin rule is the selectors', unchanged).
- **Rename pins.** `Session.titlePinned` (panel model, saved with the session, `PANEL_VERSION` stays 1: an optional member, a value that is not `true` is repaired to absent). `renameSession` pins; `retitleSession` is refused (`pinned`) for a pinned session, so the program never takes the name back, in a run or after a reload. The old rule "a title the registry did not set is the person's" (a title comparison) is deleted: it lost a renamed tab at a reload. A rename that leaves the name as it was pins nothing; an EMPTY name from the person clears the pin (persisted): the title stays until the owner names the session again, which the registry does at once (it watches the pin go), and the tab shows the program's title or the shell's name (VS Code's behaviour). An empty name for a session nobody named is refused.
- **Where tab identity lives (Risks):** decided UI-owned, in the window's saved panel (`persist.ts`), as `titlePinned`. A second window or a taker tab does not see a rename; keeping `{title, titlePinned, ...}` in Go with the session needs a wire change and is for the day a second window must see it (issue non-goal).
- **Rename gestures:** the toolbar's Rename session (S117's fifth button, disabled for a held session with the words of the tab's menu; the strip draws the field, through a window-level `Renaming` request, `panel/renaming.tsx`), a double click on the tab, F2 on the tab, and the tab menu's Rename session… as before. `aria-keyshortcuts` of the tab is `F2 Delete`.
- **Known limit.** A title set by a program BEFORE the shell gives it the foreground (a race of a few ms with a shell that has no integration) is stated with `program: false` and not re-read until the next output under a title that is a program's; with the shell integration (the default) the start mark makes it true. A shell that does not set its own title and has no integration keeps a program's title until its next title or a read that finds the shell in the foreground (the prompt).

## Shas

(Branch `feat/terminal-title-rename`; see `git log`.) Go scaffold `090c8a8f2`, Go red `505647fc9`, Go green `dfba7d4a5`; page scaffold `808365e08`, page red `c7c7993be`, page green `0b74bcbcf`; lint fix after.

## Checks run

See the last section, filled at the end.

## Controls

- Go: `bash docs/ui-next/status/T4-title/mutations.sh.txt` (20 controls: 13 stream controls each RED in its named guard of `channel_title_test.go` and GREEN with the guard off, 7 unit controls RED in `title_test.go`). Run: all as wanted, exit 0.
- Page: `bash docs/ui-next/status/T4-title/page-mutations.sh.txt` (see the result below).

## Not verified / not done

- The seam scenario `r6` and the probe sections for the title, the rename and the reload: reserved for step 6 of the issue. The seam's frame table knows `0x8c` (a real zsh or bash that sets its own title would otherwise be an unknown frame). The fixture host (`terminal-host.mjs`) does not speak the title frame.
- A real zsh and bash end to end on the title (a program that prints `ESC ] 0 ; title BEL`), macOS, Windows.
- Independent review: the Go half scans program output in the pump's step and adds a frame; the page half is CodeRabbit's.

## Dev tools

- `docs/ui-next/status/T4-title/mutations.sh.txt`, `page-mutations.sh.txt`: the controls.

## Backend catalog

- Host: OSC 0 and 2 read at the producer, with the foreground fact; the frame `0x8c`. An SDK plugin session (exec lane) has no such frame: its tab keeps the name its target gives.
