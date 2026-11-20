# The panel model

The bottom panel's state and its rules, as pure TypeScript: no React, no DOM, no timers of its own (`purity.test.ts` fails the build if one is imported). The UI (`../../panel/`) is a thin reader of it. Tests first: `store.test.ts` (behaviour), `persist.test.ts` (snapshot), `height.test.ts` (clamp), `invariants.test.ts` (the oracle sees each rule broken), `fuzz.test.ts` (150 seeds of 120 random operations: every invariant after every operation, and what it saves comes back whole).

## What it holds

| Part | What |
| --- | --- |
| `open` | Whether the panel is drawn. Closed is a 0 px row; its sessions and their state persist. |
| `height` | The height the user **chose** (`null`: the default). The drawn height is `resolveHeight(chosen, viewport)`, whose twin is the CSS `clamp()` in `Panel.module.css`, and a window that no longer fits it brings it within its limits for good (`fitHeight`, on load and on every resize: the mock's `panelClamp`, S103), so a window made small and large again keeps the smaller panel. |
| tools | A registry: tools of the host by plain id (`logs`), tools of a plugin by `plugin:local`. Each has a label, a glyph, an order. A plugin's tools leave with the plugin (`syncPlugins`). |
| sessions | Per tool: id, title (head and tail truncate in the strip), scope, state (`starting` `running` `ended` `failed`), `since` (moves only with the state), cause, owning plugin, an optional route to the resource, and `held` (below). |
| `active` | The session on screen per tool; `tool` is the tool on screen. |
| `mounted` | Sessions whose body has been shown, in insertion order. A body stays mounted until its session closes or its plugin leaves (a streaming session keeps its buffer: HLT-32). |

## Rules

- **Close and end are different.** `closeSession` removes the tab and the body; the session on screen passes to the next one in the tool's strip, else the previous. `setSessionState` ends or fails a session and keeps it.
- **A plugin that goes away is gone in one transaction**: its tools, the sessions in them hidden, its running sessions ended with `UNLOADED_CAUSE`. They come back ended, never running, if the plugin returns (PO1, the mock's rule: a plugin that is off contributes nothing).
- **One deviation from PO1: a held session (A21, widened by the lead's ruling of 2026-11-20).** Every session a plugin has in a tool **of the host** (the Logs tool; a plugin's own tools are not) is marked `held` when the plugin leaves, **whatever its state**. A session that was starting or running ends in the same transaction with `UNLOADED_CAUSE`; one that had already ended or failed on its own is kept AS IT WAS, its own state, cause and time untouched (a failed log is the one being read). Held sessions stay listed and mounted until the user closes their tab, whether their plugin is off or has come back: the lines a person is reading are theirs. A held session never changes again: `setSessionState` refuses it (`reason: 'held'`), the plugin's return and its leaving again change nothing, and a new press of the command opens a new session beside it. Everything else follows PO1: every session of a tool the plugin brought is hidden with it, and so is a session of a tool that is not registered; a session restored from a saved window stays hidden until its plugin has loaded (and, once it has, is a session like any other, kept when the plugin leaves). The stream behind a held session is closed by the registry that owns it (`../../panel/logs/LogStreams.ts`) so the backend session is not leaked; this model knows nothing of streams.
- **A session never covers the page by itself.** `openSession` reveals the panel unless it is told not to (`reveal: false`: restored, adopted, retried).
- **Size**: minimum 120 px, at most the window minus 312 px, default `min(400, max(240, 30%))`. A drag released below 80 px hides the panel and keeps the old height. `heightKey` maps Up/Down (16 px, 64 with Shift), Home (minimum), End (maximum), Enter (default).
- Every change is one `Step`: a new state (or the same object when nothing changed, so React bails out) and a result. `checkInvariants` is the test's oracle.

## The invariants, in words

`checkInvariants` returns a sentence for each rule a state breaks; the fuzz applies it after every operation. The rules: the order lists every session once; a session has a title, a tool and a plugin; a session that is not over has no cause; every session the strips choose is one of its tool's; a mounted body is mounted once, belongs to a session that is there, and is visible; the height is null or positive; a tool is sound and the host is never a live plugin. And, for A21:

> **Of a plugin that is off, the sessions that are listed (and so mounted) are the held ones, and nothing else of that plugin's is; a held session is a session of a tool of the host (its id has no colon) that is over, ended or failed; and it never changes until its tab closes.**

`checkInvariants` states the first two halves from `live` and `held` and not from `sessionVisible` (`s1 is mounted, its plugin is off and it is not held`, `the session s1 is held and is not over`, `... is held in acme:metrics, which is not a tool of the host`), so the rule is not checked against its own implementation; a held session may say no cause (it had ended on its own), so that is not a rule. The fuzz writes the listing rule out in the same words for the strips (a session is listed exactly when its tool is visible and its plugin is live or it is held) and checks the last half across operations (the same record, or none). `invariants.test.ts` breaks each rule by hand and expects its sentence.

## Saved form

`serialise` writes `{ version, open, height, tool, active, sessions[] }`: identity and choices, never state or output (at most 50 sessions). `restorePanel` validates, repairs what it can (it reports `repaired`), drops a session that is not valid data and nothing else, makes every session `ended` with `RESTORED_CAUSE`, and does **not** open the panel (S116). A value it cannot read gives a closed panel with the tool and height it could read. `MIGRATIONS` is empty at version 1; the chain is `../tabs/persist`'s `migrate`. `createPanelSaver` writes through the generic debounced saver (`../saver.ts`). The host restores and saves it together with the tabs and the rail's choice through `../../session/` (its README). **A held session is saved as every session is**, by its identity: `held` is a fact of this run and is never written, and a restored session is never held (a document that says it is, is not believed). It comes back ended with `RESTORED_CAUSE`, with no lines, hidden until its plugin has loaded, and from then on like any session of the host's tool: kept when its plugin leaves (A21: saved as ended without lines, not left out).
