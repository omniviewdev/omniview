# Status: S1c (the tab strip in the native Wails window)

- Agent: NativeTabs
- Goal: the tab strip (S1b, PR #535) was verified only in Playwright browsers. Check it in the native Wails window on this Mac (macOS, WKWebView): opens to the plugin's page with no URL parameter, sidebar entry, second tab and switching back, close by button and Delete, Cmd+W / Cmd+T / Cmd+1..9 / Cmd+[ ], Tab order, traffic lights, window drag, whole-window screenshots at default size and 1280 x 800.
- Worktree: `~/Repos/omniviewdev/worktrees/ui-next/s1c-native-tabs`
- Branch: `ui-next/s1c-native-tabs` (base `origin/main` 2846b3aa)
- PR: see the pull request of this branch (docs only; no code changed)
- Screenshots: `/Users/joshuapare/Notes/omniview/ui-migration/status/S1c-assets/`

## Log

- 2026-11-17: worktree, `pnpm install`, `task packages`. Kubernetes plugin cloned to `/tmp/s1c/plugin-src`, checked out at the CI pin `c69eb69e4b78ea86cd222c9e82e7c65b9e68e480` (`.github/workflows/ui-next-pods.yml`, `KUBERNETES_PLUGIN_REF`), built with its own `hack/package.sh 0.21.2 darwin_arm64`, extracted to `/tmp/s1c/plugin-ext`. Kind cluster `s1c-native-tabs` (kind v0.30.0, node image v1.35.0 by the workflow's digest, kubeconfig `/tmp/s1c/kubeconfig`), `docs/ui-next/slices/1a-pods-list/fixture.yaml` applied. Isolated state root `HOME=/tmp/s1c/home` (`.omniview-feature-ui-next/plugins/{kubernetes,fixture-a-ok}`, `.kube/config` with the kind context only). Host built `OMNIVIEW_UI=next task build OUTPUT=/tmp/s1c/build/Omniview`, bundled as `/tmp/s1c/app/Omniview-S1c.app` (distinct `CFBundleIdentifier` `dev.omniview.s1c.nativetabs`, ad-hoc signed). No `main.tsx` patch is needed any more: `ui-next/main.tsx` opens the plugin host with no parameter (finding F1 of N12a is closed by N19d).
- 2026-11-17: app started, **blocked by a locked Mac session** (below); code-side audit done. The owner unlocked it; the checklist ran natively and is recorded below; app, caffeinate and cluster stopped.

## Blocker: why `screencapture` returned blank (N12a) and fails now

`screencapture -x -o -l <window id>` printed `could not create image from window`, and a full-screen `screencapture -x` was black. Cause: **the login session is locked and the display asleep**, not permission, window id or Space.

- `CGPreflightScreenCaptureAccess()` = true and `AXIsProcessTrusted()` = true for the terminal host (`perm.swift.txt`): permissions are fine.
- `CGSessionCopyCurrentDictionary()` says `CGSSessionScreenIsLocked 1`, locked at 18:18 (about 2.5 h before the run); `CGDisplayIsAsleep` = 1; `sysadminctl -screenLock status`: "screenLock delay is immediate" (`sess.swift.txt`).
- `caffeinate -u` wakes the display: then `-l <window id>` returns an image, but a full capture shows the lock screen, and the window's image is the empty dark window with grey (inactive) lights: a locked session never paints the WKWebView, and CGEvents go to loginwindow. So neither the pictures nor the keys and mouse of this task can be taken while the session is locked. I do not enter a password.
- After the unlock (`CGSSessionScreenIsLocked` absent) the same commands capture the real window with its lights; every capture of this run printed its lock state.

## Audit: where the app menu is defined and what is bound (read from source; confirmed against the running app below)

The menu is built once and shared by every window: `backend/menus/app_v3.go` `SetupAppMenu` (called from `main.go:880`), plus `backend/menus/keybindings_v3.go:15`. `UseApplicationMenu: true` (`main.go:846`). On macOS (`app_v3.go:48-66`) it adds the roles App, Edit and Window, then a custom View menu (`:75-132`).

| Chord | Bound to today | Where |
|---|---|---|
| Cmd+W | **nothing**. The macOS Window role is Minimize, Zoom, separator, Bring All to Front (`wails/v3@v3.1.0/pkg/application/roles.go:139-147`); the Close role (`CmdOrCtrl+w`, `menuitem_roles.go:168-170`) is only added on other platforms (`roles.go:149`, and the File role `roles.go:68-73`), and `SetupAppMenu` adds a File menu only when `GOOS != darwin` (`app_v3.go:67-72`). So no menu item claims it on macOS and the page's keydown (`ui-next/shell/tabs/useTabChords.ts`, `core/chords.ts:35-59`) should see it: [INFERENCE], to observe |
| Cmd+T | nothing (only Cmd+Shift+T: New Terminal Session, `app_v3.go:109`, and the standalone binding `keybindings_v3.go:15`) |
| Cmd+1 .. 9 | nothing in the menu; page chord `jump` / `last` (`core/chords.ts:52-58`) |
| Cmd+[ and Cmd+] | nothing in the menu, and nothing in the page (Back and Forward chords are "next" in S1b) |
| Cmd+Shift+W | nothing; the page treats Shift as another chord and ignores it (`chords.ts:37`) |
| others claimed | Cmd+, Settings (`app_v3.go:60`); Cmd+R Reload, Cmd+Shift+F Force Reload, Cmd+Plus/-/0 zoom, Cmd+Shift+T, Cmd+Shift+B, Cmd+Alt+B, Cmd+Shift+S (`app_v3.go:78-129`); from roles: Cmd+H, Cmd+Alt+H, Cmd+Q, Cmd+M, Cmd+Z, Cmd+Shift+Z, Cmd+X/C/V, Cmd+Alt+Shift+V, Cmd+A, and **Delete: `backspace`** (`menuitem_roles.go:113-115`, in the Edit role) |

Two things to observe because of this audit: (1) whether the Edit role's `backspace` accelerator takes Backspace from a focused tab before the page (Delete is not an accelerator); (2) if Cmd+W does reach the page, what the last tab's close does, and that the main window is hide-on-close (`backend/window/wails.go:126`), so the red light hides the window rather than quitting.

## Observations (macOS 27.0.1 arm64, WKWebView `AppleWebKit/605.1.15`, 1x display, `AppleKeyboardUIMode` unset; the session was unlocked for every capture: `s.sh` prints `CGSSessionScreenIsLocked` with each shot and it was 0 every time)

Assets: `/Users/joshuapare/Notes/omniview/ui-migration/status/S1c-assets/`. Two builds ran on the same state root: a clean one (the first pictures) and one with the N22 overlay (`ui-next/n22-debug.ts`, extended to log `keydown` with `defaultPrevented` and the tab count 150 ms later, `visibilitychange`, `beforeunload`, scroll offsets); the overlay is the green block at the bottom right and was never committed.

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Opens to the plugin's contributed page, no URL parameter | **yes**: one tab "Pods", sidebar `Resources > Workloads > Pods`, 25 Pods, status bar `Kubernetes > Pods`. With the fixture plugin also installed the window opens on the **fixture** plugin's Items page (plugins sort by id), so the fixture plugin loads in the native build: **yes**. The window has no rail or other way to reach the other plugin | `01-whole-window-default-kubernetes-only.png`, `00-fixture-plugin-first-page-with-both-plugins-installed.png` |
| 2 | Sidebar entry opens the Pods tab | **yes, with a limit**: a click on Pods while the Pods tab is open keeps one tab and its scroll (170 stayed 170). Closing the only tab (Cmd+W) reopens the home page at once (see 5), so "sidebar opens a tab from an empty strip" **could not be observed** | `04-sidebar-click-on-open-pods-one-tab.png`, `18-sidebar-click-one-tab-dbg.png` |
| 3 | Second tab; switching back restores scroll and live rows | **yes**: `+` opens a second Pods tab; tab 1 scrolled to 170, switched to tab 2 and back: 170 (scroll log `top=170`); a pod `s1c-live-pod` created while tab 1 was hidden was listed (`All 26`) when it came back | `06-plus-second-tab.png`, `13-…`, `14-…`, `15-back-on-tab1-middle-scroll-restored.png`, `12-back-on-tab1-scroll-and-live-rows.png` |
| 4 | Close by button; by Delete on a focused tab | **yes**: the close button closes (tab 2 of 2). Delete (the Mac "delete" key, `Backspace`, code 51) on a focused tab closes it and the focus goes to the neighbour (`defaultPrevented=true`, tabs 2 to 1): **the Edit menu's `Delete` item (accelerator `backspace`, `menuitem_roles.go:113-115`) does not take it before the page**. Forward Delete (Fn+Delete, code 117) closes the focused tab too (3 tabs to 2) | `33-close-by-button-strip-before-after.png`, `17-backspace-key-on-focused-tab2.png`, `25-fn-delete-forward-delete-on-focused-tab2.png` |
| 5 | **Cmd+W: tab or window?** | **the TAB.** The page gets the keydown (`Cmd+w code=KeyW prevented=true`) and closes the tab on screen, also with focus in the search field; the window never closes and nothing in the native menu is bound to it. On the **last** tab it closes it and the shell reopens the home page at once (the list is back at scroll 0 and the log says tabs 1 to 1): the window stays. Cmd+Shift+W does nothing (`prevented=false`, window stays) | `07-cmd-w-with-two-tabs.png`, `19-cmd-w-on-only-tab-dbg-log.png`, `32-cmd-w-with-focus-in-search-field.png`, `24b-top-row-before-vs-after-cmd-t-and-cmd-shift-w.png` |
| 6 | Cmd+T, Cmd+1..9, Cmd+[ and Cmd+] | Cmd+1, 2, 3 jump to tab 1, 2, 3 and Cmd+9 to the last: **yes**. Cmd+T opens **no** tab (its keydown arrives `prevented=true` from something I did not find: not in `ui-next`, the kit or the plugin source; [INFERENCE] a Wails runtime or WebKit default). Cmd+[ and Cmd+] do nothing (`prevented=false`): the Back and Forward chords are not built (S1b "next") | `22-strips-before-cmd1-cmd2-cmd3-cmd9.png`, `24-strips-after-cmd9-cmdT-cmd-lbracket-cmd-rbracket-cmd-shift-w.png`, log in `25-…png` |
| 7 | Cmd+R (recorded, not changed) | reloads the whole window (View > Reload, `app_v3.go:77`): two open tabs become **one fresh home Pods tab**; the overlay log restarted. No tab session is restored (persistence is not built) | `26-before-cmd-r-2-tabs-scrolled.png`, `27-after-cmd-r-4s.png` |
| 8 | Tab order, default macOS setting | **yes**: Back, Forward (both `aria-disabled`, still stops), the tab, New tab `+`, the sidebar tree item, Refresh Pods, the `All 26` chip, Search Pods (then the table region). The tab's close control is not a stop (decision A14 exception). Shift+Tab reverses it | `28-tab-order-forward-8-presses.png`, `29-shift-tab-twice-after.png` |
| 9 | Stand-in dots hidden, real lights centred | **yes**: one set of lights, no stand-in (`TopRow.tsx` draws `standIn` only when `!isNativeWindow()`). Measured on the 1280 px shot: light centres x 19, 42, 65 and y 20 (the row is 40 px, centre 20); the tab face spans y 5 to 33, centre 19, so the lights are centred on the row and 1 px lower than the tab faces. This is the picture N12a could not take (see Blocker) | `03-traffic-lights-crop-default-4x.png`, `02-whole-window-1280x800.png` |
| 10 | Drag | **yes**: dragging from the empty part of the strip (right of the `+`) moved the window by (+100, +60) and back; dragging a tab by the same amount left the window at (1600, 196) | `30-after-drag-from-empty-strip-moved.png`, `31-after-drag-of-a-tab-window-unmoved.png` |
| 11 | Whole-window screenshots | default size 1919 x 1079 (`DefaultWebviewWidth/Height` 1920 x 1080, `main.go:75-76`); asking for 1280 x 800 through Accessibility gives a **1280 x 808** window (the page's `inner=` reads 1281 x 809; N12a measured 1280 x 800: not re-checked why) | `01-…`, `02-…` |
| 12 | Console | the overlay saw one `ResizeObserver loop completed with undelivered notifications` at the first layout and no other error | log in `05b-cmd-w-only-tab-with-key-log.png` |

## Menu bar, as the running app reports it (Accessibility; `menu-bar-accelerators-from-accessibility.txt`)

Accelerators the app has on macOS: Settings (Cmd+,), Hide, Hide Others, Quit, Undo, Redo, Cut, Copy, Paste, Paste and Match Style, Delete (backspace), Select All; Window: Minimize (Cmd+M), Minimize All, Fill, Center; View: Reload (Cmd+R), Force Reload (Cmd+Shift+F), Zoom In, Zoom Out, Reset Zoom, New Terminal Session (Cmd+Shift+T), Minimize Bottom Menu (Cmd+Shift+B), Maximize Bottom Menu (Cmd+Alt+B), Close Sidebar (Cmd+Shift+S), Enter Full Screen. **None for Cmd+W, Cmd+T, Cmd+1..9, Cmd+[ and Cmd+]**: the page owns them. Defined in `backend/menus/app_v3.go:38-135` (View menu `:75-132`; no File menu on macOS, `:67-72`; role menus `:48-66`), `backend/menus/keybindings_v3.go:15` and, for the roles, `wails/v3@v3.1.0/pkg/application/roles.go:139-147` (the Window role: Minimize, Zoom, Bring All to Front, no Close).

## Cmd+W: the asked question is answered; two gaps against the VS Code and JetBrains rule, not changed

Cmd+W closes the tab, not the window, so the fix the assignment describes for the window case is not needed and no code changed. Against "Cmd+W closes the active tab; the window closes when the last tab closes or by Cmd+Shift+W" two things differ, and neither is small and inside `OMNIVIEW_UI=next`:

1. Closing the last tab reopens the home page instead of closing the window (the model's "an empty strip opens the home page when one is offered", `ui-next/shell/core/tabs/store.ts:40` and the host). Changing it needs a window-close binding that the plugin host does not have, and a product decision: proposed rule for the lead: on the last tab Cmd+W hides the window as the red light does (`backend/window/wails.go:126` keeps main hide-on-close), under `OMNIVIEW_UI=next` only.
2. Cmd+Shift+W closes nothing, and macOS has no Close Window item (the Window role lacks it, `roles.go:139-147`; the File menu exists only off macOS, `app_v3.go:67-72`). A "Close Window" item with Cmd+Shift+W in `SetupAppMenu` is a Go change both UIs get; I did not run the old UI to prove it does not collide with its own Cmd+W.

## Not verified

Retina, light themes, Windows and Linux; the fixture plugin as a second plugin in the strip (the window has no way to reach it); trackpad scroll (wheel events came from CGEvent); why the frame is 808 and not 800 high; the source of Cmd+T's `preventDefault`; the tab context menu and reorder (not built).

## Stopped

App pid 46102 (debug bundle; earlier 4397 and 38290, clean bundle) and its plugin children, `caffeinate` 37617 (8580 had already exited): stopped by PID. Kind cluster `s1c-native-tabs` deleted; `kind`, `omniview-arch-20261110`, `omniview-load-lab` and `s1b-tab-strip` left. Local edits to `ui-next/main.tsx` and the overlay file reverted, not committed. `/tmp/s1c` kept.

## Dev tools

| Tool | What | Where | Keep? |
|---|---|---|---|
| Lock and permission probe | `perm.swift.txt` (screen-capture and Accessibility trust), `sess.swift.txt` (session lock, display sleep) | `docs/ui-next/status/S1c/` | Yes: first thing to run when `screencapture` returns blank or `-l` fails |
| Event driver, window finder, capture | N12a's `ev` extended with modifiers (`ev key <code> cmd,shift,alt,ctrl,fn`) and `ev scroll x y delta n`; N12a's `winlist`; `s.sh` (capture of the window of the current pid, prints the lock state) | `docs/ui-next/status/S1c/ev-modifiers.swift.txt`, `s.sh.txt` | Yes: replaces N12a's `ev` |
| Debug overlay (extended) | N22's overlay plus `keydown` with `defaultPrevented` and the tab count, `visibilitychange`, `beforeunload`, scroll offsets | local `ui-next/n22-debug.ts`, not committed | same decision as N12a and N22 |
| Menu bar dump | the app's accelerators through Accessibility (`osascript`, `AXMenuItemCmdChar`) | output in `S1c-assets/menu-bar-accelerators-from-accessibility.txt` | Yes |
| Run natively | the N12a sequence, with the pinned plugin built by `hack/package.sh` and the fixture plugin by `node -e "import('./ui-next/plugins/fixture/build.mjs').then(m => m.writePlugin(dir, 'fixture-a-ok'))"` | this file, Log | |
