# T7: the file-link provider in the page (#696 step 4)

**Status: for review.** Worktree `~/omniview/wt/t696-provider`, branch `feat/terminal-file-links` on `origin/main` `05f2785cd` (the URL links, the matcher #817 and `ChannelTerminalResolveLink` #815 are in). Page only: no Go, no new bound call (the runtime's hand-written `exec.ts` now re-exports the binding that #815 generated).

## 1. What this step is

Under the modifier (Command on a Mac, Control elsewhere) a path such as `src/a.go:12:3` in the output is a link if, and only if, the HOST says it names a file: the page finds the candidates, the host's `ChannelTerminalResolveLink` resolves them, and a link is made only for a resolved one. The hover shows the resolved absolute path first, then the line and column. What a click does is step 5 (`openFile`, which waits on the owner's decision): until then a file link's action is **Copy path** (decision 7).

| File | What it is |
|---|---|
| `links/cells.ts` | pure: the logical line of a buffer row (wrapped rows joined, walking up and down, bounded) with the cell of every UTF-16 offset; drops the padding cell a wide character leaves at a row end. |
| `links/fileProvider.ts` | the provider: lazy, under the modifier, bounded; imports no emulator (the terminal is a structure). `fileCandidatesInView` for the keyboard. |
| `xtermEngine.ts` | the only file that imports `@xterm/*`: `setFileLinks`, `fileCandidatesInView`; gives the provider the terminal. |
| `links/useTerminalLinks.tsx` | the hook: the handler (busy fact, row directory, cap, mapping of the host's answer), the tooltip (one for web and file links), `files.warm` / `files.inView` for the menu, Copy path. |
| `gutter/commandGutter.ts`, `screen.ts` | `directoryAt(row)`: the directory of the command that printed a row, as the shell proved it. |
| `execFeed.ts`, `terminalChannel.ts`, `channel.ts`, `feed.ts` | `resolveLink` on the feed and the channels (the capability never leaves the channel). |
| `menu/*`, `TerminalBody.tsx` | `Open link` lists the files in view; the body wires the feed and warms the list when the keyboard comes in. |

## 2. Decisions, with reasons

1. **Candidates are the matcher's (UTF-16 offsets), cells are the buffer's.** `cells.ts` reads the rows through the buffer (a width-0 cell gives no text, a blank padding cell at the end of a wrapped row gives none, a cluster maps all its code units to one cell), and a link's range is its first and last cell (the last as wide as it is). The matcher's own widths are never used.
2. **Lazy, on the hovered row only.** The emulator asks a provider for the row the pointer is on. The provider waits `FILE_LINK_SETTLE_MS` (100 ms) after the pointer arrives before it reads the line or asks the host: a pointer that crosses lines asks about none of them, and one that leaves the screen cancels. No question is made for any other line (a probe counts the host's log).
3. **Under the modifier, without a second move.** xterm keeps a row's answer until the pointer leaves the row, so answering "no link" because the key was up would hide the link for as long as the pointer stays. Instead the question is left **unanswered** while the key is up and asked when the key comes down (a `keydown` on the window, capture) or the pointer moves with it held; releasing the key before the settle cancels it. A pointer resting on a path that then meets the modifier is on a link, with no move. A reply for a row the pointer left is dropped, never given to the emulator (it would land among the replies of the row it is on).
4. **The emulator draws a row again after a hover** (a render, a cursor) and clears and asks again: the provider keeps the answer for the line the pointer is on (`memo`: line, text, answers) and gives it again with no second question and no gap in the underline; the memo ends when the pointer leaves the screen or reaches another line.
5. **Bounds.** A line over 2,000 characters has no file links and is read for at most the rows 2,001 characters fill, up and down (a megabyte with no line break wraps over thousands of rows and a row in its middle is refused after a handful of reads); at most 10 candidates of a line (the matcher's cap, and the hook's own `MAX_ASKED`); a candidate inside a printed web address is the web link's and the host is never asked about it; nothing on the alternate screen.
6. **The row directory is the shell's proof.** `directoryAt(row)` is the directory of the last command whose line is at or above the row, and only a directory a mark with the nonce gave (#694); a command whose directory the shell did not prove has none and does not borrow an earlier one's. The page names nothing of its own: no directory is the empty string, which the host reads as where the shell is now. The host vouches for the row's directory itself (the shell's current or one of the record's).
7. **No file link while a program other than the shell holds the foreground** (`ssh`, a container exec): the hook asks the host's own busy fact first, once for a line, and only `idle` allows a question; `busy`, `unknown` and a failed question give no links and the host is not asked about paths. Cost, stated plainly: **a command that runs in the shell's foreground (a compiler, `go test`) has no file links while it runs**, and its output is linked once it has ended; the page cannot tell `ssh` from `make` and a wrong link (a remote path resolved on the local disk, zed#28407) is worse than none. Rows an `ssh` printed that are hovered after it ended still resolve against the local directory of the command's record: the host cannot tell where a command ran (T7-resolve.md, not verified), and a page that guessed by the first word of the command line would be guessing.
8. **What a click does: Copy path.** `openFile` waits on the owner's decision (step 5). Until then a click with the modifier, and Enter on an item of `Open link`, copy the resolved path with the line and column (`/work/src/a.go:12:3`, or the path alone for a directory or a text with no line) through the existing clipboard call (`copyToClipboard`), once. The tooltip says so ("Copy path (cmd + click)") and so does the menu item ("Copy path /work/src/a.go:12:3"). A clipboard that refuses is one console warning. When the editor registers `openFile` the action and the words change in one place (`copiedText`, `copyWords`).
9. **The tooltip shape is the web link's:** the words that say what the click does, then the PATH on a line of its own and whole (it is what the person decides on), then where in it (`line 12, column 3`, clamped in the picture, whole in the document). One tooltip at a time for web and file links, with Escape's dismissal (WCAG 1.4.13) shared. A candidate the host did not resolve (`unknown` with any reason, `gone` included) is no link and nothing is underlined.
10. **Keyboard:** `Open link` lists the web addresses and then the resolved files of the lines in view, each file named by what it copies. The menu is a snapshot made when it opens, and the host is asked asynchronously, so the page keeps what it found: the lines in view are asked about (a) when the keyboard comes into the terminal body (a focus), and (b) every time the menu opens, for the next opening. At most 20 lines and 40 candidates (the engine's cap) are asked about, because a person asked for the list. The list is as of the last such moment; the first opening after output that nobody has focused since can be a step behind.
11. **Remote targets:** a feed that has no `resolveLink` (a terminal of a plugin) gets no handler at all: no link, no question, and `Open link` lists web addresses only.

## 3. Tests, red then green

| | sha | what |
|---|---|---|
| red | `0043130c7` | 51 tests fail by their assertions (the real-xterm provider tests, the hook, the menu, the gutter's `directoryAt`, the feed and the channel), with stubs |
| green | `3aa5935b7` | the code |
| probe | `0e5bad58d` | the probe, its host, the controls script, the units; then `PROBE_SHA` for the settle of the rows and the keyboard |

**The emulator of each test.** `xtermEngine.test.ts` ("the file links of a real emulator"): REAL xterm 6.0.0 in jsdom, with Unicode 11 as the engine loads it (the ranges, the cells, wrapped rows, wide characters, the modifier, the settle with fake `setTimeout`, the cap, the alternate screen, the URL overlap, the megabyte), the handler a recording fake. `links/fileLinksXterm.test.ts`: real xterm (the matcher's offsets over `cells.ts`). `gutter/commandGutter.test.ts`: real xterm (`directoryAt`). `menu/hookup.test.tsx`: the real screen and body over the FAKE engine (call order only). `useTerminalLinks.test.tsx`, `terminalMenu.test.ts`, `useTerminalMenu.test.tsx`, `execFeed.test.ts`, `terminalChannel.test.ts`: no emulator. The probe: REAL xterm in WebKit and Chromium (DOM renderer).

## 4. Controls, run whole

`ui-next/shell/probes/terminal-filelinks-controls.sh` (from the repository root; exit 0 only when every control is seen; `FIXTURE_DIST=<dir>` reuses a build of the fixture).

CONTROLS_PLACEHOLDER

## 5. Commands and results

RESULTS_PLACEHOLDER

## 6. Not verified

- The native window (WKWebView) and Safari itself; Windows; the Linux CI image.
- The real host with real zsh and bash (`ResolveLink` against a real disk, the real marks): the probe's host is the far end of T1-go and T2-go over a fixture tree. The seam scenario for #696 (step 6) is not written here.
- A screen reader's reading of the tooltip and the submenu (axe is clean).
- A path across the top edge of the viewport: the provider reads the whole logical line from the buffer, so it works; only the tooltip's place was not measured there.
- A pointer that rests on a path while the key goes down uses the window's key events; a window that does not give them (a native menu bar's shortcut that swallows Command) was not tried.

## 7. Dev tools

- `ui-next/shell/probes/terminal-filelinks.mjs`, `terminal-filelinks-probe.mjs`: the sections and controls of the probe (`node ui-next/shell/probes/terminal-filelinks-probe.mjs`; `SECTIONS=files-link` runs one; `task local:probes -- terminal-filelinks,terminal-controls-filelinks`).
- `ui-next/shell/probes/terminal-filelinks-controls.sh`: the controls whole (section 4).
- `terminal-host.mjs`: `ChannelTerminalResolveLink` over `options.tree`, `cd`, `files`, `short`, `many`, `bigline`, `hold`, and the faults `resolveAny`, `rowDirectoryIgnored` and `busyIdle`.

## 8. Backend catalog

Nothing new for the SDK or the host. TANGENTIAL (T7-resolve.md already says it): the host cannot say where a command ran, so a path an `ssh` printed can be resolved on the local disk after the command ends; the page's gate (decision 7) covers only while it runs.
