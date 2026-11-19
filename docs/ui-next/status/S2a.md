# Status: S2a (the activity rail, an empty window that does not trap, no reload in a packaged build)

- Agents: ActivityRail (wrote the code, died on a rate limit with one commit pushed), ActivityRail2 (resumed 2026-11-18: verified, fixed what the verification found, shipped).
- Goal: (1) a rail in the reserved 40 px track with one entry for each plugin that contributes, so a second plugin is reachable; (2) decision A17: closing the last tab leaves an empty state, Command W on it closes the window (macOS; see the amendment below), macOS gets Close Window (Cmd+Shift+W); (3) decision A18: no Cmd+R whole-window reload in a packaged build, kept in a development one.
- Worktree: `~/Repos/omniviewdev/worktrees/ui-next-s2a-activity-rail`
- Branch: `ui-next/s2a-activity-rail`, base `origin/main` 7e4bd00f (no rebase needed on 2026-11-18)
- PR: https://github.com/omniviewdev/omniview/pull/539 (ready, against `main`)
- Native: **pending: session locked.** At 06:06Z on 2026-11-19 `CGSSessionScreenIsLocked` still read 1 (display awake). Everything for the run is prepared and left running (see "Native check"); every native claim in this file is **unverified** until that section holds results. Screenshots go to `/Users/joshuapare/Notes/omniview/ui-migration/status/S2a-assets/`.
- Decisions A17 and A18 are now in `decisions.md`; `docs/ui-next/backend-catalog.md` and working rule 22 of `AGENTS.md` are added by this PR (lead's assignment).

## Log

- 2026-11-17 (ActivityRail): worktree, `pnpm install --frozen-lockfile`, `task packages`. Read AGENTS, decisions, S1c, the shell and plugin READMEs, the mock's chapter 16 and its rail (`core.css` `.frame__rail`, `shell-kubernetes.js:286`, measured in Chromium at 1440 x 900: track 5,40,40x823; entries 37x40 from the track's left edge, `padding 5 2 5 5`, face radius 6, hover `--hover-toolbar`, open `--pressed`, open and focused `--accent`, focus ring 2 px accent offset 2 px on the face).
- 2026-11-17: Go menu change by a sub-agent (`GoMenuA17A18`), reviewed and changed by ActivityRail; contract, shell rail, host rail model, empty window, model rule, tests, lint; committed and pushed (3ccc441a). Stopped on budget.
- 2026-11-18 (ActivityRail2): the index held a stale duplicate of two files (worktree equal to HEAD): cleared. PR #539 opened at once.
- 2026-11-18: **defect found by `pnpm --filter @omniviewdev/kit run verify`, which the first run had not made**: the shell README named the mock's first plugin screen with the word of its domain, which the vocabulary guard (A13) rejects; CI's "Kit contracts" step would have failed. Fixed.
- 2026-11-18: rail parity reference against the mock (`mock-rail.json`, `mock-rail-measure.mjs`, `rail-probe.mjs`, CI step), the two-plugin late-registration check in the strip probe's load cases (`lateMs`, `first`), a rail scenario in `seam.check.mjs` on the real Go host, and a defect it found: a rail entry's sidebar inherited the open groups of the previous entry's when the two sidebars share a name and ids (test first, then `Sidebar`'s `owner` key). One CodeRabbit comment (the tree did not reveal a current entry that arrives with later nodes) fixed test first. Squashed to one commit.
- 2026-11-19 (lead's instruction, by principle A17): the close chord on the empty window is a **no-op off macOS** (`useTabChords`: the shell's own platform detection, `platformOf(navigator)`; unit tests for both branches in `chords.test.tsx` and `PluginHost.test.tsx`). macOS keeps the behaviour. The Go-side BLOCKER stays in the Backend catalog.

## What is done and how it was checked

"First run" is what ActivityRail recorded; "Run 2" is what ActivityRail2 ran on 2026-11-18 at the head of the PR.

| Part | Result | Checked by |
|---|---|---|
| Contract: `rail?: true \| RailV1` (`icon`, `label?`, `order?`), a minor addition with the rule comment in `contract/v1.ts`; admission refuses a malformed entry by name; a bundle with `rail: true` or none is admitted as before | done | first run: `admit.test.ts`. Run 2: also a real bundle built outside the host with `rail: { icon, label, order }` is admitted by the real Go host (`seam.check.mjs`, both engines) |
| Shell `Rail` (kit `RovingGroup` column: one Tab stop, arrows rove, no wrap, Home and End; `aria-current`; tip via the shared host with `delay: 0`; F6 region landing on the current entry; mock paint states) | done | first run: `Shell.test.tsx`, shell probe, strip probe. Run 2: **`rail-probe.mjs` against the mock's two rails at 1440 x 900 and 1280 x 800 in WebKit and Chromium: geometry 0 px off (the largest difference is 0), paint exact in six states**; negative control (six injected differences, six failures) |
| Host rail model `plugins/host/rail.ts`: entries ordered by the declared `order` (those without after, by name then id, plain text compare), default selection, `firstPlugin` used by `home()` | done | `PluginHost.test.tsx` (declared order, not id order). Run 2: strip probe, two plugins, the second registering 700 ms late and sorting after or before the first: the window opens on the first plugin of the declared order, the rail lists both in that order |
| Sidebar follows the rail; choosing an entry shows that plugin's tree and closes no tab; tabs of several plugins coexist; activating a tab selects its plugin | done | `PluginHost.test.tsx`; run 2: `seam.check.mjs` on the real host (two real bundles): choose the second entry, its sidebar shows, one tab stays, its entry opens its page in a second tab, activating the first tab makes its plugin current |
| Late registration moves nothing | done | run 2: strip probe load cases, WebKit and Chromium, both viewports: no region moves, no rail entry moves, layout shift 0. **Not covered** (below): a tab already open when a late plugin sorts first |
| A17 model: `TabsState.started`; `ensureHome` is a start-up rule only; closing the last tab leaves the strip empty; nothing reopens a page by itself | done | `close.test.ts`, `store.test.ts`, `fuzz.test.ts`, `TabStrip.test.tsx`; run 2: `seam.check.mjs` (close the last tab, wait 1.5 s: still no tab) |
| A17 empty window (`NoTabs`); Command W on it closes the window on macOS (`Window.Close()` from the runtime, native only) and **does nothing on Windows and Linux** | done in the shell; **the native close is checked under "Native check"** | `chords.test.tsx` and `PluginHost.test.tsx` test both branches (a Mac closes once and only when no tab is left; `Win32` and `Linux x86_64`, Control W and the web alternate, call nothing); the real host in a browser (no native window: the chord does nothing, no error) |
| A17 macOS: File > Close Window, Cmd+Shift+W | done in Go | `backend/menus/app_v3_test.go`: the File menu holds Close Window with the library's rendering of the chord; the click closes the focused window once |
| A18: View > Reload (Cmd+R) only in a development instance | done in Go | `app_v3_test.go`: the development View menu equals the old View menu item by item (compared by hand with `git show 7e4bd00f:backend/menus/app_v3.go`: labels, chords, separators, order); packaged equals it minus Reload; negative control. `Kind` is `"development"` only for the dev-workspace instance (`internal/instance/profile.go:116`) and `"production"` for every channel (`:174`) |
| Tree reveals the current entry when it changes into a closed group, and when it first appears in the nodes | done | `Shell.test.tsx`, `PluginHost.test.tsx` |

### What "close" does (A17), as far as it could be read

On macOS, Command W with no tab calls `Window.Close()` (the runtime's, only in the native window). Wails runs the window's closing hook (`backend/window/wails.go:126`, `attachMainWindow`), which **cancels the close and hides the main window**: the app keeps running, as with the red button. Settings hides the same way; any other window closes. The menu's Close Window calls `Close()` on the focused window, so it does the same. The hidden window comes back with a click on the Dock icon: Wails shows every hidden window when the app is reopened with none visible (`wails/v3@v3.1.0/pkg/application/events_common_darwin.go:30`).

On **Windows and Linux the shell does not ask for the close**: Control W on the empty window does nothing (the lead's amendment of A17, 2026-11-19), because the main window would hide and nothing in the app shows it again (no tray, no `OnSecondInstanceLaunch`): see the Backend catalog, item 1. **Inferred from the code, not run on Windows or Linux.**

### What the first run had verified, and what it had not

Verified by the first run (and re-run by me where the table says so): the unit tests (`pnpm exec vitest run ui-next`), both tsc projects, eslint on the new trees, `lint:ui-policy`, `lint:css`, the shell and strip probes, `go vet` and `go test ./backend/menus/` and a build of the root package.
Not verified by it, run by me: the full root `pnpm test`, `pnpm lint`, the kit's `verify` (**this one failed**, above), `task check:ui-build`, the React Compiler and flavour guards, the kit, table, fonts, tooltip and detail probes, the seam check, `task check:go-build`, `check:go-vet`, `check:go-test` (all packages), `check:go-test-devcontrol`, `check:fmt-check`; the rail against the mock and the two-plugin late check (written by me); the native window (not run: the session was locked).

## Known differences from the mock (for the errata pass)

1. **The mock says the host has no rail** (S7, A11, L4a: a plugin may bring its own); the owner asked for a rail that reaches every plugin. Written in the shell README, decision 1.
2. **Glyph size**: 20 px (ch12 section 4, the mock's second plugin rail, `railHtml()`); the mock's first plugin screen draws 16 px (`H.ibtn small`) at the same centre. The probe compares the rectangle with the 20 px rail and the centre with both.
3. **Where a rail tip opens**: the mock opens it to the right of the tool (`data-tooltip-placement="right"`); the kit's tooltip host opens below its trigger and `tip` has no side option. Not compared by the probe. A kit addition (`tip(text, { side })`, with its API report) is the fix; not built.
4. **The mock's rail is a `role="toolbar"`** named for its plugin; the shell's is a named group of buttons in a plain wrapper, so axe reports `region` (moderate) on the wrapper, as the mock's rail would. A named landmark (`nav`) on the wrapper is the fix; not built.
5. **Host entries** (Home, Plugins, Settings, Developer Tools; Search and All tabs in the top row) are not drawn: none has a page in `ui-next` yet. They would lead the rail.

## Choices I (the first run) made where the brief or the mock left room (please confirm)

1. **Dev versus packaged** (A18) is `profile.Descriptor.Kind == "development"` (`main.go:885`), the instance launched from a dev workspace, not `version.IsDevelopment()`: nightly, feature-channel and PR builds carry `Development=true` (`.github/workflows/pr.yml:150` and the others), so the flag would keep Cmd+R in the very channel that ships the new UI. **Force Reload (Cmd+Shift+F) stays in both**: A18 names Cmd+R; say if it should go too.
2. **A18 reaches the OLD UI too.** The app menu is shared and the Go side does not know which frontend it serves, so a packaged build of the old UI (the stable channel) also loses View > Reload. Everything else in the old UI's menu is unchanged (tested). If the old UI must keep Cmd+R until the flip, the host needs a signal for the frontend flavour (an ldflag set by the `OMNIVIEW_UI=next` workflows); not built. **Decision for the lead.**
3. **Where the entry lives in the contract**: `rail` (so a host without it refuses by name, rule (3) of the contract's minor-addition rule), not `plugin`. `true` and no `rail` give the host's glyph (`box`) and the plugin's name.
4. **Entries appear with the first tab** (or when the window has settled empty): until then the 40 px track is reserved and empty, so a plugin that registers late moves nothing; the first plugin is chosen once every plugin has settled (as `home()` already did).
5. **File menu on macOS** holds only Close Window (the Window role has none, there is no File menu on macOS today). No Close Window item was added on Windows or Linux (their File menu holds Settings).
6. The empty window offers "Plugins you can open" only. Not built (no source or destination yet): Get started (Search, Install plugins, Settings, a terminal), Recent (recently closed tabs: the model has them, `reopen({ id })`), Connections in use, the purpose line under a plugin.

## Backend catalog

Class: BLOCKER = the UI cannot behave properly without it, TANGENTIAL = an independent gain or fix, WIRE = changes the plugin protocol. For the lead to add to `docs/ui-next/backend-catalog.md`.

| Class | Where | What | Evidence | Interim in the UI |
|---|---|---|---|---|
| BLOCKER (A17 on Windows and Linux) | host Go: `backend/window/wails.go:126-131` (`attachMainWindow`), `main.go:319-323` (`SingleInstanceOptions` with no `OnSecondInstanceLaunch`) | The main window hides on close on every OS, and only macOS has a way back (the Dock reopen of the Wails library). A hidden Windows or Linux main window is a running process with no window, no tray, and a second launch that exits without showing it. Fix on the Go side: show the main window from `OnSecondInstanceLaunch`, or quit when the main window closes on those OSes, or a tray item. **The same hide-with-no-way-back may already apply to the window's close button in the SHIPPED app on Windows and Linux** (the hook is unconditional): inferred from the code, unverified. | No tray or second-instance handler (`grep SystemTray\|SecondInstance` finds none); Wails shows hidden windows on reopen only on macOS (`pkg/application/events_common_darwin.go:30`); `single_instance.go:96` calls the handler only when set. **Inferred from the code, not run on Windows or Linux.** | the new shell's close chord on the empty window is a **no-op off macOS** (`useTabChords`, unit-tested both ways); macOS keeps it |
| TANGENTIAL | the Kubernetes plugin, `omniview-plugin-kubernetes` `feature/ui-next`: `ui/src/entry.ts:8` and the vendored contract `ui/src/contract/v1.ts:80-81` (`rail?: true`) at the pin c69eb69e | The plugin declares no rail entry: its icon and place are the host's defaults (`box`, after every plugin that declares an `order`). Re-vendor the host's contract (`hack/vendor-host.sh`) after this PR and declare `rail: { icon, order }`. | `plugin: { name: 'Kubernetes', accent: 'blue' }` and no `rail` | the host's glyph and the plugin's name |
| TANGENTIAL | host Go: `internal/version/version.go:16-22` | `version.Development` defaults to `"true"` and is set by the PR, nightly and feature-channel builds, so `IsDevelopment()` cannot tell a development instance from a packaged build; A18 had to use the instance profile's `Kind` instead. Renaming or splitting the flag would stop the next feature making the same mistake. | `.github/workflows/pr.yml:150`; `internal/instance/profile.go:116,174` | `profile.Descriptor.Kind == "development"` |

## What was not verified, and what remains

1. **Native window**: see "Native check": prepared, **not run** (session locked at 06:06Z). The rail between the Kubernetes plugin (pinned as in `.github/workflows/ui-next-pods.yml`, c69eb69e; a worktree at that commit is `~/Repos/omniviewdev/worktrees/kubernetes-n19d-pin`) and the fixture plugin, last-tab close, Cmd+W on the empty window (and the Dock click that brings it back), Cmd+Shift+W, Cmd+R in a packaged build and in a development build are **unverified**.
2. **A tab already open when a late plugin sorts first** (a link at load, which the native window never has): the rail's entries are pushed down by one entry (Chromium layout shift 0.00006, the entry 40 px). The declared order is kept on purpose; holding the entries until every plugin has settled would delay reaching the plugins that are ready. Say if it should be held.
3. **A sidebar of a plugin shown by the rail while another plugin's tab is on screen starts with its groups closed** (its last page is not revealed): reveal the remembered page's ancestors without selecting it.
4. **Rail polish**: the landmark and the tip's side (Known differences 3 and 4).
5. The old UI's menu under the packaged build: only the unit test covers it (the menu's items are unchanged).
6. Not investigated: why the last table row is clipped by the footer in WKWebView and not in Playwright WebKit (S1c). Not fixed on purpose: Cmd+T and Cmd+[ and ] (S1c).
7. CodeRabbit: its first review (of an earlier commit of this PR) has **1 comment**, Minor, `ui-next/shell/Tree.tsx:105`: the tree revealed the current entry's groups only when `current` changed, with the nodes of that render, so an entry that arrives later with the nodes the plugin's data hook answers stayed hidden in a closed group. Valid: fixed (`core/tree.ts` `hasNode`; `Tree` reveals once when the entry first appears in the nodes, and what the user closes stays closed), test first (red, then green), answered in the thread. The later pushes were rate-limited ("Review limit reached").

## Native check (2026-11-19): prepared, not run (session locked)

The lead asked for the native run after the non-macOS no-op change was pushed. Prepared, and **left running** so the run can start the moment the owner confirms the unlock (`/tmp/s2a_sess` must print no `CGSSessionScreenIsLocked = 1`):

| What | Where | PID or name |
|---|---|---|
| The packaged app (the current head's frontend, `OMNIVIEW_UI=next task build OUTPUT=/tmp/s2a-native/build/Omniview`, ad-hoc signed bundle), channel `feature-ui-next` (a production instance: no Reload), isolated `HOME=/tmp/s2a-native/home`, never `~/.omniview` | `/tmp/s2a-native/app/Omniview-S2a.app`, log `/tmp/s2a-native/run.err` | **PID 4579** (`/tmp/s2a-native/run.pid`) |
| `caffeinate -d -u -t 14400` holding the display awake | | **PID 4578** (`/tmp/s2a-native/caff.pid`) |
| kind cluster with the pods fixture (kind v0.30.0, the node image of `.github/workflows/ui-next-pods.yml`) | kubeconfig `/tmp/s2a-native/kubeconfig`, copied to `/tmp/s2a-native/home/.kube/config` | cluster **`s2a-native`** (container `s2a-native-control-plane`): delete with `kind delete cluster --name s2a-native` |
| Plugins in the isolated HOME | `/tmp/s2a-native/home/.omniview-feature-ui-next/plugins/{kubernetes,fixture-a-ok}` | Kubernetes 0.21.2 from the tarball of the CI pin c69eb69e (`entry.js` sha1 d39d4ca4, the same as S1c's build); the fixture plugin declares `rail: { icon: 'layers', label: 'Seam Fixture', order: 10 }`, the Kubernetes plugin none |
| Capture and input tools | `/tmp/s2a-native/s.sh <name>` (whole-window `screencapture -l`, prints the lock state with every capture, writes to `S2a-assets/`); `/tmp/s1c/winlist`, `/tmp/s1c/ev` (keys with modifiers, clicks), `/tmp/s2a_sess` (the lock state); sources in `docs/ui-next/status/S1c/` | |

To run, in this order, with the lock state recorded with each capture: (1) a whole-window screenshot of the rail with both plugins; (2) choose the other entry: the sidebar switches and no tab closes; activating a tab selects its plugin; (3) close the last tab: the empty state; (4) Cmd+W on the empty window hides the window, a Dock click brings it back; (5) Cmd+Shift+W; (6) Cmd+R in this packaged build does nothing. **Cmd+R reloading in a development build** needs a managed development workspace (`docs/development-workspaces.md`: sources for the host, the UI, the SDK and the plugins), which this step did not set up; the mapping is `profile.Descriptor.Kind == "development"` (`internal/instance/profile.go:116`) and the Go test pins the development menu equal to the old one, which S1c saw reload the window natively (`status/S1c.md`, item 7). To stop everything: `kill 4579 4578; kind delete cluster --name s2a-native`.

## Dev tools

| Tool | What | Where | Keep? |
|---|---|---|---|
| Rail probe | the rail against the mock's two rails: geometry and paint in six states, both engines, both A15 viewports; CI runs it | `ui-next/shell/probes/rail-probe.mjs`, reference `mock-rail.json` | yes |
| Rail reference | measures the mock's two rails (the first plugin screen's three tools, the second's rail with its open tool) and the paint of six states: `MOCK_URL=http://127.0.0.1:<port>/ node ui-next/shell/probes/mock-rail-measure.mjs` after serving the mock as `mock-strip-measure.mjs` describes (`sed "s#const root=__dirname#const root=\"<mock dir>\"#" <mock dir>/server.js > /tmp/server.cjs && PORT=<port> node /tmp/server.cjs`); the mock tree is c8e44a44 | `ui-next/shell/probes/mock-rail-measure.mjs` | yes |
| Host fixture, late plugin | `?plugins=2&lateMs=700&first=beta`: the second plugin registers 700 ms after the first and sorts first (`rail.order` 10 and 20) | `ui-next/shell/probes/host-fixture.tsx` | yes |
| Sampler, rail entries | the sampler of the probes also watches every rail entry by name: an entry whose rectangle changes has moved | `ui-next/shell/probes/harness.mjs` | yes |
| Seam check, rail scenario | the rail and the empty window on the real Go host with two real bundles (the fixture plugins declare `rail`); needs `OMNIVIEW_UI=next task build:server` | `ui-next/plugins/e2e/seam.check.mjs` (scenario g), `ui-next/plugins/fixture/build.mjs` (`FIXTURE_RAIL`, a `define`) | yes |
| Session lock check | `CGSessionCopyCurrentDictionary` and `CGDisplayIsAsleep` | `docs/ui-next/status/S1c/sess.swift.txt` | same as S1c |
| Test support | `STATIC_RAIL` and `StaticShell` props `onSelectRail`, `onCloseWindow` | `ui-next/shell/testing.tsx` | yes |
