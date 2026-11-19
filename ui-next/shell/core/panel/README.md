# The panel model

The bottom panel's state and its rules, as pure TypeScript: no React, no DOM, no timers of its own (`purity.test.ts` fails the build if one is imported). The UI (`../../panel/`) is a thin reader of it. Tests first: `store.test.ts` (behaviour), `persist.test.ts` (snapshot), `height.test.ts` (clamp), `fuzz.test.ts` (150 seeds of 120 random operations: every invariant after every operation, and what it saves comes back whole).

## What it holds

| Part | What |
| --- | --- |
| `open` | Whether the panel is drawn. Closed is a 0 px row; its sessions and their state persist. |
| `height` | The height the user **chose** (`null`: the default). The drawn height is `resolveHeight(chosen, viewport)`, whose twin is the CSS `clamp()` in `Panel.module.css`, and a window that no longer fits it brings it within its limits for good (`fitHeight`, on load and on every resize: the mock's `panelClamp`, S103), so a window made small and large again keeps the smaller panel. |
| tools | A registry: tools of the host by plain id (`logs`), tools of a plugin by `plugin:local`. Each has a label, a glyph, an order. A plugin's tools leave with the plugin (`syncPlugins`). |
| sessions | Per tool: id, title (head and tail truncate in the strip), scope, state (`starting` `running` `ended` `failed`), `since` (moves only with the state), cause, owning plugin, an optional route to the resource. |
| `active` | The session on screen per tool; `tool` is the tool on screen. |
| `mounted` | Sessions whose body has been shown, in insertion order. A body stays mounted until its session closes or its plugin leaves (a streaming session keeps its buffer: HLT-32). |

## Rules

- **Close and end are different.** `closeSession` removes the tab and the body; the session on screen passes to the next one in the tool's strip, else the previous. `setSessionState` ends or fails a session and keeps it.
- **A plugin that goes away is gone in one transaction**: its tools, its sessions hidden, its running sessions ended with `UNLOADED_CAUSE`. They come back ended, never running, if the plugin returns.
- **A session never covers the page by itself.** `openSession` reveals the panel unless it is told not to (`reveal: false`: restored, adopted, retried).
- **Size**: minimum 120 px, at most the window minus 312 px, default `min(400, max(240, 30%))`. A drag released below 80 px hides the panel and keeps the old height. `heightKey` maps Up/Down (16 px, 64 with Shift), Home (minimum), End (maximum), Enter (default).
- Every change is one `Step`: a new state (or the same object when nothing changed, so React bails out) and a result. `checkInvariants` is the test's oracle.

## Saved form

`serialise` writes `{ version, open, height, tool, active, sessions[] }`: identity and choices, never state or output (at most 50 sessions). `restorePanel` validates, repairs what it can (it reports `repaired`), drops a session that is not valid data and nothing else, makes every session `ended` with `RESTORED_CAUSE`, and does **not** open the panel (S116). A value it cannot read gives a closed panel with the tool and height it could read. `MIGRATIONS` is empty at version 1; the chain is `../tabs/persist`'s `migrate`. `createPanelSaver` writes through the generic debounced saver (`../saver.ts`). The host restores and saves it together with the tabs and the rail's choice through `../../session/` (its README).
