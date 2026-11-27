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

- Tracked cwd is believed only where `os.SameFile(tracked, pulled)` (the system agrees the shell is there), in the shell's spelling; the pull otherwise; the tracked path alone only when the pull is unsupported. Stale after `exec zsh` or a `cd` inside a running command is fixed (tests `TestAProofThatTheSystemContradictsIsNotTheAnswer`, `TestTheShellsOwnSpelling...`, with a fake `sh` that can `cd`; a real `exec zsh` was not run). The guards for forged, missing, file and relative proofs are now subsumed by the SameFile rule, so they keep tests but no single-fault control.
- Show names the terminal of the session (`generation` = restarts of the session) and `reveal(id, epoch)` on the gutter uses it; a closed terminal says so in a notice.
- `proven` is NOT reset: after `exec zsh` the card may still say Rich until the page is reloaded. Dropping it needs the host to say the prompt stopped carrying the nonce; not done.

- After a restart and then a take-back the registry count stays 1 but the new screen counts from 0, so Show then says the command is gone (safe failure; not fixed).

## Known limits

- A command that finished while the page was disconnected gets no notice. The card shows no directory.

## Verification (what was run)

- vitest `ui-next/shell/panel/terminal`, `ui-next/shell/settings`, `ui-next/plugins`: passed on the last runs (real xterm for gutter tests, fake emulator for the rest); one unload test timed out under load and passed alone.
- Go: new tests red then green; negative controls `T5-notice/mutations.sh.txt` (all 5 groups RED/GREEN as wanted) and `mutations-page.sh.txt` (result not read).
- NOT run: Go `-race`, golangci-lint, `task bindings` check, tsc (app, test, kit), eslint, kit verify, `pnpm run build`, ui-flavour and ci node tests, probes, seam. No real-browser look at the card or the toast.
