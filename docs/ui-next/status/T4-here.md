# Status: T4-here (directory at create and "New terminal here", issue #695 step 3)

- Agent: DirectoryHere. Worktree `~/omniview/wt/t695-here`, branch `feat/terminal-directory-here` on `origin/main` `f01b8de41`. Epic #692. No push, no PR.
- 2026-11-26: done: Go fix, page, tests, controls script written. Not run: the controls script, probes, seam (see "Not verified").

## Design

- **Start directory at create.** The page knows no workspace or connection directory: `ui-next/plugins/contract/v1.ts` carries none (only status-bar path crumbs), and the Go "workspace" types are plugin dev workspaces. So the `+` still starts in home (the host's default). Nothing was invented; when the contract gains such a directory, `localShellTarget` takes a `cwd` the way `localHereTarget` does.
- **"New terminal here"** is an item of the terminal's context menu (kit menu host: pointer, Shift+F10, Menu key, focus return and `aria-disabled` reasons as for Copy and Paste), after a separator, glyph `plus`. It is unavailable with a reason (`NO_DIRECTORY`) for a feed that has no `directory`.
- **The fact is the host's.** `TerminalFeedHandle.directory()` (feed.ts): while the shell runs it asks `ChannelTerminalCwd` (new `channels.cwd`, runtime export `ChannelTerminalCwd`), every call, never cached, no timer. Ended, lost (taken over), failed or leaving: the directory the host said the terminal started in (`terminal.Session.cwd`, from the create answer or `ready.session`), `source: 'start'`. A host answer of `gone` falls back to that. A host `reason` (or no reading) is `unknown`; the start directory is NOT substituted for it. Tracked cwd (OSC 7) is not wired into `ChannelCwd` yet (`/proc` pull only, T5-inject step 4): when it is, this page changes nothing.
- **Unknown** starts in the default directory (home) and the lane says "Started in your home directory" (`startNote`, cleared by the first thing typed, like `inputLost`).
- **Go, small:** `session.directory()` answers `query-failed` for a path that is not a directory when looked at (Linux `<path> (deleted)`), so a shell in a removed directory is unknown, not a path `launch.cwd` would refuse. T1-go 2.8.4a. No start-directory field was needed: `Session.Cwd` already is it. No wire change, no bindings change.
- The new terminal is the host's default shell (not the source terminal's shell), as VS Code's and JetBrains' new terminal.

## Shas

- Go red `12a5674901`, Go fix `cf08195153`.
- Page red `9969660514` (43 tests red by assertion, listed from a vitest JSON run), page green `8b4a327e8b` (amended once to include formatting).
- Status file and controls: the commit that adds this file.

## Checks run (load average 11 to 23: record per AGENTS 27)

- Go: `go build ./...`, `go vet` on `backend/pkg/terminal/...` and `backend/pkg/plugin/exec/...`: clean. `go test -race -count=1 ./backend/pkg/terminal/...`: ok (274 s). golangci-lint v2.15.0 CI form on `./backend/pkg/terminal/...`: 0 issues. `task check:bindings-check`: regenerated, no diff.
- Page: vitest `ui-next/shell/panel` 70 files 2998 tests pass (before the last lint-only reformat; the terminal folder, 34 files 1790 tests, passed after it); `tsc -p tsconfig.app.json` and `tsconfig.test.json`: clean; eslint `ui-next/shell/panel` and the fixture: clean.

## Controls

- Go: the red test is the control for the `os.Stat` guard (it fails on `main`, passes with the fix; a directory that exists is asserted before the removal).
- Go: `bash docs/ui-next/status/T4-here/mutations.sh.txt` (the sibling named like the link suffix: red in its test).
- Page: `bash docs/ui-next/status/T4-here/page-mutations.sh.txt` (23 faults, both halves). Run: each is red in exactly the tests named and passes with them filtered out.

## Not verified

- Kit `verify`: its run fails only by 5 s timeouts under load average over 20 in kit files this PR does not touch (LogView, Menu counts, formatAge, CardGrid, table counts); the plugin-vocabulary guard (`eslint/vocabulary.test.mjs`) passes, 28 of 28, with a 120 s timeout. Full `pnpm test`: not run.
- Run later (Main's order): seam `terminal-core,terminal-find` passed in both engines; probes `--changed`: every find unit and control passed, and 11 `terminal-probe` timing controls (flood/hidden-work frames and callbacks, load average over 20) exited 1; Main reports they fail on main here too.
- No probe section or seam scenario for the new behaviour: reserved for step 6 of the issue (`r6`). The fixture host's `ChannelTerminalCwd` answers a constant `/home/user`.
- Real browser, macOS (proc_info with a removed directory), Windows (`unsupported`).
- The Go half needs the independent review (nothing about processes changed, but `GetCwd` semantics did).
- Which failures also fail on `origin/main`: none seen; no failure was observed in the runs above.

## Review notes closed (ReviewDirectoryHere: MERGE)

1. A removed `y` next to a live `y (deleted)`: `os.SameFile` against the process's cwd link when the path ends in ` (deleted)`.
2. An ended terminal whose start directory was removed: the feed (`homeIfMissing`) makes the terminal again without `cwd` when the host answers `INVALID_REQUEST`, with the note.
3. Only the person's writes clear the note; the emulator's replies are passed with `{ reply: true }`.
