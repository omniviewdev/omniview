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

## Known limits

- A notice clicked after a restart of the terminal reveals by id in the new shell's epoch. A command that finished while the page was disconnected gets no notice. The card shows no directory.

## Verification (what was run)

- vitest `ui-next/shell/panel/terminal`, `ui-next/shell/settings`, `ui-next/plugins`: passed on the last runs (real xterm for gutter tests, fake emulator for the rest); one unload test timed out under load and passed alone.
- Go: new tests red then green; negative controls `T5-notice/mutations.sh.txt` (all 5 groups RED/GREEN as wanted) and `mutations-page.sh.txt` (result not read).
- NOT run: Go `-race`, golangci-lint, `task bindings` check, tsc (app, test, kit), eslint, kit verify, `pnpm run build`, ui-flavour and ci node tests, probes, seam. No real-browser look at the card or the toast.
