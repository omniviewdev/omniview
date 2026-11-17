# `ui-next/shell/`: the window frame

The new shell's frame, to the mock's rectangles (slice 1a plan, PR 1a.5; ch16 §B): the top row with one tab, the plugin frame (rail track, sidebar tree, page island with the scope lane above it) and the status bar. It is **plugin-agnostic**: it knows a screen only by the data the screen registers, and no plugin word appears in this directory (a guard scans it). It uses kit parts where the kit has them (`Icon`, `Text`) and local CSS Modules where it does not; each local part is listed below with the kit part it should become.

Slice 1a draws the minimum. What the plan cuts (tab close and new tab, the rail's tools, the sidebar search, scope menus, the panel, status items, the bell) is not here: an element that does nothing is a stub, and no stub ships.

## The registration: the seed of the contribution contract

A screen hands the shell plain data, `ShellRegistration` (`registration.ts`), as a prop: `<Shell registration={…}>{page}</Shell>`. The shell reads it and never writes back; a plugin never reaches into the shell's DOM (ch16 S1). One row per field of the contribution table of ch16 S10:

| Field | What it carries | Limit (S10) | Held by |
|---|---|---|---|
| `plugin.name` | Names the landmarks: `<name> workspace`, `<name> scope` | | type |
| `tab.title`, `tab.icon` | The page as the tab shows it | title at most 3 words | review |
| `path` | The status bar's crumbs, root first; the last is the page. Text: a crumb that navigates arrives with navigation | | type |
| `rail` | `true`: the plugin's frame has a rail track (R5). Its tools are not part of the contract yet | at most one | type |
| `sidebar` | `label` (names the navigation and its tree), `title` (the header), `nodes`, `open`, `current`, `accent` (a brand colour for the glyphs) | at most one; a node is an entry, or a group when it has `children` | type |
| `sidebar.nodes[].count` | The 12 px count slot of an entry's row (SB1) | | type |
| `scope` | The lane's faces: `label` (what it is, read first), `icon`, `text` | at most 2 faces; text at most 24 characters | review |

"Review" is where the limit is not in the type yet: the contribution API that checks them at registration comes with R11. An absent field is an absent region: no track, no landmark (S10: a hidden lane is 0 px).

**Where the shape meets the plugin.** Plugin scaffolding imports nothing from the shell (the plugin will not either): it exports a plain object, and the shell's type checks that object at the one place the two meet, the mount point in `ui-next/main.tsx`. A drift is a compile error there. The future contract moves the type to the surface plugins import.

**Values the page learns from its data** (the count of an entry, the connection the page picked) reach the shell the same way, through the registration, built by whatever owns the data: one data hook per page (docs/ui-next/optimisations.md MNR-T8), so the page's data owner builds the registration and renders `<Shell>` around the page. The tree reads `open` and `current` once, when it mounts, and keeps what the user opened or closed across registrations. In PR 1a.5 the entries are static; the live count and the connection the page picks are wired in PR 1a.7, where the page that owns the data exists.

## Regions

Every region is a landmark with a name, in reading order. `F6` and `Shift+F6` visit the regions that have something to focus; `Escape` from any other region returns the focus to the page (ch16 S12). The DOM says which: `data-shell-region` marks a region, `data-shell-focus` the element in it that takes the focus.

| Region | Element | Name | F6 stop | At 1440 x 900 |
|---|---|---|---|---|
| Top row | `header` | Window | the tab | 0, 0, 1440 x 40 |
| The tab | `button role=tab`, in a `tablist` "Open tabs" | its title | | 156, 6, 208 x 28 |
| Rail | empty track, `aria-hidden` | | no (nothing in it) | 5, 40, 40 x 823 |
| Sidebar | `nav` | `sidebar.label` | the tree's tab stop | 45, 40, 244 x 823 |
| Page island | `main` | `<plugin> workspace` | the island | 294, 40, 1141 x 823 |
| Scope lane | `div role=group` | `<plugin> scope` | no (Shift+Tab from the page) | 294, 40, 1141 x 40 |
| Page | `div role=tabpanel`; the page's scroll owner and a tab stop in the `document` layout, a bounded pane that scrolls nothing in the `pane` layout | the tab | | 294, 80, 1141 x 783 |
| Status bar | `footer` | Status bar | no (a path of text) | 0, 868, 1440 x 32 |

The window is a grid (5 px gutters; the top row 40, the frame, a 5 px gutter where the panel's handle will sit, the status bar 32). Every region is drawn in the first commit and sized by CSS alone: nothing measures, nothing is positioned by script.

## The core

`core/` is framework-free and holds every decision a renderer would otherwise make; React only draws the answers. `tree.ts`: which rows are visible (one pass over what is visible), which row holds the tree's one tab stop, what a key does (the WAI-ARIA tree view keys), state that is the same object when nothing changed. `regions.ts`: where F6, Shift+F6 and Escape go. Not built: type-ahead, PageUp and PageDown, windowing of a large tree, chunked expand-all (docs/ui-next/optimisations.md LIB-10 to LIB-15); rows are plain data, so none of it is foreclosed.

## Decisions to confirm

1. **The rail's 40 px track is reserved, empty** (`rail: true`). The mock's rail holds the plugin's tools (tier C), but the island's rectangle (294, 40) and every page rectangle after it (the title at 306, the table 1117 wide) assume the track. Dropping it is one field of the registration; the island then moves 40 px left and the page-chrome PRs measure against that.
2. **The top row keeps its leading 156 px**: the safe area (84, for the OS window controls; a browser draws an inert stand-in), then the room Back and Forward take later (64 and an 8 px gap). The tab sits at 156 as in the mock. The stand-in dots are drawn in every build; the native pass decides how the real controls replace them (the mock hides them with `data-native`).
3. **The scope faces are text, with no chevron**: a chevron promises a menu, and the menus are tier C. A face keeps the mock's box, so glyph and label sit where the mock's do; its width is 16 px less (the chevron and its 4 px gap).
4. **Choosing a tree entry does nothing**: with one tab and no navigation, the entry on screen is the current page. A group opens and closes.
5. **The page's scroll owner is the `document` layout by default** (ch16 S15, the mock's `#mainscroll`): a vertical scrollbar lane is always there. A page that owns its scrolling declares `layout: 'pane'` in its registration (the mock's `data-layout="pane"`; step 1a.6, for the collection view): the shell scrolls nothing, the content fills the island under the scope lane, its bottom inset is the page's own (a collection's footer is the last lane of the pane, ch13 G2; a pane with no footer keeps the 12 px itself) and the page region has no tab stop, because the pane's own scroll region is the stop. The pane is probed with the first collection page (`ui-next/page/`, probe in `ui-next/page/probes/`; `docs/ui-next/status/1a.6.md`).
6. **The page region is a tab stop** (the tabs pattern, and axe's `scrollable-region-focusable`): a page of text scrolls from the keyboard. The mock's `#mainscroll` has `tabindex="-1"`, which axe fails for a page of text. The extra stop is the cost for a page that has its own focusable content.
7. **No focus ring on the island**, as in the mock (`.frame__island:focus-visible { outline: 0 }`). F6 and Escape land on it, so a keyboard user sees no ring there; the mock's choice is kept until the errata pass says otherwise.
8. **A tree row is named by its text** ("Entry 89"), not by the mock's `aria-label` ("Entry, 89"), which fails axe's `label-content-name-mismatch` (WCAG 2.5.3).
9. **Window drag regions** (S5) are declared with `--wails-draggable`, which the Wails runtime reads. The stylesheet rule that closes custom properties has a local exception on those lines; the native drag is not verified (no native run yet).
10. **The sidebar is 244 px, fixed**: no splitter, no collapse (S98 to S104 arrive with the layout slice).

## Local parts and the kit part each should become

| Here | Kit part | Notes |
|---|---|---|
| `TopRow.tsx` (the tab) | `TabStrip`, `Tab` | close, new tab, overflow, drag and the tab model come with it |
| `Sidebar.tsx` header | `ToolHeader` | the mock's `H.toolHeader`: title, actions, tabs |
| `Tree.tsx` | `Tree` | the mock's `H.tree`; the rules are already in `core/tree.ts` |
| `ScopeLane.tsx` | `ScopeLane` | with the menus that change a scope |
| `StatusBar.tsx` | `StatusBar`, `StatusItem`, `StatusPath` | the toolbar, the items, the overflow rule S95 |
| a wrapper per clipped text | `Text` gains `truncate` | rows, crumbs and labels clip with an ellipsis in a wrapper here |
| `.what` in `ScopeLane.module.css` | `VisuallyHidden` | the text a face is read with and never drawn |

## What this leaves open for the tab-system slice

Today's shell keeps a tab that was shown once mounted but hidden for the rest of its life, with no cap (docs/ui-next/optimisations.md HSH-21, section 7); it is not copied here. The frame hosts one page in one stable slot (the tabpanel), so a keep-alive policy can wrap the page without touching the frame. The questions the tab-system slice has to answer on purpose: how many hidden pages may stay mounted, and which leaves first; whether a hidden page keeps its effects (React `Activity` releases them) or is unmounted; how that meets the runtime's own linger of a closed page's source views (60 s, at most 4, RTM-05); whether the one tabpanel becomes one per tab or the one slot swaps its content; where each tab's scroll offset lives.

## Probe

`node ui-next/shell/probes/shell-probe.mjs` builds the channel flavour and a fixture, serves them, and measures every region against the mock in WebKit and Chromium at both viewports (`mock-shell.json` is the mock's reference, made by `mock-measure.mjs`); the header of the script lists what it checks. It needs Playwright's browsers and is run by hand.
