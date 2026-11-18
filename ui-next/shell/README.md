# `ui-next/shell/`: the window frame

The new shell's frame, to the mock's rectangles (slice 1a plan, PR 1a.5; ch16 §B) and its tabs (S1b; ch16 §C): the top row with Back and Forward and the tab strip, the plugin frame (rail track, sidebar tree, page island with the scope lane above it) and the status bar. The island hosts the pages of the mounted tabs. It is **plugin-agnostic**: it knows a screen only by the data the screen registers and a tab only by the model's data, and no plugin word appears in this directory (a guard scans it). It uses kit parts where the kit has them (`Icon`, `Text`, `tip`) and local CSS Modules where it does not; each local part is listed below with the kit part it should become.

What the plan cuts is not here: an element that does nothing is a stub, and no stub ships. Not built: the tab context menu, the New tab menu and All tabs menu, drag and reorder, pinned, preview, unsaved and attention cues, the rail's tools, the sidebar search, scope menus, the panel, status items, the bell, window actions (Search, Settings).

## The tab model and the strip

`core/tabs/` is the framework-free model (its own README): a tab is a route plus restorable state; the model decides where a destination opens, what a tab is called, a tab's history, which pages stay mounted. React only draws the answers: `tabs/` holds `TabStrip` and `Tab` (the strip), `PageHost`, `NavButtons`, the slice hooks (`hooks.ts`: one hook per consumer, so a tab's title changing renders that tab and nothing else; `renderCounts.test.tsx` is the guard) and the chords. `Shell` takes the store: `<Shell registration tabs renderPage empty onChoose onNewTab>`.

- **The strip** is a roving `tablist` "Open tabs" with one tab stop: arrows move the focus and select nothing (they wrap), Home and End jump, Enter and Space select, Delete and Backspace close and hand the focus to the neighbour; a middle click and the close control close; Command or Control with W closes the tab on screen, with 1 to 8 jumps, with 9 goes to the last, and Control Option does the same where a browser keeps the first for itself (S41, S47). Faces share the strip equally, 208 px at most, down to 96 px; then the scroller scrolls (wheel, trackpad) with no bar and no overflow menu, and the tab on screen is always revealed. Rectangles equal the mock's at 1, 2, 5, 6, 8, 12 and 30 tabs in WebKit and Chromium at 1440 x 900 and 1280 x 800 (`probes/strip-probe.mjs`, 0 px).
- **The close control is the pointer's**: it is `aria-hidden` and not a tab stop, because a tablist owns tabs and nothing else (axe `aria-required-children` names a button inside it as not allowed). The keyboard and assistive technology close a tab with Delete, the chord, or the context menu when it exists.
- **The new-tab control** (`+`, 4 px after the last tab) opens a new tab at the home page of the plugin on screen (the host's answer). The mock's opens a menu of plugin entry points (S34); the menu is not built, so this is the simplest action that does what the control says.
- **Back and Forward** (30 px, a 20 px glyph) walk the history of the tab on screen (S50); `aria-disabled` with the reason when there is none. The mouse's side buttons, the chords and the list of the last ten titles are not built.
- **The page host** draws each mounted tab's page in a slot of the one `tabpanel` (labelled by the selected tab) inside React `Activity` (HSH-21, MNR-K1): a hidden page's effects are released (no timer, no subscription), its renders wait, the browser does no layout and no paint for it (`display: none`), and its state and DOM stay. The default policy is five pages, the one on screen and four hidden (`DEFAULT_KEEP_ALIVE`: a placeholder, not a measurement); a tab past the cap is unmounted and drawn from scratch when it is shown again. A hidden page's own scrollers keep their offsets (measured, both engines); the tabpanel's own offset, shared by every tab of a `document` layout, is kept per tab by the host. `content-visibility: hidden` was measured too: it keeps offsets as well, but it does not release effects, so it is not used.
- **The status bar's path** is the model's breadcrumb for the tab on screen.

## The registration: the seed of the contribution contract

A screen hands the shell plain data, `ShellRegistration` (`registration.ts`), as a prop. The shell reads it and never writes back; a plugin never reaches into the shell's DOM (ch16 S1). What a tab is called and where it sits (title, glyph, path) is not in it: it is the tab model's, which asks the plugin (`Contributions.describe`).

| Field | What it carries | Limit (S10) | Held by |
|---|---|---|---|
| `plugin.name` | Names the landmarks: `<name> workspace`, `<name> scope` | | type |
| `rail` | `true`: the plugin's frame has a rail track (R5). Its tools are not part of the contract yet | at most one | type |
| `sidebar` | `label` (names the navigation and its tree), `title` (the header), `nodes`, `open`, `current`, `accent` | at most one; a node is an entry, or a group when it has `children` | type |
| `sidebar.nodes[].count` | The 12 px count slot of an entry's row (SB1) | | type |
| `scope` | The lane's faces: `label` (what it is, read first), `icon`, `text` | at most 2 faces; text at most 24 characters | review |
| `layout` | `document` (the shell scrolls the page) or `pane` (the page owns its scrolling) | | type |
| `pending` | The plugin's frame is on its way: the regions it will have are drawn empty at their rectangles (see "Layout shift") | | type |

An absent field is an absent region: no track, no landmark (S10: a hidden lane is 0 px).

**Where the shape meets the plugin.** A plugin never imports the shell: its bundle exports plain data (`contributionV1`, `ui-next/plugins/contract/v1.ts`) and the host builds both the registration and the model's `Contributions` from it (`ui-next/plugins/host/`); a drift is a compile error there. The page's data hook runs in its tab's own component; what it returns as `frame` (tab, path, scope) is published for the tab's description and the lane. One data hook per page (docs/ui-next/optimisations.md MNR-T8).

## Layout shift

The window does not wait for plugins. While the plugin of the tab on screen is loading (or the window has no tab yet and one is on its way) the registration is `pending`: the rail's track, the sidebar (the same `nav`, busy, no tree) and an empty scope lane are drawn at the rectangles the plugin's frame will have, so the frame, the sidebar's skeleton and its entries, and the first tab arrive without a region moving. `probes/strip-probe.mjs` (the host fixture: the product's `PluginHost` with a loader the probe controls) samples every region at every frame: 0 px of movement and, where the engine reports it (Chromium), 0 layout shift. **A frame that turns out to have fewer regions than that moves the page once**: the shape of a plugin's frame is not known before it loads (the probe's `lane=0` case records it: the lane is given back and the page moves up 40 px). Persisting each plugin's frame shape with the saved tab fixes it for every start but the first (listed).

## Regions

Every region is a landmark with a name, in reading order. `F6` and `Shift+F6` visit the regions that have something to focus; `Escape` from any other region returns the focus to the page (ch16 S12). The DOM says which: `data-shell-region` marks a region, `data-shell-focus` the element in it that takes the focus.

| Region | Element | Name | F6 stop | At 1440 x 900 |
|---|---|---|---|---|
| Top row | `header` | Window | the tab on screen | 0, 0, 1440 x 40 |
| Back, Forward | `div role=group`, two buttons | Navigation | no (Tab stops) | 84, 5, 30 x 30 and 118, 5 |
| The strip | `div role=tablist`, `button role=tab` | Open tabs; each tab's title | | 156, 6, 208 x 28 per tab |
| New tab | `button` | New tab | no (a Tab stop) | 4 px after the last tab |
| Rail | empty track, `aria-hidden` | | no (nothing in it) | 5, 40, 40 x 823 |
| Sidebar | `nav` | `sidebar.label` | the tree's tab stop | 45, 40, 244 x 823 |
| Page island | `main` | `<plugin> workspace` | the island | 294, 40, 1141 x 823 |
| Scope lane | `div role=group` | `<plugin> scope` | no (Shift+Tab from the page) | 294, 40, 1141 x 40 |
| Page | `div role=tabpanel` (a plain `div` while no tab is on screen); the page's scroll owner and a tab stop in the `document` layout, a bounded pane in the `pane` layout | the selected tab | | 294, 80, 1141 x 783 |
| Status bar | `footer` | Status bar | no (a path of text) | 0, 868, 1440 x 32 |

The window is a grid (5 px gutters; the top row 40, the frame, a 5 px gutter where the panel's handle will sit, the status bar 32). The top row's budget is the chapter's: 156 leading, the strip, a drag lane of 48 px at least, and the 138 px of the window actions, kept empty. Every region is drawn in the first commit and sized by CSS alone: nothing measures, nothing is positioned by script.

## The core

`core/` is framework-free and holds every decision a renderer would otherwise make; React only draws the answers. `tree.ts`: which rows are visible, which row holds the tree's one tab stop, what a key does (the WAI-ARIA tree view keys). `regions.ts`: where F6, Shift+F6 and Escape go. `chords.ts`: which key event is a tab chord. `title.ts`: where a long title is cut (head and tail, as the mock's strip does). `tabs/`: the tab and open model. Not built: type-ahead, PageUp and PageDown, windowing of a large tree, chunked expand-all (docs/ui-next/optimisations.md LIB-10 to LIB-15).

## Decisions to confirm

1. **The rail's 40 px track is reserved, empty** (`rail: true`). The mock's rail holds the plugin's tools (tier C), but the island's rectangle and every page rectangle after it assume the track.
2. **The top row keeps its leading 156 px and its trailing 138 px**: the safe area (84, for the OS window controls), Back and Forward (64) and a gap (8); at the end the room the window actions take later, so the strip has the room the mock gives it. In the native window the real controls draw in the safe area and nothing of the shell does; in a browser the shell draws three inert grey dots of the same size (`core/native.ts`).
3. **The scope faces are text, with no chevron**: a chevron promises a menu, and the menus are tier C.
4. **Choosing a tree entry tells the host which one** (`onChoose(id, event)`: a click, Enter or Space on an entry, never a group). The host opens it through the model: a plain click is a smart open (a tab that shows the page is shown; else the tab on screen is navigated when it is the same plugin and scope; else a new tab), Command or Control a background tab. The page that opens registers with that entry as `current`, and only then is it selected.
5. **The page's scroll owner is the `document` layout by default** (ch16 S15); a page that owns its scrolling declares `layout: 'pane'`.
6. **The page region is a tab stop** in the `document` layout (the tabs pattern, and axe's `scrollable-region-focusable`).
7. **No focus ring on the island**, as in the mock.
8. **A tree row is named by its text** ("Entry 89"), which axe's `label-content-name-mismatch` asks (WCAG 2.5.3).
9. **Window drag regions** (S5) are declared with `--wails-draggable`; the native drag is not verified (no native run of S1b).
10. **The sidebar is 244 px, fixed**: no splitter, no collapse.
11. **The window never writes the address.** `#/<plugin>/<page>?connection=<id>` is an input: a deep link at load (the window's home page waits for it) and a hash typed later; each opens a tab through the model. Where the window is, is the tabs' (each has its own history).
12. **Keep-alive policy**: five pages, unsaved tabs exempt, `Activity` (see above). The old shell kept every shown tab mounted with no cap (HSH-21).

## Local parts and the kit part each should become

| Here | Kit part | Notes |
|---|---|---|
| `tabs/TabStrip.tsx`, `tabs/Tab.tsx` | `TabStrip`, `Tab` | the menus, drag, overflow menu and the state cues come with it |
| `tabs/NavButtons.tsx` | the top row's navigation buttons | |
| `TopRow.tsx` | the top row, around `TabStrip` | the window actions come with it |
| `Sidebar.tsx` header | `ToolHeader` | the mock's `H.toolHeader`: title, actions, tabs |
| `Tree.tsx` | `Tree` | the mock's `H.tree`; the rules are already in `core/tree.ts` |
| `ScopeLane.tsx` | `ScopeLane` | with the menus that change a scope |
| `StatusBar.tsx` | `StatusBar`, `StatusItem`, `StatusPath` | the toolbar, the items, the overflow rule S95 |
| a wrapper per clipped text | `Text` gains `truncate` | rows, crumbs and labels clip with an ellipsis in a wrapper here |
| `.what` in `ScopeLane.module.css` | `VisuallyHidden` | the text a face is read with and never drawn |

## Probes

`node ui-next/shell/probes/shell-probe.mjs` builds the fixture (the real `Shell` around invented registrations and invented tabs, `probes/fixture.tsx`), serves it, and measures every region against the mock's reference screen in WebKit and Chromium (`mock-shell.json`, made by `mock-measure.mjs`; viewports 1440 x 900 and 1030 x 720 until row N23). `node ui-next/shell/probes/strip-probe.mjs` reads the strip, the page host and the load at 1440 x 900 and 1280 x 800: the strip against `mock-strip.json` (made by `mock-strip-measure.mjs`), the keyboard path with real key presses, axe, exact counts (a tab is 12 DOM nodes; a switch is 3 commits), keep-alive and the switch time on the host fixture (`probes/host-fixture.tsx`: the product's `PluginHost` with invented plugins), and the load with plugins arriving after the first frame. Neither opens a plugin's screen: the shell is plugin-agnostic and so are its probes. CI runs both (workflow "UI next kit probes"); both honour `FONT_DELAY_MS`.
