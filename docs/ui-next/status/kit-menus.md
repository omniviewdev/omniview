# Unified kit action menus

This cutover covers the kit and its `ui-next` application. `vite.config.ts` still builds the `current` flavor from `ui/`, which uses Base UI. Its menus and the native window menu are separate surfaces, not kit callers.

## Inventory

| Surface | Use | Decision |
| --- | --- | --- |
| List and detail page headers (`packages/kit/src/components/PageHeader`) | More actions; excess secondary commands and caller-defined entries | One delegated dropdown. Keep visible-command deduplication, ordering, separators, disabled items and destructive commands last. Do not draw an empty trigger. The page still decides what each command does. |
| Plugin details (`ui-next/shell/plugins-page/Header.tsx`) | More actions for the selected plugin | Resolve the plugin by ID when its trigger opens. Keep Disable, the destructive Uninstall or Unlink action, availability, and the existing confirmation. No menu for a built-in plugin with no overflow command. |
| Logs toolbar (`ui-next/shell/panel/logs/LogToolbar.tsx`) | Actions that do not fit in the vertical toolbar | Keep the last-slot trigger, toolbar arrow navigation, action order, current-state verb labels, and disabled reasons. The window host draws the dropdown outside the toolbar. |
| Notification centre (`ui-next/shell/notices/Centre.tsx`) | Filter by source, then mute, unmute or clear | Keep the named Source radio group, selected dot, counted choices, conditional commands, and first-item focus on a pointer open. The menu belongs inside the non-modal centre, not to the bell. Escape closes the menu before the centre; presses outside both close both. |
| Workload rows, tabs and session target buttons | Ellipsis dropdowns and context menus, including command submenus and checked actions | Kit examples and the large-row probe use the same host. `ui-next` does not yet ship tab context menus, a new-tab menu, or session-target menus; this cutover does not add those product features. |
| Current-flavor resources, plugin pages, tabs, new tab and drawer | Base UI dropdowns, context menus and execution submenus | Inventory only. These run in `ui/`, not in the kit-based shell. |

The current-flavor inventory includes resource table actions (including execution targets), workspace tab and group menus, the new-tab launcher, bottom-drawer tab context, right-drawer commands, header icon menus, and plugin page actions. They continue using Base UI.

A menu offers commands, even when one command toggles a setting or changes a filter. A value picker is not a menu. Keep the native kit `Select` used by settings and the shell’s `ScopePicker` as value controls with option semantics. Keep the searchable command palette as a dialog with a combobox and listbox. The notification centre, confirmation dialogs, and settings sheets are not menus either.

## Ownership and lifecycle

- `ui-next/main.tsx` mounts one `MenuHost` per window. Independent browser fixtures mount one each. `RowMenu` handles and caller-owned popup components are not a second path.
- Menu entries describe actions, checks, radio choices, groups, separators, and submenus. Metadata and shortcut hints describe an action; they do not bind a key or execute it.
- Static definitions can be supplied to `MenuHost` by ID. Components that own live commands register a resolver with `useMenu`. Opening snapshots its entries. An optional semantic revision dismisses a stale opening without reacting to unrelated renders. Page headers also revalidate the current command by ID before dispatch.
- `menuTrigger(id, contextKey?, mode?)` describes a trigger and supplies dropdown ARIA for native buttons, `Button`, and `IconButton`. A context target must be reachable by keyboard. Repeated rows pass stable record keys, not row objects or callbacks, and share one definition with no popup or subscription per row.
- The virtual-row example keeps a native trigger so it does not run `IconButton`’s `useCommand` hooks or attach an idle click handler for each mounted row. Its sizing and paint use the kit’s row-control tokens; the host handles activation.
- The host owns placement, keyboard navigation, the open trigger’s ARIA state, dismissal and focus return. Its top-layer popup stays inside any containing dialog or popover. The panel also declares a menu scope so its shortcuts still reach a session from the open overflow menu. Escape closes the deepest menu first. Tab closes the menu and continues from the trigger. If a trigger vanishes or now represents another key, the host dismisses without focusing the wrong row.
- A root is drawn only while open; submenus add only the open branch. Opening or closing a menu must not render table rows. The menu count tests and browser probe guard these invariants; application fixtures continue to cover header commands, plugin confirmations, log overflow, and the nested notification menu.

## Verification and limits

[Implementation PR #678](https://github.com/omniviewdev/omniview/pull/678) · [design plan](kit-menu-plan.md) · [seven WebKit screenshots and raw benchmark samples](kit-menu-evidence/).

Across 20,000 synthetic records, WebKit and Chromium each mounted 24–36 rows at 1440 × 900 and 1280 × 800. The page held 27 global listeners at rest. Each opening resolved one record, added 12 elements and four global listeners, and removed them on close. Triggers had no direct listeners.

| Browser | Open p50 / p95 | Close p50 / p95 |
| --- | ---: | ---: |
| WebKit | 1 / 2 ms | 1 / 1 ms |
| Chromium | 0.4 / 0.5–0.6 ms | 0.1 / 0.2 ms |

The 480 cycles measure trusted input to DOM readiness, not paint, native WKWebView, or live-cluster performance.

## Dev tools

- `/?screen=parts&part=Menu`: interactive menu gallery in `OMNIVIEW_UI=next`.
- `packages/kit/probes/row-menu-probe.mjs`: WebKit and Chromium lifecycle checks at 1440 × 900 and 1280 × 800. Set `BENCHMARK_SAMPLES=40` and `REPORT=<path>` to collect timings.
- `packages/kit/probes/menu-shots.mjs`: capture open menus from real interactions; set `SHOTS_DIR=<path>` to select the output directory.
