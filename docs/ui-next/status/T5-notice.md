# Status: T5-notice (tracked cwd, notice, opt-out, tier; issue #694 step 6)

- Worktree: `~/omniview/wt/t694-notice`. Branch: `feat/terminal-integration-notice` on `origin/main` `af58b162f`.

## Decisions

- **Tracked cwd (Go).** `session.directory()` answers the last `633;P;Cwd` the nonce vouched for when it is an absolute existing directory; else the /proc pull. Covers `GetCwd`, `ChannelTerminalCwd`, attach and `ready`. OSC 7 (no nonce) is never the answer. Contract: `T1-go.md` 2.8.4b.
- **Tiers** (`terminal/integration.ts`, derived from the host's `integration` fact and a nonce-vouched mark, `proven`):
  - `none`: integration `off`, `skipped`, `failed`, or the host says nothing. A proof never upgrades it. Not on the card when the host says nothing.
  - `basic`: `on` or `unconfirmed`, no nonce-vouched mark yet.
  - `rich`: `on` or `unconfirmed` and a nonce-vouched mark came (command line or directory).
  Words are on the session card (fact `Shell integration`) and in the terminal input's description (a11y).
- **Notice** (`terminal/finishedNotice.ts`, wired in `terminals.ts` and `PluginHost.tsx`): on by default; only for a live command-end mark (replays are no news) with producer `durationMs >= 10 s`, in a terminal not in front (not the shown session of an open panel, or document hidden); once per (session, id, end time); severity success, or warning for exit != 0; action `Show` brings the session forward, the body moves to the command (`reveal` by id) and focuses the terminal. Identical text within 60 s folds in the shell's notices (count), the action then goes to the newest command. No Settings toggle for the notice (recorded: follow-up if wanted).
- **Opt-out.** `terminal.shellIntegration` was already declared (`internal/settings/terminal.go`) and is drawn generically; the UI test fixture lacked it, now added, with a Go drift test tying the fixture to the declaration.

## Review round

- Tracked cwd is believed only where `os.SameFile(tracked, pulled)` (the system agrees the shell is there), in the shell's spelling; the pull otherwise; the tracked path alone only when the pull is unsupported. Stale after `exec zsh` or a `cd` inside a running command is fixed (tests `TestAProofThatTheSystemContradictsIsNotTheAnswer`, `TestTheShellsOwnSpelling...` with a fake `sh` that can `cd`, and `cwd_real_shell_test.go` with real bash and zsh: exec into a shell with no integration then `cd`, a symlink, a `/var`-shaped symlinked directory, a removed directory). The real-shell exec test is red with the pre-fix `manager.go`. The guards for forged, missing, file and relative proofs are now subsumed by the SameFile rule, so they keep tests but no single-fault control.
- Show names the terminal of the session (`generation` = restarts of the session) and `reveal(id, epoch)` on the gutter uses it; a closed terminal says so in a notice.
- `proven` is NOT reset: after `exec zsh` the card may still say Rich until the page is reloaded. Dropping it needs the host to say the prompt stopped carrying the nonce; not done.

- After a restart and then a take-back the registry count stays 1 but the new screen counts from 0, so Show then says the command is gone (safe failure; not fixed).

## Known limits

- A command that finished while the page was disconnected gets no notice. The card shows no directory.

## Verification (what was run)

- vitest `ui-next/shell/panel/terminal`, `ui-next/shell/settings`, `ui-next/plugins`: passed (real xterm for the gutter and Show-after-restart tests, fake emulator for the rest); timeouts under load in the unload, saved-session, panel fuzz and notices tests are the ones main shares here.
- Go: new tests red then green; `-race` on `backend/pkg/terminal`, `internal/settings`, `backend/pkg/plugin/exec` (plain and `-tags server`); real-shell tests `-race -count=5`; vet linux and darwin; golangci-lint (CI form) 0 issues; `task check:bindings-check` exit 0.
- Controls: `T5-notice/mutations.sh.txt` and `mutations-page.sh.txt`, each run whole: every control RED, every removal GREEN.
- tsc (app, test, kit), eslint `ui-next` and `packages/kit`: clean. `pnpm run build` (stable), `node --test scripts/ui-flavour.test.mjs` 7/7; `node --test scripts/ci/*.test.mjs` fails only the 9 that fail on main here.
- Seam `terminal-core,terminal-restart,terminal-channel,terminal-find` on `e9ec90f84`: exit 0, both engines.
- NOT run: no real-browser look at the card or the toast; the take-back count above.
