# KL1: kit parts for a plugin landing page

Goal: the kit parts a plugin needs to draw a landing page (home, connections collection, menus, a create sheet) as the mock draws them. The screens themselves are later rows; the owner ordered the parts first (2026-11-25), ahead of rule 1.

- Worktree: `~/Repos/omniviewdev/worktrees/k8s-landing`
- Branch: `feat/k8s-landing-kit`

## Parts

New: `Avatar` (with `DataColor` and seven tint roles in nine themes, 78 to 85 colour roles), `IdentityCell`, `SwatchPicker`, `SegmentedControl`, `Checkbox`, `FileButton`, `ValuePicker`, `FormActions`, `ConfirmDialog`, `Disclosure`, `Notice`, `ResourceCard`, `CardGrid`, `ToolHeader`.

Extended: `Icon` (20 glyphs), `Sheet` (`size`, `icon`, `meta`, `footer`; it stays the modal dialog, and its header, body and footer are an internal frame apart from the modal layer so a native window can present them later), `TextInput` (`autoFocus`), `SectionCard` (`collapse`), `DataView` (cards body; `DataViewProps` is now table or cards), `CollectionFooter` (`status`), `ListRows` (button rows, link rows, `aside`), `DataTable` (`rowMenu`), `PageHeader` (menu entries carry an icon and a disabled reason; the local type is `OverflowEntry`).

Deferred: `ReorderList`, `InspectorPanel`, the mock's lab-only Debug view.

## Log

- 2026-11-25: parts built, one package per agent; kit `verify` (124 files, 3,098 tests), both host tsc projects, eslint, `lint:ui-policy`, `lint:css`, `pnpm test ui-next` (305 files, 8,064 tests) and `scripts/react-compiler.test.mjs` green.

## Not verified

- The kit probes against the mock were not run.
- `ValuePicker` placement and focus return ran in jsdom only.
- No real screen uses the parts yet; the seam, the cluster check and e2e were not run.

## Dev tools

None added.
