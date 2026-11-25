# KL1: kit parts for a plugin landing page

Goal: the kit parts a plugin needs to draw a landing page (home, connections collection, menus, a create sheet) as the mock draws them. The screens themselves are later rows; the owner ordered the parts first (2026-11-25), ahead of rule 1.

- Worktree: `~/Repos/omniviewdev/worktrees/k8s-landing`
- Branch: `feat/k8s-landing-kit`

## Parts

New: `Avatar` (with `DataColor` and seven tint roles in nine themes, 78 to 85 colour roles), `IdentityCell`, `SwatchPicker`, `SegmentedControl`, `Checkbox`, `FileButton`, `ValuePicker`, `FormActions`, `ConfirmDialog`, `Disclosure`, `Notice`, `ResourceCard`, `CardGrid`, `ToolHeader`.

Extended: `Icon` (20 glyphs), `Sheet` (`size`, `icon`, `meta`, `footer`; it stays the modal dialog, and its header, body and footer are an internal frame apart from the modal layer so a native window can present them later), `TextInput` (`autoFocus`), `SectionCard` (`collapse`), `DataView` (cards body; `DataViewProps` is now table or cards), `CollectionFooter` (`status`), `ListRows` (button rows, link rows, `aside`), `DataTable` (`rowMenu`), `PageHeader` (menu entries carry an icon and a disabled reason; the local type is `OverflowEntry`).

Deferred: `ReorderList`, `InspectorPanel`, the mock's lab-only Debug view.

## Deviations from the mock (owner rulings, 2026-11-25)

- `Avatar` initials are the foreground colour (`--ov-fg`), not the hue: the mock's hue on a 24% tint (`base.css` 1576) is 4.39 to 4.48:1 in Void and fails AA (axe `color-contrast`, 4 findings a run). The glyph keeps the hue (3:1).
- The tint is 24% in seven themes, 18% in `solarized-dark` and 22% in `solarized-light` (the highest 2% step at which every initial reads at 4.5:1 and every glyph at 3:1). Computed over 9 themes x 7 colours: 63 of 63 pass; the least initial is 4.61:1 (dark) and 4.50:1 (light), the least glyph 4.26:1 and 3.36:1; at 24% the two Solarized themes were 4.09:1 and 4.35:1. `tint.test.ts` holds each theme to its share and to both contrasts.
- `ResourceCard` is two boxes: the root draws the edge, a body inside it holds the inset and the containment (one more element a card, 28 in all).

## Log

- 2026-11-25: parts built, one package per agent; kit `verify` (124 files, 3,098 tests), both host tsc projects, eslint, `lint:ui-policy`, `lint:css`, `pnpm test ui-next` (305 files, 8,064 tests) and `scripts/react-compiler.test.mjs` green.
- 2026-11-25 (probes and visual pass, clean environment, `FONT_DELAY_MS=40`; load average 14.5 at the first run's start and 4.9 at the end): first run of the kit, table, fonts, tooltip, sheet, row-menu, page, detail, form and settings probes: table, tooltip, sheet (336 checks), row-menu, page (536 lines, 0 failures), detail (270 readings), form (2,370 checks) and settings (3,514 checks) passed. The kit probe failed 16 times and the fonts probe 4: `folder-plus` has its ink centred at 8.50, 9.00 (Int UI's newFolder; the probe gives that one glyph 1.0 of room), the avatar initials failed axe (above), and 20 elements had no `calt` off (12 bare `<button>` in the `RowMenu` example, now a kit `Button`; 8 hidden reasons in `SwatchPicker`, whose button now sets the feature settings). Every failure came from a part this change adds, so no run on `origin/main` was made. After the fixes the kit probe (221 s, load 13.5 at its start), fonts (68 s), table (89 s) and row-menu (26 s) pass.
- 2026-11-25 (`CardGrid`): the last column lost its right edge in Chromium whenever a scrolling body clipped at the grid's edge (a data view's body does): a contained box (the cell's `content-visibility: auto`, the card's `contain: layout paint`) is painted from a rounded origin and keeps its fractional width, so on a half-pixel column its edge falls a pixel past its box. The edge is now drawn by a plain root and the containment sits in a body inside it; the cell is plain. In Chromium at DPR 1, 1.25, 1.5 and 2, 14 to 18 of 434 cards (12 widths, 4 examples) lost an edge before and 0 of 273 (7 widths, 5 examples, the data view's cards included) do now; in WebKit at DPR 1 and 2, and at 110% text size, 0; one CSS test holds the containment off the edge. A neutral card's edge is `rgb(38, 40, 44)` on the island `rgb(25, 26, 28)` in Void, the mock's `--int-border-subtle` on its island (`base.css` 1323), and every band of the card measures as the mock's at 1117 px (151 high).
- 2026-11-25 (`ValuePicker`, real browsers): new example `InSheet`. Placement: above the trigger 34 px from the bottom of the window, inside the window at the right edge, above the dialog in a Sheet (hit test); Escape closes the popup, then the sheet, and gives the focus back each time; 5,000 options keep 32 rows mounted and scroll with no frame over 33 ms in Chromium and 19 ms in WebKit, End reaches option 5,000. Fixed in WebKit: a list that scrolls under a resting pointer sent a move the pointer did not make, and the hovered row took the active row from End and the arrows; a move to a place the pointer was already seen at is now ignored.
- 2026-11-25 (keyboard, Chromium and WebKit, 52 checks, WebKit with Option+Tab): `ConfirmDialog` (focus on the verb, on Cancel for danger, in the field for the destructive tier, Escape, Enter), `Disclosure`, `Notice`, `IdentityCell`, `Checkbox` (mixed to checked, disabled with a reason), `FileButton` (picker and file), `ToolHeader` (hidden at rest, shown on focus, menu), `SectionCard` collapse, `ListRows` aside, `DataTable` `rowMenu` (secondary click and Shift+F10), `PageHeader` overflow entries all work; `SegmentedControl` examples now use `table`, `layout-grid` and a neutral `list` option instead of Debug.

## Not verified

- The kit-docs Storybook (its generator refuses to run with uncommitted kit changes); the avatar contrast in the other eight themes is by computation, axe ran in Void only.
- The tooltip, sheet, page, detail, form and settings probes passed on the first run and were not run again after the fixes above, which touch no part they cover; the shell, strip and rail probes were not run (no file they cover changed).
- WebKit at fractional scale factors (1.25 and 1.5) draws some 1 px card edges thin even with no containment at all (not caused by this change); `DataTable` rows of the `RowMenu` example overlap their neighbour's table in the narrow cells of the parts page, so a right click there needs the example in a wide cell.
- No real screen uses the parts yet; the seam, the cluster check and e2e were not run.

## Dev tools

Scratch only, not committed (`/tmp`): `kl1-run-probes.sh` (the probes one after another from a clean environment) and `kl1-visual/` (a Playwright harness: the card-edge detector, the width and scale sweeps, the keyboard exercise and the mock card measure).
