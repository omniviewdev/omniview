# Status: T3-channel-page (the new UI's terminal on the terminal channel, #693 step 4)

- Goal: the Terminal tool of `ui-next/` reaches its terminals only by capability and one Wails stream per terminal (`docs/ui-next/terminal-channel-protocol.md`), and the events lane is no longer used by the new UI for terminals. Issue #693, steps 4 and 5; epic #692.
- Worktree: `~/omniview/wt/t3-channel-page`. Branch: `ui-next/t3-channel-page`, made from `origin/feat/terminal-channel-backend` at `f009987239743ea1b407bd5d4c86a4d3713ee340` (PR #704, not merged; the lead allows building on it, #693 comment of 2026-11-24). After #704 squash-merges: `git rebase --onto origin/main f009987239743ea1b407bd5d4c86a4d3713ee340 ui-next/t3-channel-page`.
- PR: none yet. Opened as a draft against `main` only after #704 merges (the lead's rule on #693).

## Open decision (owner)

- #693 "Open decision": a window hidden longer than Wails' 10-minute stream grace loses its stream, and the 5-minute detach lease then ends the terminal. Not answered on 2026-11-24. The page states what the host does (the terminal comes back ended); it does not keep a lease alive by itself.

## Log

- 2026-11-24 20:58: `uptime` load average 0.72, 0.78, 0.79. Worktree made; `pnpm install --frozen-lockfile` and `task packages` ok.
- 2026-11-24 21:05: the contract `ui-next/shell/panel/terminal/channel.ts` (`4d016ee6`). Slice A (`terminalChannel.ts`, `localShell.ts`, `PluginHostScreen.tsx`, `pageKey.ts` deleted, four calls added to the runtime's `ExecClient`): red `bebf03da`, green `111c51f4`. Slice B (the feed, held output, the registry; `rejoin`, the page key, sequence numbers, `DETACHED`, base64 deleted): red `95449d6f`, green `c8f607ad`. Merged `0514d47f`.
- 2026-11-24 21:28: `pnpm test ui-next/shell/panel/terminal ui-next/plugins/host`: 1,933 of 1,934; the one failure is `screen.test.ts` "writes what the host kept in slices ..." by the 5 s timeout at load average 16 (9.2 s); slice B saw it fail on the base commit too. Both tsc projects clean except `ui-next/shell/probes/terminal-fixture.tsx` (slice C). Slices C (probes), D (seam), E (memory on the real host) started.

## Dev tools

- `ui-next/shell/panel/terminal/testing.ts` `fakeChannels`: a fake `TerminalChannels` driven frame by frame.

## Backend catalog

- **WIRE: a displaced holder is not told when the taker lets the terminal go.** `docs/ui-next/terminal-channel-protocol.md` section 8: `taken-over` closes the displaced stream, so the events lane's `DETACHED` (`requested`, `window-retired`) has no channel equivalent. Evidence: the seam's r5 (take it back) cannot pass without it (ChannelSeam, 2026-11-24). Interim in the page: a tab that lost a terminal asks `ListChannelTerminals` for it when the page becomes visible or focused and every 5 s while it is visible (`attached === false` offers "Take it back"). Proper fix at the producer: a frame or a watcher connection that tells the displaced page when the terminal is free.
