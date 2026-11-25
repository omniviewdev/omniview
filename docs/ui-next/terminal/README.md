# The terminal: state, contracts, decisions and what is left

Written on 2026-11-24 at `origin/main` `0cfc6e46` for an engineer, and the agents they point at it, who have none of the history. It says what the terminal is today, where its code and its proofs are, what the contracts say, what the owner decided, what is known to be wrong, and what is left, in the order to do it. Numbers and lines are as of that commit: re-read a line before you rely on it.

**What the work is.** The owner's bar (2026-11-22, section 4): the terminal "needs to be an exceptional functional terminal that does what you would expect in an ide". The bar is what the integrated terminals of VS Code and JetBrains do. The mock guides placement, tokens and words, not what the terminal can do.

**How to start.** Read `docs/ui-next/AGENTS.md` (the rules for everything in `ui-next/`, `packages/kit/` and `docs/ui-next/`), then this file, then `HOW-WE-WORK.md`. Then open the epic (section 7), take the first unchecked child whose dependencies are met, and read the files that child names. Work one small pull request at a time.

## 0. This folder

| File | What it is | Read it when |
|---|---|---|
| `README.md` | this file | first |
| `HOW-WE-WORK.md` | the working method: one step, one pull request, one push; tests first; the real surface; the seam; probes; independent review; the merge gate | before your first pull request |
| `../status/T-terminal-bar.md` | the feature bar: every IDE-terminal feature, what VS Code and JetBrains do, what we have, which slice closes it (T2 to T6), and what the backend must give | planning any feature |
| `../status/T1-go.md` | **the contract** of the host's local terminal backend: calls, events, errors, the busy fact, ordered input, flow control, the shell and environment contract | touching `backend/pkg/terminal`, the exec wrapper or the page's wire |
| `../status/T2-go.md` | **the contract** of detach, attach, lease and replay by offset, and what the page key does and does not guard (2.7) | reload, takeover, the channel |
| `../status/T1.md`, `T2a.md`, `T2b.md`, `T2d.md` | the UI's status files: decisions, measurements, what was not verified, follow-ups | before changing the page's terminal code |
| `T-terminal-channel.md` | the design and the spike of the per-terminal stream and the capability (B-110, B-111) | the channel issue |
| `prior-art.md` | what about 30 terminals do; **section 4** ranks twelve things to adopt, **section 5** names the five pitfalls most likely to bite, **section 6** is the parity matrix for pods | any feature |
| `exec-lane.md` | the plan for the SDK's exec lane (interactive session and bounded run) and its steps X0 to X6, H*, K*, F1 | pod exec, agent tools, shell integration |
| `exec-tag-gate.md` | the conditions that must hold before the first tag that ships `exec.v2` | pod exec, agent tools |
| `exec-lane-k8s-proof.md` | a real Pod provider on the contract, measured on a real cluster | pod exec, agent tools |
| `backend-catalog-terminal.md` | every backend-catalog entry about the terminal or the exec lane (B-numbers), word for word, with where each stands | any defect |

The copies (`prior-art.md`, `T-terminal-channel.md`, `exec-lane.md`, `exec-lane-k8s-proof.md`, `exec-tag-gate.md`) are working notes of the lead, dated and unchanged except for removed machine paths; each begins with a note saying so and where its cross-references went. Where a note and the code disagree, the code and the contracts in `../status/` win.

## 1. What is built today

### 1.1 What a person gets

On `main` the new UI's bottom panel has a Terminal tool (`ui-next/shell/panel/terminal/`). It runs the user's login shell on a pty owned by the host (`backend/pkg/terminal/`) and draws it with xterm.js 6.0.0.

- **A real terminal.** Programs of the machine work: `less`, `vim` (with the mouse), `top`, `tmux`; resizing while a program holds the alternate screen; bracketed paste; 24-bit colour; Unicode 11 widths; wide characters and emoji (the cursor column is measured against the shell's own count); copy and paste with the platform's chords; select all; Cmd+K clears. Scrollback is 5,000 lines. The renderer is the GPU's (WebGL) while the panel is shown and the DOM's while hidden or after a context loss.
- **It starts as the shell the user means.** The login shell as the account has it, from the environment the host was launched with (so the user's PATH order survives: a macOS Dock launch behaves like Terminal.app), at the size the person sees (the pty opens at that size, no resize follows), in the home directory, with `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=Omniview`. No host variable (`WAILS_*`, `OMNIVIEW_*`, `PLUGIN_*`) reaches it. The tab is named after the shell the host resolved. A shell that cannot start shows the paths tried.
- **It says what the host knows.** How the shell ended ("Exited with code 3", "Ended by SIGKILL", who closed it) in the host's typed words; whether something runs in it (the close question asks only when a program other than the shell holds the foreground, names it, and asks in general words when the host cannot tell); the shell's directory on request.
- **Keys.** On macOS every Ctrl and Option chord goes to the shell and every Cmd chord goes to the app, except copy, paste, select all and clear; on Windows and Linux a Ctrl chord without Shift goes to the shell and Ctrl+Shift chords are the app's; the Mac editing sequences (Option and Cmd with the arrows and Backspace) are sent; Escape stays in the shell; F6 leaves the terminal (`keys.ts`).
- **It survives a reload, byte for byte.** A terminal keeps running when its window reloads (5 minutes by default, 30 at most); the page comes back, finds its terminals by a key it keeps in the window's saved state, attaches by offset, replays into a fresh emulator with the emulator's replies muted and the screen's size and modes restored, and the live output follows with no gap and no duplicate. The input goes on from the host's own sequence number. The panel comes back as it was left (open or closed, tool, session, height).
- **A second tab takes it, and can give it back.** Another tab that takes the terminal over tells the first ("Taken over by another tab"); when the taker has gone the first tab offers "Take it back". When the page's events connection drops and returns, each running terminal rejoins by offset. A terminal whose lease ran out, or that ended while the page was away, says so.
- **It is paced and bounded.** The page acknowledges every byte its emulator parsed; the host stops reading the pty at 1 MiB unacknowledged and resumes at 256 KiB; a hidden terminal keeps parsing and acknowledging (a build in a background tab is never stalled) and draws nothing. Input is a numbered, ordered, bounded queue on the host (256 operations or 1 MiB).
- **Closing is clean.** SIGHUP to the foreground group and the shell, SIGKILL after 1.5 s for what ignored it; exactly one CLOSE, after the last output; a host that quits hangs up every shell.
- **Accessible.** A screen-reader mode (off by default, a palette command turns it on) puts the printed lines in the accessibility tree; every control is a Tab stop; Tab leaves an ended terminal's screen.

What it does not do yet is in section 6.

### 1.2 How the data flows

- **Calls** are the host's Wails-bound methods on `ExecClient` (`@omniviewdev/runtime/api`; types generated by `task bindings` into `packages/omniviewdev-runtime/src/bindings/.../terminal/models.ts`): `CreateTerminal(opts, launch)`, `WriteTerminal(id, seq, data)`, `ResizeTerminal(id, seq, rows, cols)`, `AckTerminal(id, bytes)`, `IsBusy(id)`, `GetCwd(id)`, `CloseSession(id)`, `ListTerminals(pageKey)`, `AttachTerminal(id, {page_key, from_offset})`, `DetachTerminal(id, {page_key, lease_ms})`. **The page chooses the id and listens before it starts the shell**, so the first prompt cannot arrive before somebody listens.
- **Events** go to every window by name: `core/exec/stream/output/<id>` as `{offset, data (base64)}` for a terminal with a page key (`.../stdout/<id>`, plain base64, without), `core/exec/signal/CLOSE/<id>` (a typed `End`, once, after the last output) and `core/exec/signal/DETACHED/<id>` (`{by, attachment}`). The calls and events carry the id and nothing else: that is B-111 (section 5).
- **Output.** One pty read (at most 20,480 bytes) becomes one event; the host numbers it by byte offset and keeps the last 1.25 MiB in a ring cut at chunk boundaries where the escape-sequence scanner (`modes.go`) is in the ground state; the page holds the bytes exactly as they came and writes them into xterm in frames (512 KiB a frame shown, 256 KiB hidden, 64 KiB slices) and acknowledges from the write callback.
- **Reattach.** `AttachTerminal` answers `{session, replay{start, end, data, start_size, start_modes, size, modes}, cwd, busy, attachment, next_input_seq, ended?}` atomically with respect to the events; the page drops any event whose bytes it has (`offset + length <= next`), always.
- **Ownership today.** A window owns the terminals it started; a terminal with a page key is detached, not ended, when its window retires; the page key (a secret the page makes, kept in the window-state slot `terminal-page-key`) is how a reloaded page finds its terminals. It is an anti-hijack token for List, Attach and Detach only (`T2-go.md` 2.7).

### 1.3 What proves it

- **Go tests** in `backend/pkg/terminal/` and `backend/pkg/plugin/exec/` (real ptys, real shells; forced-order tests, a hammer with end-state invariants, a fake clock for leases; 31 negative controls for T2-go in `docs/ui-next/status/T2-go/mutations.sh.txt`).
- **Vitest** next to each file in `ui-next/shell/panel/terminal/` (a fake feed, a fake engine, and real-xterm tests).
- **Probes** (the page against the real kit, a fixture host that speaks T1-go and T2-go, WebKit and Chromium at 1440 x 900 and 1280 x 800, counts and not milliseconds): `ui-next/shell/probes/terminal-probe.mjs` (`PART=view`), `terminal-data-probe.mjs` (what flows and what it costs: a hidden panel, an idle terminal, a 16 MB flood, 1,000,000 lines kept to the cap, the numbered input), and the six `terminal-reattach-*-probe.mjs` (key and restore, replay and modes, takeover and lease, the saved panel, take it back, rejoin). Units and controls are in `scripts/ci/probe-units/terminal.mjs` and `scripts/ci/probe-units.manifest.json`. `mock-terminal.json` is the mock's terminal body measured (`mock-terminal-measure.mjs`); `terminal-look.mjs` and `terminal-mock-shot.mjs` photograph the page and the mock; `terminal-host-memory.mjs` measures the real host's memory under a flood by hand (B-110).
- **The seam** (`ui-next/plugins/e2e/seam.check.mjs`, run in CI by `.github/workflows/ui-next-seam.yml`, in as many jobs per engine as `scripts/ci/seam-units.mjs` packs to): the REAL Go host in server mode driven by a browser. Scenario `r` is the tool (one shell, the output, ordered input, the size, Escape and F6, the screen-reader mode, flow control with a 50 MB flood hidden, the close question, `Exited with code 3`); `r2` is the emulator against the programs of the machine (less, vim, top, resize in the alternate screen, paste, mouse, the clipboard, wide characters); `r3` is a reload (same pid, byte-exact join under a 3,000,000-line flood, `vim` back); `r4` is a second tab, a host restart and a lease that runs out; `r5` is take it back and the events socket cut for a blip, for a 7 s outage and while the shell is killed. Each scenario has negative controls that trip only their own assertion.

### 1.4 The ledger (merged pull requests, newest first)

| PR | Date | What |
|---|---|---|
| #690 | 2026-11-24 | B-113: `CreateSession` refuses an id another session has |
| #689 | 2026-11-24 | T2d: the panel comes back as it was; "Take it back"; rejoin by offset when the events connection returns |
| #688 | 2026-11-24 | T2b: the page survives a window reload (page key, list, attach, replay, muted replies, input from `next_input_seq`) |
| #675 | 2026-11-24 | T2-go-b: `Attached` and `Listed` carry `next_input_seq`; `CloseSession` dismisses a kept end; two flaky terminal tests fixed at the cause |
| #674 | 2026-11-23 | T2-go: detach, attach, lease, tombstone, offsets, replay with size and modes (host) |
| #673 | 2026-11-23 | SDK4: pin plugin-sdk v0.22.1; a late attach finds the output of a session that ended |
| #672 | 2026-11-23 | T1-go-b: `AckTerminal` after the end succeeds; `SHELL_UNAVAILABLE` carries the shells tried as a list |
| #671 | 2026-11-23 | T2a: the page takes the backend's facts (flow control, hidden terminal, ordered input, typed end, busy fact, size at create) and deletes its guesses |
| #668 | 2026-11-23 | N26b: the terminal units' seconds from the runner |
| #660 | 2026-11-23 | T1: the Terminal panel tool, first slice |
| #658 | 2026-11-23 | T1-go: the host's local terminal states its size, shell, foreground, end and owner |

### 1.5 In flight on 2026-11-24 (check `gh pr list` before you start)

- **Find in the scrollback and the context menu** (slice T3a: Cmd+F with case and regex, next and previous, xterm's search addon loaded lazily; Copy, Paste, Select all, Clear and Find on the kit's unified menu host). Worktree `ui-next-t3a-terminal-find-menu`, no pull request yet. Do not start it again.
- **The Go backend of the terminal channel** (the capability on the calls and the per-terminal stream). Worktree `terminal-channel-backend`, no pull request yet. #693 is its issue.
- **#691**, open: B-110 (the server build keeps a window nobody drains). **#677**, a draft: ownership by window identity, superseded by the channel design.
- **plugin-sdk PR #92** (X3b control frames, X3c replay and lease) on the branch `feature/exec-v2`, open.

## 2. File map

**The page: `ui-next/shell/panel/terminal/`** (xterm.js is imported in one file only, `xtermEngine.ts`)

| File | What |
|---|---|
| `tool.ts`, `index.ts` | the tool: its id, glyph and what the shell exports |
| `TerminalSessions.ts` | the registry of feeds beside the panel model (framework-free): `open(target)`, the feeds, the saved sessions |
| `terminals.ts` | the registry's wiring: the close guard, reattach on load, rejoin on events reconnect, `pagehide` |
| `execFeed.ts` | the one place the wire's rules live: ids chosen here, listeners first, numbered input, acknowledgements, resize settling, attach, replay, rejoin, take back |
| `localShell.ts` | maps the feed's transport onto the host's bindings (`CreateTerminal`, `WriteTerminal`, ...) |
| `pageKey.ts` | the page key, kept in the window's saved state, never in an address or a log |
| `feed.ts`, `state.ts`, `card.ts` | the feed's interface; the words of every state (ended, taken over, lost, ...); the hover card |
| `screen.ts` | the object between a feed and an emulator: frames, flow, the hidden terminal, replay, resize |
| `engine.ts`, `xtermEngine.ts`, `loadEngine.ts` | what the tool needs of an emulator in its own words; the only import of `@xterm/*`; the lazy chunk |
| `keys.ts`, `appearance.ts`, `bytes.ts`, `heldOutput.ts`, `screenReader.ts` | which keys the terminal keeps; theme to colours; base64 to bytes; held output; the screen-reader mode |
| `TerminalBody.tsx`, `TerminalToolbar.tsx`, `ClosePrompt.tsx`, `closeGuard.ts` | the body, the toolbar (Clear, Copy selection), the close question |
| `testing.ts` | the fake feed the tests use |

Beside it: the panel model `ui-next/shell/core/panel/` (pure TypeScript: tools, sessions, `retitleSession`, persistence), the panel's UI `ui-next/shell/panel/`, the notices `ui-next/shell/core/notices/`, the settings `ui-next/shell/settings/`, the session saver `ui-next/shell/session/`.

**The host: `backend/pkg/terminal/`**

| File | What |
|---|---|
| `manager.go` | the manager: start (`launch`, `:469`), the output pump (`read`, `:573`), write, resize, ack, `Busy`, `Cwd`, close, shutdown, signal forwarding |
| `types.go`, `errors.go` | the wire types (`Session`, `End`, `Foreground`, `Directory`, `Launch`, `limits`) and the typed errors |
| `ordered.go` | the ordered input queue (`seq`, 256 operations, 1 MiB, typed refusals) |
| `flow.go` | the credit that paces a terminal; the legacy lane's stall watchdog |
| `pty.go`, `iutf8.go`, `termios_*.go` | the pollable pty master, `IUTF8` |
| `env.go` | the launch environment, the stripped variables, `TERM`, `COLORTERM`, `TERM_PROGRAM` |
| `foreground_*.go`, `cwd_*.go` | the foreground process name; the shell's directory (macOS `proc_info`, Linux `/proc`) |
| `reattach.go`, `reattach_types.go` | detach, attach, lease, tombstone, `ReleaseOwned`, `List` |
| `replay.go`, `modes.go`, `clock.go` | the replay ring by offset; the escape-sequence scanner and the terminal modes; the fake clock |
| `manager_windows.go` | the Windows stub: every call answers `UNSUPPORTED` |
| `*_test.go` | the tests: `start_test.go` (the shell contract), `login_test.go` (the close ladder), `flow_test.go`, `ordered_test.go`, `reattach_*_test.go` (the T2-go matrix, the flood, the storm), `zombie_*_test.go` |

Also: `internal/shellenv/` (`shell.go`: the stated order of choosing a shell and the login arguments; `environment.go`: the launch environment and the probe of the login environment), `internal/settings/terminal.go` (the terminal settings the host declares), `internal/auditgate/policy.json` (the terminal methods are pinned denied for the remote audit gateway), `main.go:263` (`shellenv.RememberLaunchEnvironment`).

**The exec lane: `backend/pkg/plugin/exec/`**

| File | What |
|---|---|
| `service_wrapper.go` | the Wails-bound surface (`ServiceWrapper`): window admission, owner, release on a window's retirement |
| `controller.go` | the controller: plugin sessions and local terminals, the session index (`sessionIndex`, `:92`) |
| `terminal.go` | the local terminal's events: their names, the typed `End`, output with offsets |
| `delivery.go`, `delivery_native.go`, `delivery_server.go` | credit by transport (the server build recognises the socket writer by the caller's stack) |
| `ended_session.go` | a plugin session that ends with nobody attached keeps its output for the first attach |
| `native_terminal.go` | the macOS external terminal for a resource shell (the `nativeApplication` setting); not the panel |
| `adapter_v1.go`, `provider.go` | the protocol-1 (legacy) plugin provider |

**The runtime and the SDK.** `packages/omniviewdev-runtime/src/exec.ts` and the generated bindings; the plugin-sdk exec lane (`pkg/v1/exec` legacy; the v2 contract in `proto/exec/v2` and `pkg/v1/exec` on the branch `feature/exec-v2`); the Kubernetes plugin's legacy exec in `pkg/plugin/exec/` of `omniview-plugin-kubernetes` (branch `feature/ui-next`).

## 3. The contracts, in short

The contracts are `../status/T1-go.md` and `../status/T2-go.md`; this is the digest of what a change most often breaks. Read the sections named.

| Rule | Where it is written |
|---|---|
| **Flow control is required.** A terminal UI turns it on with its first `AckTerminal` (zero bytes is fine) and acknowledges every byte it parses, dropped bytes included; the host pauses the pty at 1 MiB unacknowledged and resumes at 256 KiB. Never acknowledge a replay or a duplicate that was dropped by offset. | `T1-go.md` 2.8.6; `T2-go.md` 2.4 rules 5 and 6; `T2a.md` |
| **Input is numbered.** Count 1, 2, 3 for writes and resizes together; the host applies them in `seq` order whatever order they arrive in; `INPUT_BACKLOG` (429) took no number, send it again; a reattached page continues from `Attached.next_input_seq`, never from the listed number and never from 1. | `T1-go.md` 2.4; `T2-go.md` 2.4 rule 9 |
| **One CLOSE, last.** A typed `End` (`exited`, `signaled`, `closed` with `closed_by`, `failed`), exactly once, after the last output; `closed` wins over what the process died of. A process that holds the pty open does not keep the session alive: the drain is capped at 3 s (`drain_capped`). | `T1-go.md` 2.2 |
| **The busy fact has three states.** `idle` (the shell holds the foreground), `busy{name,pgid}`, `unknown{reason}`: ask on `unknown`. It is a pull, no polling. | `T1-go.md` 2.3 |
| **Release with the window.** A terminal without a page key ends with its window (`closed_by: window`); one with a key is detached and kept for its lease (5 minutes by default, 30 at most), then ended (`closed_by: detach-timeout`). An id is never reused while the host holds a record of it. | `T1-go.md` 2.6; `T2-go.md` 2.5 |
| **Reattach protocol.** Listen first and hold the events; list by key; attach with `from_offset`; apply the answer (reset the emulator, size, a prologue of modes, replay with `onData` muted, resize); then the held events, dropping every one whose bytes the page has; acknowledge live bytes only. | `T2-go.md` 2.4 |
| **The shell contract.** The shell starts from the environment the host was launched with, as a login shell, once (`-i -l`); the host computes nothing the shell computes; `OMNIVIEW_*`, `PLUGIN_*`, `GOWORK`, `WAILS_*`, the launching terminal's identity variables and `TMUX*` are stripped; `PWD`, `IUTF8`; `TERM`, `COLORTERM`, `TERM_PROGRAM`; a shell that cannot start answers `SHELL_UNAVAILABLE` with `tried[]` as tokens (never parse the words). | `T1-go.md` 2.8 |
| **Errors are read by `type` or `code`, never by text.** | `T1-go.md` 2.5 |
| **The key is not a confidentiality boundary.** Every call and event takes a terminal by its id alone; the page key guards List, Attach and Detach only. | `T2-go.md` 2.7 |
| **Producer facts are optional and typed.** A producer that says nothing is the same code path as one that says everything. | `T1.md` section "The producer's side"; `HOW-WE-WORK.md` section 11 |

## 4. Decisions that bind

The owner's rulings and the lead's readings that bind this work, copied word for word from the lead's decision log (`05-owner-decisions.md`, private) with their dates. A line starting "Owner, verbatim" is the owner's own words. The repository's own decisions are `docs/ui-next/decisions.md` (R1 to R20, A1 to A23; A21 and A23 are about the panel's sessions and the reload) and the 38 rules of `docs/ui-next/AGENTS.md`.

### 2026-11-21: producer-side signals belong in the SDK; breaking changes allowed
Owner, verbatim: "anywhere you see where an improvement to the SDK would make a drastic improvement to simplify or signal proper state/status (or just in general) do it there. do not try to infer consumer side when a producer side signal is optimal. you are fine to mean breaking changes".
- REPLACES the standing rule "wire stays strict (no bump)" and the habit of cataloguing backend gaps as WIRE items to work around.
- Rule for agents: when the host/UI would have to GUESS a fact the plugin or SDK knows (caught up, partial coverage, stopped, authenticated, refused, count exactness), stop and add the signal at the producer; delete the consumer-side inference when the signal lands (no double pathway).
- Lead's reading of the limits (to confirm): additive where additive is enough; a breaking change is made once, with a protocol/version bump and a plain refusal for a mismatched plugin, never silently; the plugin's `main` and SDK tags stay the owner's.

### 2026-11-21: the lead may tag the SDK
Owner, verbatim: "you are free to tag a new version if you wish btw if needed to move forward". Lead's reading: `plugin-sdk` tags only, from a green `main` head, after the merge gate and (for anything in the plugin channel/trust area) an independent review; minor for a changed default/new API/wire detail, patch for fixes only. Not read as permission to tag or release the host or any plugin.
- First use: `v0.21.0` on `ae56fb095c665edc0298c7a7e19cfa8bad8aabca` (SDK #79, #80, #81), 2026-11-21; `go test ./...` 29 packages ok before tagging; proxy and checksum database verified after.

### 2026-11-22: Settings is a separate SHEET, not a full page
Owner, verbatim: "the mock had the settings as a full page when it's actually supposed to be a separate sheet like the original application". The mock's `shell-page-settings.js` layout as a tab page is an ERRATUM; its sections, fields, words and form behaviour still apply. The container follows the original application's settings surface (to be read from the legacy `ui/` code, not guessed).
Also: owner asked to parallelise the rest of the shell (terminal, problems, settings, plugins/marketplace, others) alongside the critical-issue work.
- 2026-11-22 (owner's answer to the lead's question, after the old app was read: its Settings is a separate native window, non-modal, 1060 x 640: `backend/window/settings.go:12-58`, `backend/window/wails.go:69-107`): SETTINGS = A SEPARATE NATIVE WINDOW on desktop, NON-MODAL, as the original. The same content is shown as an in-window sheet ONLY where there are no native windows (browser-hosted/server mode). One content component, two containers; no third.

### 2026-11-22: the Terminal need not follow the mock exactly
Owner, verbatim: "for the terminal you don't need to follow the mock exactly but it needs to be an exceptional functional terminal that does what you would expect in an ide". Reading: function and correctness first; the bar is what VS Code's and JetBrains' integrated terminals do; the mock is a guide for placement, tokens and words, not a limit. Probes against the mock stay for the tool's chrome (tabs, toolbar, tokens), not for what the terminal can do.

### 2026-11-22: the SDK's EXEC lane is to be improved at the source, breaking changes included
Owner, verbatim: "if improvements could be made to the ask [SDK] to make it much easier for plugin authors, improve anything like performance or reliability or clean signaling, etc (including anything breaking) that should be done over trying to work around it. this is in reference to the exec functionality just making sure that's known. especially if it helps unlock more powerful terminal integration and agent tool functionality later on". Reading: same principle as the 2026-11-21 ruling, applied explicitly to exec: the exec lane's author API, signals (exit, resize, foreground, cwd, command boundaries), reliability (lifecycle, backpressure, reattach) and a non-interactive 'run a command' shape for agent tools are designed in the SDK; the host and UI do not work around gaps.

### 2026-11-22: exec-lane open questions delegated to the lead ("use your best judgement on the open questions")
Decided by the lead under that delegation (plan: `proposals/SDK2-exec-lane.md` section 9); each is reversible by a setting or a later step unless noted:
1. AGENT `run` TOOL: OFF for every connection until the user turns it on; consent on the EXACT argv for every call; never part of a read-only preset; no setting skips consent; an unknown connection id is off (fail closed). Allow-patterns are a later step.
2. SHELL INTEGRATION: injected into the LOCAL shell (zsh, bash, fish, pwsh) BY DEFAULT with an opt-out in Settings, through the shell's own startup mechanism, never by editing the user's rc files; clean-room scripts (several reference scripts are copyleft); NEVER injected into a remote target unless the user asks for that target.
3. DETACH WINDOW: 5 minutes by default, extendable by the host to 30 per session; a terminal survives a window reload; it does not survive restarting the app and the UI never offers Reattach after a restart.
4. AUDIT: the MCP client's self-declared name is recorded as `declared_client`, labelled unverified, beside the credential id and session id; local only, append-only, 0600, size-rotated; argv digest, no secrets.
5. WINDOWS: the plugin exec lane works on Windows when the interactive step ships (no pty needed); the host's LOCAL terminal on Windows (ConPTY) is scheduled after the local terminal adopts the shared contract.
6. NAMING: keep package `pkg/v1/exec`; new types get non-colliding names; the flip is a deletion plus a few renames (PERMANENT once tagged: reviewed with the X1 contract).
- 2026-11-22: SDK `v0.22.0` tagged by the lead on `f8a3c31ac8287037aa1d7f4effae36c3ed9d7bce` (#83, #84, #85, #82, #86). Before: head of main, linear from v0.21.0, no tag existed, `go test -race ./...` 30 packages ok locally, CI green on that commit (5 jobs incl. race and Windows). After: proxy serves it; module `h1:jfutXTmy7tksyJiB3sb7jp0Kja3PcmSRXL4a9SOKuxg=`, go.mod `h1:4y3rIPpRzF3N1SvC73cjJX1jcp+cnJ4dikaXuKlZs7E=`. GitHub release published with notes.

(`proposals/SDK2-exec-lane.md` is `exec-lane.md` in this folder; its section 9 holds the six questions and the lead's recommendations.)

### 2026-11-22: STYLE RULE (owner): CAVEMAN MODE, always
Owner: "read the caveman skill. you're using too many tokens explaining. just continue with fixes without explaining everything. ensure compaction remembers to include this skill, also with subagents."
- Lead replies: terse. Answer first. Fragments OK. No recap, no narration, no lessons-learned. Only: what merged/failed, blocker, decision needed. Technical substance verbatim (shas, numbers, error strings).
- MUST SURVIVE COMPACTION: any summary of this session keeps this rule in Constraints.
- SUBAGENTS: every brief ends with: "Reply caveman-terse: fragments, facts only, ≤8 lines, no explanation unless a decision is needed." Briefs themselves short: goal, files owned, acceptance, 3-6 items max.
- 2026-11-22 (lead): SDK exec v2 work lands on SDK branch `feature/exec-v2`, NOT `main`, until tag-ready (independent review: any stable tag cut from main after the contract merges would freeze `exec.v2` for good). SDK `main` stays releasable for small fixes. Tag gate list: `reviews/sdk-87-exec-contract.md` 'Follow-up on ed6f26f8'.
- 2026-11-23: SDK v0.22.1 tagged by the lead on 8011c5560dd1a8757de987aedffac6be88ace010 (#89). Before: head of main, linear from v0.22.0, race suite 30 ok locally, CI green (5 jobs). Release published.

(The tag gate list is `exec-tag-gate.md` in this folder. The style rule in practice is `HOW-WE-WORK.md` section 17.)

## 5. Known open defects

The full entries, word for word, with where each stands and who owns it, are in `backend-catalog-terminal.md`. The ones that matter most, in the order they matter:

| ID | What | Owner |
|---|---|---|
| B-111 | A plugin UI in the page, or another window, can read and type into the user's local shell: every call takes the id alone and the output events are broadcast. | #693 |
| B-110 | Terminal output grows the host's memory without bound with a healthy reader that never acknowledges (9.5 GiB in 30 s on the real host); the cause is the windowing library's event queue. A fix for the window half is #691. | #693 |
| B-79, B-87, B-114 | A server-mode page whose events socket reconnects is a new window: window-bound state is lost or refused. Not the terminal's, but it forbids any ownership by window identity. | #693 (for terminals) |
| B-106 | `idle` means "the shell holds the foreground": a suspended vim, a stopped job and a builtin loop read `idle` and a close kills them without a question. | #698, #694 |
| B-107, B-108 | A call with a client id and no events socket is served as the main window; window retirement ends shells one window at a time (12.3 s for 6). | #698 |
| B-90 | The host swallows SIGQUIT (`backend/pkg/terminal/manager.go:981`). | #698 |
| B-88 | Plugin exec sessions (a pod shell) are owned by no window and are not ended when it retires. | #700 |
| B-97 | About 40 sites on the exec, logs, metric and networker lanes carry a plugin's raw error text. | #700 |
| (no B-number) | The CodeRabbit findings of #658 that were valid and not fixed (`startDirectory`, `Delivered`, `CloseSession` timeout, the input queue's gap timer); xterm.js 6.0.0's paste, IME and WebGL gaps; W3, W6 and W8 of the reload; tests decided by time. | #698 |

Closed, so you do not look for them: B-98 and B-99 (SDK #84 and #86, in v0.22.0), B-104 (#658: no host variable reaches the shell), B-113 (#690).

## 6. Done and left

| Feature (`T-terminal-bar.md`) | State | Where |
|---|---|---|
| A real terminal: alt-screen programs, resize, 24-bit colour, wide characters, bracketed paste, mouse, copy and paste, select all, Cmd+K | **done** | T1; seam `r`, `r2` |
| Login shell, user's PATH order, size at create, typed end, busy fact, shell name, `SHELL_UNAVAILABLE` | **done** | T1-go, T2a |
| Flow control; a hidden terminal keeps parsing; ordered input | **done** | T2a |
| Reload survival, takeover, take it back, rejoin, panel restore | **done** | T2-go, T2b, T2d; seam `r3` to `r5` |
| Find in the scrollback, context menu | **in progress** (T3a) | worktree `ui-next-t3a-terminal-find-menu` |
| Capability on every call, a per-terminal stream (B-110, B-111) | **in progress** (backend), page not started | #693 |
| Shell integration: command marks, exit-status gutter, jump, re-run, "command finished", cwd tracking | not started | #694 |
| Shell or profile choice, directory and environment at create, "new terminal here", title from the program, rename, restart an ended terminal | not started | #695 |
| Links: URLs, `file:line:col`, OSC 8, open in the IDE | not started | #696 |
| Font, cursor, scrollback, Option as Meta, bell, GPU choice, copy on select, paste warning | not started | #697 |
| Split panes; terminals in the editor area | not started (the editor area does not exist) | #697 |
| Paste sanitising, `onBinary`, create-once WebGL, IME, accessible view | not started | #698 |
| Agent `run` tool, "last command" | not started (SDK tag first) | #699 |
| Pod exec in the Terminal tool, the shared contract for local and plugin sessions | not started (SDK tag gate first) | #700 |
| Windows local terminal | not started (after the shared contract) | #701 |
| Images (Sixel, iTerm), command completion | not planned | |

## 7. The work

**The epic is #692** ("Terminal: remaining work to an exceptional IDE terminal"). Its children, in the order to do them:

| # | Child | Depends on | Independent review |
|---|---|---|---|
| #693 | One channel per terminal, access by capability (B-110, B-111) | none | yes |
| #694 | Shell integration (command marks, exit status, jump, working directory) | none; after #693 if both are open | yes |
| #695 | Terminals that open where you mean (shell, directory, environment, title, rename, restart) | none; better after #694 | yes (the Go half) |
| #696 | File links and URLs (`file:line:col`, OSC 8, open in the IDE) | #694 for per-command cwd; owner's decision on `openFile` | yes |
| #697 | Settings and panes (font, cursor, scrollback, Option as Meta, bell, renderer, paste, splits, editor area) | #698 for create-once WebGL and the paste path; #695 for the split's directory | no |
| #698 | Hardening leftovers (open B-numbers and review findings) | none; a parallel track | yes (the host items) |
| #699 | Agent tools (bounded `run` tool, "last command") | the SDK exec v2 tag; the plugin's K1b; #694 for "last command"; an owner decision | yes |
| #700 | Pod exec on the SDK exec v2 lane (Kubernetes) | the SDK tag gate; #693 first if open | yes |
| #701 | Local terminal on Windows (ConPTY) | #700's step "the local terminal as a provider" | yes |

Order of work: **#693 first** (it closes B-111 for other windows and for callers that guess a session id, and the memory defect B-110, and it rewrites the transport the others build on; it does not contain plugin UI code that runs in the same page: that stays open under B-112, because plugin UI shares the page's realm, finding R10 in `T-terminal-channel.md`), then **#694**, then #695, #696 and #697 in any order the dependencies allow; **#698 runs beside everything** in small pull requests (do not touch a file another open pull request is editing); **#699, #700 and #701 wait for the SDK**. Two agents never edit `backend/pkg/terminal/manager.go`, `backend/pkg/plugin/exec/terminal.go` or `ui-next/shell/panel/terminal/execFeed.ts` at once: read `gh pr list` first.

**The SDK track** (not in the children, tracked in plugin-sdk and cut by the lead): `feature/exec-v2` holds X1 (#87), X2a (#88), X3a (#90) and X2b (#91); X3b and X3c are PR #92 (open); X4a (scanners) and X4b (integration bootstrap for remote shells) are not started; the tag gate is `exec-tag-gate.md`; the Kubernetes provider spike proved the contract fits (`exec-lane-k8s-proof.md`). The host and the plugin steps (H1a-1 to H-run, K1a to K2 in `exec-lane.md` section 7) start when the lead has tagged and the host has pinned the tag.

## 8. Running and proving things

All from the root of a worktree (`HOW-WE-WORK.md` section 4). Go commands run as `GOWORK=off GOTOOLCHAIN=local go ...`; bindings only through `task bindings`.

```sh
pnpm install --frozen-lockfile && task packages                      # once per worktree; then: git checkout -- packages/omniviewdev-vite-plugin/shims/_omniviewdev__runtime__models.mjs
GOWORK=off GOTOOLCHAIN=local go test ./backend/pkg/terminal/... ./backend/pkg/plugin/exec/... ./internal/shellenv/... -count=1
GOWORK=off GOTOOLCHAIN=local go test -race ./backend/pkg/terminal/ -count=1     # the whole package takes about two minutes under -race
GOWORK=off GOTOOLCHAIN=local go test -tags server ./backend/pkg/plugin/exec/    # the server-build lane (a Wails upgrade must re-run it)
pnpm test ui-next/shell/panel/terminal                                           # the page's tests; the full `pnpm test` is what CI runs
pnpm exec tsc -p tsconfig.app.json --noEmit && pnpm exec tsc -p tsconfig.test.json --noEmit
node ui-next/shell/probes/terminal-probe.mjs                                     # PART=view; FONT_DELAY_MS=40 in front of any probe; clean environment
node scripts/ci/probe-shards.mjs check                                           # every probe and control is in a unit and the manifest
OMNIVIEW_UI=next GOWORK=off GOFLAGS= GOTOOLCHAIN=local task build:server         # the real host: bin/Omniview-server
env -i HOME="$HOME" PATH="$PATH" ENGINES=webkit node ui-next/plugins/e2e/seam.check.mjs   # the whole seam; then ENGINES=chromium; SEAM_TERMINAL_ONLY=r3,r5 SEAM_TERMINAL_REPEAT=5 for the terminal scenarios alone
```

## 9. Traps

- Terminal events go to every window by id; the page key is not a secret against code in the page (B-111). Do not build a feature that assumes either is a boundary until #693 lands, and even then only against other windows and callers that guess a session id: #693 does not hide anything from plugin code that runs in the same page (B-112).
- A server-mode reconnect of the page's events socket is a new window; a native reload keeps its window identity. Anything keyed on a window identity fails on a reconnect.
- The host consumes only released SDK tags. `feature/exec-v2` is not tagged: nothing in the host may pin it.
- xterm.js is `6.0.0` and `@xterm/addon-webgl` `0.19.0`; fixes the study cites as "master only" are not in them (`prior-art.md` section 5, pitfall 3).
- `ui-next/shell/panel/terminal/xtermEngine.ts` is the only file that imports `@xterm/*`; the rest is written against `engine.ts` and tested with a fake. Keep it so.
- Read `docs/ui-next/optimisations.md` section 4 before rewriting any part of the terminal (AGENTS 14).
- A terminal does not survive restarting the app: after a restart every saved terminal tab comes back ended and the UI never offers Reattach (owner decision, section 4).

## 10. Words you will meet

- **The lead**: whoever merges green pull requests, cuts SDK tags, keeps `docs/ui-next/TRACKER.md` and the backend catalog (`HOW-WE-WORK.md` section 2). If you took the epic, you are the lead of your own pull requests.
- **The mock**: the design mock in the private repository `omniviewdev/design-lab` (tag `spec-baseline-2026-11-16`, see `docs/ui-next/AGENTS.md`, "Specification"). It is the acceptance reference for a screen's chrome. For the terminal it is a guide for placement, tokens and words, not a limit (section 4).
- **The flip**: the single moment the new UI (`ui-next/`, `packages/kit`) replaces the old one (`ui/`, frozen). Until then `main` ships one complete product and the new UI reaches users only through the `feature-ui-next` channel (`docs/ui-next/channels.md`).
- **T1 to T6**: the slices of `../status/T-terminal-bar.md` (T1 the first Terminal tool; T2 reload and session identity; T3 find, links, the menu; T4 open where and how a person means; T5 shell integration; T6 settings and the rest). `T1-go`, `T2-go`, `T2a`, `T2b`, `T2d` are the steps that built T1 and T2.
- **Seam**: the check that drives the real Go host with a browser (`ui-next/plugins/e2e/seam.check.mjs`); its scenarios have letters (`r` to `r5` are the terminal's).
- **Probe, unit, control**: a probe drives the page in two engines and asserts; a unit is one probe or set of controls with the seconds it takes on the runner (`scripts/ci/probe-units/`); a control is a deliberate fault the probe must catch with its own assertion (`HOW-WE-WORK.md` sections 5 and 8).
- **The feed, the screen, the engine**: the page's three layers for one terminal: the feed holds the wire's rules and the bytes, the screen turns bytes into frames for the emulator, the engine is xterm.js behind the host's own words.
- **The legacy lane (v1) and exec v2**: the SDK's current exec lane and the new contract on `feature/exec-v2` (`exec-lane.md`). **X, H, K steps** in that plan are SDK, host and Kubernetes-plugin steps.
- **B-number**: an id in the backend catalog (`backend-catalog-terminal.md`).
- **CodeRabbit**: the automated reviewer on every pull request (`HOW-WE-WORK.md` section 12).
