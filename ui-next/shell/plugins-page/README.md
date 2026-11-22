# `ui-next/shell/plugins-page/`: the Plugins page, first slice (PL1)

The host's own page for the plugins that are installed (ch16 S9, S133 to S136): the singleton tab `host:plugins` (route `{ plugin: 'host', contribution: 'plugins' }`), a list on the left and the detail of the plugin on screen on the right. It is **host code and plugin-agnostic**: the plugins it shows are data from the host's inventory, and no plugin word appears here (the vocabulary guard scans this directory, tests, comments and recordings included). Status, evidence, the gaps in what the backend says and the decisions are in `docs/ui-next/status/PL1.md`.

## What this slice draws, and what it does not

Drawn, on the host's real state: the **Installed** list (name, version, the state word, the host's sentence for a failure), the detail of one plugin (identity, version, origin, the state, the facts its manifest gives, a status lane, a details card) and the actions that are real today end to end: **Reload** (`ReloadPlugin`), **Retry** (the window's own, the one the rail's failed tab has), **Enable** (`SetPluginEnabled(true)` and then `ReloadPlugin`: turning a plugin on does not start it), **Disable** (`SetPluginEnabled(false)`) and **Uninstall** behind a confirm that says what the host really erases and keeps. Each shows its work in progress, reports a failure as a sticky notice of the host with a Retry, and says what came of it from the host's events and from a read of the inventory, never from optimism.

Not drawn (no dead control stands in for them). Each later slice, and what it needs:

| Later slice | Needs |
|---|---|
| Marketplace (Browse), search, filter and sort | the marketplace client in the window (`ListAvailablePlugins` pages the whole registry over the network; PL1-13); a cached list with an offline state |
| Install, update, downgrade, "Other versions" | progress and steps from the host (PL1-18), an update check (PL1-13), the registry's compatibility stored per installed version (PL1-14), a consent surface for permissions (PL1-17) |
| Install from a file or a folder, link a source folder | the host's native pickers (`InstallFromPathPrompt`, `InstallInDevMode`) or a path field; a trust dialog (PL1-16) |
| Versions, changelog, readme | the registry's version history and readme (network) |
| Permissions | a grant model: the host has only the declared capability kinds and `requires`/`exports` (PL1-17) |
| Per-plugin settings, "Open {plugin}", connection profiles | the Settings sheet's plugin section; the tab model's open from a host page |
| The Installed/Marketplace control, the resize handle of the list, the row switch | the first two need the later slices; the switch needs a roving grid with two cells per row |
| A rail entry and the New tab menu entry | the rail's host entries (S2a decision 1) and the New tab menu (S34) are not built; the palette's command "Plugins" is how the page opens today |

## Files

| Path | What |
|---|---|
| `core/types.ts`, `core/inventory.ts` | What the page reads of the host's inventory (`PluginInfo`), bounded and typed; the member that holds the raw text of the last error is never read |
| `core/events.ts` | The two events read for one plugin (`plugin/state_change`: an id and a phase; `plugin/enablement_changed`: an id and a flag), as values the host owns; no text |
| `core/state.ts`, `core/words.ts` | The one state of a plugin (the rail's words and the window's plugin store for the interface half; the host's phase for the rest) and the host's own sentences, including the Uninstall confirm's |
| `core/availability.ts` | What can be done now, and why not when it cannot (a plugin that is turned off is not reloaded; the product's own plugin is not uninstalled) |
| `core/model.ts` | The page's state: rows by id, one object per row until it changes, a notification for the row that changed and for nothing else, a logical clock that orders events against reads, the plugins the window holds through a reload, the five actions |
| `hooks.ts`, `PluginsPage.tsx`, `host.ts`, `index.ts` | React over the model, the page and its one dialog, the real host's bindings, the registration |
| `List.tsx`, `Row.tsx`, `Detail.tsx` and parts, `Tile.tsx`, `ConfirmUninstall.tsx`, `StateChip.tsx` | The panes, the plugin's tile (24 px in a row, 28 px in the header) and the dialog |
| `failureReport.ts` | A failed action as the host's sticky notice: the words are chosen by the CLASS of the error (`parseAppError(error).type`), never by its text |
| `probes/` | `world.mjs` (the invented plugins both sides of a probe draw), `mock-plugins-measure.mjs` and `mock-plugins.json` (the design's rectangles and paint for the scenes below), `fixture.tsx` and `plugins-probe.mjs` (the page over the real shell, against the mock) |

## The registration (the host's route registry)

`ui-next/plugins/host/hostPages.ts` is a registry of the host's own pages: `registerHostPage(page)` (one call each; `PluginHost.tsx` registers this page), read by the tab model's `describe` and `availability` (`contributions.ts`), by the page host that draws the route, and by the palette (`palette.ts`: a command `host.<page id>`, "Plugins", opens the singleton tab). A test or a probe registers `createPluginsPage(deps)` over fakes in its place. The frame of a host route has the window's rail (no entry of it is current: no plugin is on screen) and no sidebar track; choosing a plugin on the rail while a host page is on screen opens that plugin. The shell insets every page 12 px inside its island; this page takes that inset back so that its list is flush, as the mock's sidebar island is (`PluginsPage.module.css`).

## The reference (the mock) and the probe

`probes/mock-plugins.json` records the design's page in WebKit and Chromium at 1440 x 900 and 1280 x 800 for the scenes running, failed, disabled, starting, empty, uninstall, busy and rowStates, with the six invented plugins of `world.mjs` written into the mock's world. Where the mock draws the list in the shell's sidebar slot the page draws both panes in its island, so compare sizes and offsets inside each pane, not absolute x (the rail adds 40 px).

## Local parts and the kit part each should become

| Here | Kit part | Notes |
|---|---|---|
| `Row.tsx` (a selectable two-line row with a tile and a state chip) | `SelectableRow` | the mock's `H.listrow` with a lead tile |
| `Tile.tsx` (a plugin's glyph on a tint of its hue, at 24 or 28 px) | `KindTile` with a size and a tint | the kit's `KindTile` has two sizes and no fill; the hue is the plugin's accent, as the rail's and the kit's are |
| `Header.tsx` (an identity header with three fixed action slots and an in-place progress) | `IdentityHeader` | the mock's `H.identityHeader` |
| `StatusLane.tsx` | `Notice` | the mock's `H.notice`; the kit has none |
| `ConfirmUninstall.tsx` | `Dialog` | a native `<dialog>` with `showModal()`, as the palette's |

## Decisions to confirm

1. **Both panes are the page's, not the shell's sidebar.** The shell's sidebar is a tree of one-line entries; the mock's list is two-line rows with chips. Moving the list into the sidebar slot is a shell change (a `ShellSidebar` variant that takes a body).
2. **The row has no switch.** The mock's row ends in a switch; a switch in a roving list needs two cells per row and a grid. Enable and Disable are in the detail.
3. **Enable is two calls** (`SetPluginEnabled(true)`, then `ReloadPlugin`) until the host's `SetPluginEnabled(true)` starts the plugin (PL1-07).
4. **A failure is worded by its error's class**, never by its text, because the host's lifecycle errors are not gated (PL1-04, PL1-20).
5. **The uninstall confirm has no "delete its settings" box**: the host's call has no option, and the confirm says what is true.
