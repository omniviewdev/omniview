# Status: T3-channel (the terminal channel, backend: capability, per-terminal stream, hidden-page policy)

- Agent: TerminalChannelBackend (for TerminalChannel, for Main). Ask (Main, 2026-11-24): steps 2 and 3 of `proposals/T-terminal-channel.md`, Go only: a capability on the terminal calls, one Wails GoStream per terminal carrying output, replay, input, resize and acknowledgements, and a policy that never blocks a shell while its page sleeps.
- Worktree: `~/Repos/omniviewdev/worktrees/terminal-channel-backend`. Branch: `feat/terminal-channel-backend`, on `origin/main` `0cfc6e46` (B-113, #690).
- Owned and changed: `backend/pkg/terminal/**` (new: `channel*.go`; changed: `manager.go`, `reattach.go`, `replay.go`, `types.go`, `errors.go`, `manager_windows.go`), `backend/pkg/plugin/exec/{controller,service_wrapper,terminal}.go` and the new `terminal_stream.go`, `main.go` (one line: the stream), `internal/auditgate/policy.json` (the five new calls, denied), the regenerated bindings, `docs/ui-next/terminal-channel-protocol.md`, this file and `T3-channel/mutate.py.txt`.
- Not touched: `ui-next/**`, `ui/**`, `TRACKER.md`, `backend-catalog.md`, the legacy lane (a terminal without `launch.channel` behaves as before).

## Log

- 2026-11-24 09:32: `uptime`: load average 7.29, 13.03, 18.57 (other agents share the machine: counts are exact, timings compare).
- 2026-11-24: read AGENTS.md, the design (`T-terminal-channel.md`), T1-go, T2-go, the reviews of #658 and #677, the spike's GoStream adapter, `manager.go`, `reattach.go`, `replay.go`, `flow.go`, `ordered.go`, the exec controller, wrapper and `terminal.go`, `stream.go` of Wails v3.1.0 and the audit policy. Worktree made off `origin/main`.
