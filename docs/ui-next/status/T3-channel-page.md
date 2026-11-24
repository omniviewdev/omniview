# Status: T3-channel-page (the new UI's terminal on the terminal channel, #693 step 4)

- Goal: the Terminal tool of `ui-next/` reaches its terminals only by capability and one Wails stream per terminal (`docs/ui-next/terminal-channel-protocol.md`), and the events lane is no longer used by the new UI for terminals. Issue #693, steps 4 and 5; epic #692.
- Worktree: `~/omniview/wt/t3-channel-page`. Branch: `ui-next/t3-channel-page`, made from `origin/feat/terminal-channel-backend` at `f009987239743ea1b407bd5d4c86a4d3713ee340` (PR #704, not merged; the lead allows building on it, #693 comment of 2026-11-24). After #704 squash-merges: `git rebase --onto origin/main f009987239743ea1b407bd5d4c86a4d3713ee340 ui-next/t3-channel-page`.
- PR: none yet. Opened as a draft against `main` only after #704 merges (the lead's rule on #693).

## Open decision (owner)

- #693 "Open decision": a window hidden longer than Wails' 10-minute stream grace loses its stream, and the 5-minute detach lease then ends the terminal. Not answered on 2026-11-24. The page states what the host does (the terminal comes back ended); it does not keep a lease alive by itself.

## Log

- 2026-11-24 20:58: `uptime` load average 0.72, 0.78, 0.79. Worktree made; `pnpm install --frozen-lockfile` and `task packages` ok.

## Dev tools

## Backend catalog
