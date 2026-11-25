# Status: T4-profiles (shell and profile model, the default shell, issue #695 step 2)

- Agent: ShellProfiles. Worktree `~/omniview/wt/t695-profiles`, branch `feat/terminal-shell-profiles` on `origin/main` `b86c4af6` (has #716, the channel page, and #725, `launch.env`). Epic #692.
- Owned: `internal/shellenv/installed.go`, `backend/pkg/plugin/exec/{terminal_shells,controller,service_wrapper,terminal}.go`, the regenerated bindings and `packages/omniviewdev-runtime/src/exec.ts` (one export), `ui-next/shell/panel/terminal/{profiles,localShell,tool,terminals}.ts`, `ui-next/shell/panel/{SessionTabs.tsx,host.ts}`, `T1-go.md` 2.1 (one bullet), this file, `T4-profiles/`.
- Files of the host protocol v2 agent that this step had to touch, minimally: `execFeed.ts` (one option `launch`, spread into the `create` call), `terminalChannel.ts` (`command`, `cwd`, `env` of the launch go into `CreateTerminal`), `channel.ts` (three optional members of `ChannelLaunch`), `testing.ts` (the fake channels record them). Nothing else of theirs.

## Decisions

- **The host says which shell is the default.** `ListTerminalShells` returns `{name, path, default}` and marks the default by the same choice `CreateTerminal` makes (`withDefaultShell`), so what the menu marks is what starts (HOW-WE-WORK 11). The issue says the page reads `terminal.defaultShell` from the settings snapshot; the page instead asks the host again on `settings/changed` (the settings client's `onChanged`, loaded lazily) and never compares a setting with a path. Reason: the setting may be a name (`zsh`) or a path, may be stale, and the host is the one that resolves it.
- **Where the default takes effect: `controller.CreateTerminal`**, before the lane split, so both lanes get it with one line. It is the "requested" source (`opts.Command[0]`); a caller's shell is never replaced; the arguments that follow an empty first element belong to no shell and are dropped. A setting that is empty, unreadable, or not a shell the host starts (`shellenv.Check`) is left to the stated order, so a terminal still starts (the validator refuses a typo when it is typed, test in `internal/settings/default_shell_test.go`). An explicit program that is not a shell is still `SHELL_UNSUPPORTED`.
- **Detection is `shellenv.List`**: names bash, zsh, fish, pwsh over `/bin`, `/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`, each through `shellenv.Check`; a file reached through two paths (`/bin` is `/usr/bin` on merged systems) is listed once, another `bash` elsewhere (Homebrew) is a second shell; the default is listed even where no standard directory holds it, and marked by the file it is, not by its spelling. Order: by name, then directory. Tested with real files in temporary directories (a fake file system without a seam).
- **Page**: `profiles.ts` holds the profile `{name, path, args?, env?, cwd?, icon?, color?}`, the store of the host's list (asks when the first listener comes and on `settings/changed` while someone listens; none at rest; out-of-order answers dropped), the menu items, and `launchOf`. `+` still starts the default and names no shell; an arrow beside it (`Choose a shell`, the kit's menu host, `menuTrigger` dropdown) lists the shells with their paths and a check and "Default" on the default. A choice makes `localProfileTarget(profile)`, whose feed passes `command` (path and args), `cwd` and `env` to `CreateTerminal` on the channel lane. Detected profiles carry a name and a path only; icon, colour, args, env and cwd are for profiles a person writes (not in this step) and pass through untested by the host as they are.
- `PanelNewSession` gets an optional `menu` (`label`, `subscribe`, `getSnapshot` of kit `MenuItem`s): the panel stays free of shells; a tool with no items draws no arrow.

## Red and green

- Go red `0f4f2f6a` (assertions: no shells listed, the default setting not used, a list that is nil), green `78476918`, bindings `101d4b7b`, lint fixes and the runtime export `7685694f`.
- Page red `481cd3fe` (20 tests red by assertion), green `5fc6ce06`.

## Review fixes (ReviewShellProfiles, FIX FIRST)

- The header dropped `add.menu`: `PanelHeader` passes it on; test through the real header (`SessionTabs.test.tsx`, `staticPanel` takes a `menu`).
- `ListTerminalShells` had no audit row: added DENIED (`internal/auditgate/policy.json`); auditgate and exec packages pass.
- The list's default is now what `shellenv.Resolve` picks for the command `CreateTerminal` would make, so a `$SHELL` that is not a shell no longer leaves the list with no default (test with `$SHELL` set to a non-shell).
- Tests added: leave before the settings chunk loads; a default reached by a link is named by the file it reaches. Controls added for each (and for the header).
- The real host now draws the arrow, so two `PluginHost` tests that count console warnings saw the list's warning: one gives a fake list, one counts only its own topic.

## Checks run

- Go: `go build ./...`; `go vet` on `internal/shellenv`, `internal/settings`, `backend/pkg/plugin/exec`; `GOOS=windows go vet` on the three; `GOOS=darwin go vet` on `internal/shellenv` and, with `-tags purego` (the wails build guard wants cgo), on `internal/settings` and exec; `go test -race` on `internal/shellenv`, `internal/settings`; golangci-lint v2.15.0 `--new-from-rev=origin/main` on the three packages: 0 issues. `TestTheOutputOfAShortCommandReachesALateAttach` (not mine) failed once in a full run of the exec package under load and passed in 9 reruns.
- `go test -race` of `backend/pkg/plugin/exec`, `internal/shellenv`, `internal/settings`: ok. `task check:bindings-check`: no diff.
- Page: vitest of `ui-next/shell/panel` and `ui-next/shell/settings` (2905 of 2906; the one failure, `LogStreams.fuzz` of the logs tool, timed out at 5 s on a loaded machine and is not in a file this step touches); `tsc -p tsconfig.app.json`, `tsc -p tsconfig.test.json`, kit typecheck: clean; eslint of `ui-next/shell/panel`: clean; `lint:css`, `lint:ui-policy`: clean. Kit `verify`: two tests of the kit (`formatAge` DST walk, `LogView` 50000 lines a second) timed out at 5 s under load in a package this step did not touch (not rerun on a quiet machine).

## Controls (both halves)

- Go: `bash docs/ui-next/status/T4-profiles/mutations.sh.txt` (11 faults: the setting never read, the default replacing a named shell, the setting used unchecked, arguments of no shell going to the default, the list marking the login shell, a shell listed twice, a file that cannot run listed, the default marked by spelling, a missing default invented, a default outside the standard directories left out, the settings validator accepting a typo). Each red in exactly the tests named, and passes with them skipped.
- Page: `bash docs/ui-next/status/T4-profiles/page-mutations.sh.txt` (12 faults; it edits the files in place and restores them on exit): the page guessing the default, a stale answer winning, listening to the settings with nobody listening, one ask per listener, no ask on a settings change, the launch not sent (target, feed, channel), the `+` naming a shell, the menu remade on every read, the default unmarked, an arrow for an empty choice.

## Not verified

- No seam scenario and no probe section (step 6 of the issue). Not run in a real browser or on the real host: the dropdown is tested in jsdom with the kit's real menu host; its layout, focus return and look are not seen. macOS and Windows: not run.
- The full `pnpm test` (only the panel and settings folders ran) and a quiet-machine rerun of the kit's two timed-out tests.

## Dev tools

- `docs/ui-next/status/T4-profiles/mutations.sh.txt` (Go, `go test -overlay`) and `page-mutations.sh.txt` (vitest).

## Backend catalog

- Host: bound method `ExecClient.ListTerminalShells`, `terminal.defaultShell` effective on both lanes. SDK: nothing.
