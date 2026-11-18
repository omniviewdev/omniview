# Status: S1c (the tab strip in the native Wails window)

- Agent: NativeTabs
- Goal: the tab strip (S1b, PR #535) was verified only in Playwright browsers. Check it in the native Wails window on this Mac (macOS, WKWebView): opens to the plugin's page with no URL parameter, sidebar entry, second tab and switching back, close by button and Delete, Cmd+W / Cmd+T / Cmd+1..9 / Cmd+[ ], Tab order, traffic lights, window drag, whole-window screenshots at default size and 1280 x 800.
- Worktree: `~/Repos/omniviewdev/worktrees/ui-next/s1c-native-tabs`
- Branch: `ui-next/s1c-native-tabs` (base `origin/main` 2846b3aa)
- PR: none (no code change so far)
- Screenshots: `/Users/joshuapare/Notes/omniview/ui-migration/status/S1c-assets/`

## Log

- 2026-11-17: worktree, `pnpm install`, `task packages`. Kubernetes plugin cloned to `/tmp/s1c/plugin-src`, checked out at the CI pin `c69eb69e4b78ea86cd222c9e82e7c65b9e68e480` (`.github/workflows/ui-next-pods.yml`, `KUBERNETES_PLUGIN_REF`), built with its own `hack/package.sh 0.21.2 darwin_arm64`, extracted to `/tmp/s1c/plugin-ext`. Kind cluster `s1c-native-tabs` (kind v0.30.0, node image v1.35.0 by the workflow's digest, kubeconfig `/tmp/s1c/kubeconfig`), `docs/ui-next/slices/1a-pods-list/fixture.yaml` applied. Isolated state root `HOME=/tmp/s1c/home` (`.omniview-feature-ui-next/plugins/{kubernetes,fixture-a-ok}`, `.kube/config` with the kind context only). Host built `OMNIVIEW_UI=next task build OUTPUT=/tmp/s1c/build/Omniview`, bundled as `/tmp/s1c/app/Omniview-S1c.app` (distinct `CFBundleIdentifier` `dev.omniview.s1c.nativetabs`, ad-hoc signed). No `main.tsx` patch is needed any more: `ui-next/main.tsx` opens the plugin host with no parameter (finding F1 of N12a is closed by N19d).
- 2026-11-17: app started (pid below), **BLOCKED: the Mac session is locked** (below). Code-side audit done (below). Native observations not made yet.

## Blocker: why `screencapture` returned blank (N12a) and fails now

`screencapture -x -o -l <window id>` printed `could not create image from window`, and a full-screen `screencapture -x` was black. Cause: **the login session is locked and the display asleep**, not permission, window id or Space.

- `CGPreflightScreenCaptureAccess()` = true and `AXIsProcessTrusted()` = true for the terminal host (`perm.swift.txt`): permissions are fine.
- `CGSessionCopyCurrentDictionary()` says `CGSSessionScreenIsLocked 1`, locked at 18:18 (about 2.5 h before the run); `CGDisplayIsAsleep` = 1; `sysadminctl -screenLock status`: "screenLock delay is immediate" (`sess.swift.txt`).
- `caffeinate -u` wakes the display: then `-l <window id>` returns an image, but a full capture shows the lock screen, and the window's image is the empty dark window with grey (inactive) lights: a locked session never paints the WKWebView, and CGEvents go to loginwindow. So neither the pictures nor the keys and mouse of this task can be taken while the session is locked. I do not enter a password.
- Needed: the owner unlocks the Mac and leaves it unlocked. I hold the display awake with my own `caffeinate -d -u` (pid below).

## Audit: where the app menu is defined and what is bound (read from source; the behaviour is [INFERENCE] until observed natively)

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

## Observations (yes / no / could not check)

Not made yet (session locked). To be filled in when the session is unlocked.

## Processes and resources I started (stop them by PID, delete only my cluster)

- App: pid 4397 (`/tmp/s1c/app/Omniview-S1c.app/Contents/MacOS/Omniview`), its plugin child pid 4561.
- `caffeinate -d -u -t 3000`: pid 8580.
- Kind cluster `s1c-native-tabs` (kubeconfig `/tmp/s1c/kubeconfig`). Other clusters and hosts (`s1b-tab-strip`, `/tmp/s1b-cluster`, `Omniview-server` 44989 and its plugin 45000, the Native Lab) are not mine.

## Dev tools

| Tool | What | Where | Keep? |
|---|---|---|---|
| Lock and permission probe | `perm.swift.txt` (screen-capture and Accessibility trust), `sess.swift.txt` (session lock, display sleep) | `docs/ui-next/status/S1c/` | Yes: first thing to run when `screencapture` returns blank or `-l` fails |
| Event driver, window finder, capture | N12a's `ev.swift.txt`, `winlist.swift.txt`, `screencapture -x -o -l <id>` | `docs/ui-next/status/N12a/` | reused unchanged |
| Run natively | the N12a sequence, with the pinned plugin built by `hack/package.sh` and the fixture plugin by `node -e "import('./ui-next/plugins/fixture/build.mjs').then(m => m.writePlugin(dir, 'fixture-a-ok'))"` | this file, Log | |
