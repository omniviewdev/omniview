# S-tabs: tab management in the new shell

Goal: the tab behaviour the old shell and the mock have, on the tab model `ui-next` already had: context menus, pin and preview cues, keyboard and pointer reorder, a tab that moves to another window, the session strip's menu and reorder. Tracker rows `S-menus` (tab context actions, drag and reorder, pinned and preview cues) and part of `C1-rest` (Next and Previous tab chords).

Worktree `~/Repos/omniviewdev/worktrees/ui-next-tab-management`, branch `ui-next/tab-management`.

## What is built

| Slice | What | Where |
| --- | --- | --- |
| A | Pin and preview cues, the pinned separator; a press or key in the page, or a double-click on the tab, keeps a preview tab (S23, S24) | `shell/tabs/Tab.tsx`, `PageHost.tsx`, `TabStrip.module.css` |
| B | The tab's context menu (S55) and one command list the palette shares | `shell/tabs/commands.ts`, `TabStrip.tsx`, `plugins/host/palette.ts` |
| C | Alt Shift arrows, Home, End move a tab; Reopen, Next and Previous tab chords | `shell/tablist.ts`, `core/tablist.ts`, `core/chords.ts`, `backend/menus/app_v3.go` |
| D | Pointer drag to reorder, across the pinned separator (S45) | `shell/stripDrag.ts` |
| W1 | `how: 'window'` (Shift-click) opens a window; a secondary window closes with its last tab (S30, S64) | `plugins/host/windows.ts`, `core/tabs/close.ts` (`detach`) |
| W2 | Move to new window, Move to window | `windows.ts`, `core/tabs/close.ts` (`adopt`) |
| W3, W4 | A tab dragged out opens a window at the pointer, or joins the window it is dropped on, through the host's drag service | `windows.ts`, `stripDrag.ts`, `backend/window/drag.go` (`EndDrag` names the window that declined) |
| P1 | The session tab's menu: Rename, Stop, Close and the close sets (S118) | `shell/panel/SessionTabs.tsx`, `SessionRename.tsx` |
| P2 | Session tabs reorder by drag and by keyboard | `core/panel/arrange.ts` (`reorderSession`) |

Nothing was copied from `ui/`. Reused as they were: the tab model's `close`, `closeMany`, `reopen`, `duplicate`, `pin`, `reorder`, `keep`, `reload`; the kit menu (`useMenu`, `menuTrigger`); `useTablist`; the Go window service and its bindings. `EndDrag` is the one Go behaviour changed (no binding change).

## Owner decisions (2026-11-25)

- A second window of the workspace kind is allowed (R1 forbids a new window kind, not a second window).
- Split view is deferred: the menu has no Split item and a drag offers no split zone.
- The session menu ships without Move to new window and Move to window.
- A secondary window with a live panel session does not close when its last tab leaves.

## For a later sprint

- **Session menu, Reconnect session and Inspect session** (owner asked for them): nothing in `ui-next` restarts an ended or failed session (`LogStreams.ts` says so; `TerminalSessions.takeBack` is only for a terminal another window took), and there is no inspector surface. They need new session machinery, not wiring.
- **Session menu, Move to new window and Move to window.** BLOCKER, host Go and plugin contract: a terminal's key lives in its window's storage and must not travel in window state, so a move needs a one-time transfer token; a log stream is opened by plugin code in the page, so a move needs the contract to reopen a log target by id.
- **UX question (owner):** should a secondary window whose last tab left stay open because a session is live in it, or close and end the session, or ask?
- **Split view** (S39, S58): the model has no pane; the planners sized it at 2,000 to 3,000 lines.
- **All tabs menu (S49) and New tab menu (S34)**: not in this work. New tab to the right uses the plain new tab until S34 exists.
- **A person's rename of a terminal does not survive a reload**: the saved session has no "renamed" mark, so the program's first status takes the name back.
- **Reopen closed tab on Windows and Linux in the app is Control Alt Shift T.** The app menu's New Terminal Session keeps Control Shift T there, because Wails cannot match the backtick key on Windows (`OEM_3`). On macOS New Terminal Session is Control Shift ` (S43) and Reopen is Command Shift T. A key for New Terminal Session that works on all three would free Control Shift T.
- A window that answers a drop after the 2 s both sides wait can leave the tab in both windows (the old shell's delivery has the same hazard). A window still queued for restore is listed under Move to window and a move to it times out.
- A menu row whose model answer is `confirm` (unsaved changes) does nothing; no page reports a draft yet.
- `core/tabs/selectors.ts` `mounted` follows strip order, as the panel's did before this work: a tab reorder moves mounted page nodes. Not changed here.

## Verified

2026-11-25, macOS arm64, load 3.6 to 6.3 (`uptime`), merged with `origin/main` 2bc9cab00.

- `pnpm test`: 457 files, 10,166 tests pass. `pnpm lint`: 0 errors, the 8 warnings of `main`. Both `tsc` projects and the kit's. Kit `verify`. `go test` and `go vet` of `backend/menus` and `backend/window`.
- `FONT_DELAY_MS=40 node ui-next/shell/probes/strip-probe.mjs`: no failures, WebKit and Chromium, both viewports, with the new drag case.

## Not verified

No native window was run. All of the window work (W1 to W4) exists only natively and was tested against a fake window service and fake drag events. To check on a native build with two windows:

1. Shift-click a sidebar entry: a window opens with that page.
2. Tab menu, Move to new window and Move to window: the tab arrives with its history and pin, the target takes the focus, the source loses the tab only then.
3. Drag a tab out and release over the desktop: a window opens under the pointer. Pointer events must keep arriving outside the window.
4. Drag a tab onto another window's strip: its marker shows the gap, the tab lands there; a release over that window's page keeps the tab; Escape clears both windows.
5. The last tab leaves a secondary window: it closes, unless a session is live in it. The only tab of the main window leaves it empty.
6. macOS: Command Shift T reopens, Control Tab and Command Shift ] step, Control Shift ` opens a terminal once in the old shell. Windows: Control Tab reaches the page.
7. Reorder session tabs with a live terminal on screen: focus and scroll stay.
8. Geometry on a Retina and a mixed-DPI setup, and at a page zoom other than 100%.

Also not run: the panel, rail, shell and kit probes, the Pods cluster check, Windows and Linux.

## Dev tools

- `ui-next/shell/probes/strip-probe.mjs` has a `drag` case (pointer drag in both engines). Its unit's `seconds` in `scripts/ci/probe-units/` is not refreshed.
