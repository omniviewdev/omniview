# Settings

Settings draws host and installed-plugin settings from the settings service (`backend/pkg/settings`). The service owns snapshots, validation and commits. Settings never infers a stored secret from its redacted value.

Status, the legacy findings, the decisions and what is not done: `docs/ui-next/status/ST1.md` (the resume file).

## Two containers, one content

Where the app has native windows, Settings is a **window of its own** (kind `settings`, non-modal, one instance, hidden rather than destroyed). In a browser it is the **same content as a modal sheet**. Both next-shell frames prefer 1280 × 800 px; the native window fits the screen's work area and the sheet leaves clearance around it in the viewport.

| Container | Where | What draws it | Opens by |
| --- | --- | --- | --- |
| the window | native app | `window.tsx` (lazy chunk) -> `view/WindowSurface.tsx` | the host: the menu's Settings (Cmd+, is the menu's accelerator), the gear and the palette command ask `WindowClient.OpenSettings('')`; a second ask focuses the open window |
| the sheet | browser | `surface.tsx` (lazy chunk) -> `view/Surface.tsx` (the kit's `Sheet`) | the gear, the palette command "Settings", Cmd/Ctrl+Comma (`chords.ts`, `useSettingsChords.ts`) |

Both draw `view/Body.tsx`: a 244 px navigation pane and a separate page pane with a 5 px gutter. The form fills the page with 12 px insets on both sides. The panes stack on narrow screens. Search stays above the scrolling Core and Plugins tree. The page pane also holds loading, Retry and empty states. The browser sheet uses the kit's dialog header. The native window has a draggable 41 px caption with a Close button. Escape and Cmd+W / Ctrl+W hide it.

### How the entry decides

`ui-next/main.tsx` renders `WindowKindScreen`. In a browser there is no native window: the shell is drawn at once. In a native window the page asks the host's window service which window it is (`resolveWindowKind`: `Window.Name()` and `WindowClient.List()`, the kinds) and draws nothing until it knows; kind `settings` draws `window.tsx` and NO shell, any other kind (and any failure) draws the shell. `?screen=settings-window` draws the window's content in a browser page: development, the seam check and the probes use it as they use `?screen=parts`.

The window follows the host's window service (`backend/window/settings.go`): `OpenSettings(target)` makes a request `{requestId, target, visible}` (event `settings/state`; `GetSettingsState` reads it); a new `requestId` with `/settings?category=<id>` selects that page (`model/target.ts`), a change of `visible` is a show or a hide, a show refetches. A window that is hidden draws nothing (`content-visibility: hidden`) and runs nothing.

## Layers

- `model/` is plain TypeScript with no React or kit import (`model/purity.test.ts` holds that): `types.ts` (the host's snapshot and the two clients), `adapter.ts` (the host's categories and settings -> pages, rows, the field model's definitions; what is NOT drawn is listed there as `NOT_DRAWN`), `session.ts` (the snapshot, the form store of `shell/core/fields`, apply-on-change, the host's events, announcements), `target.ts`, `testing.ts` (the host in memory, for tests and probes; nothing in the product imports it).
- `host.ts`, `chords.ts`, `context.tsx`, `Settings.tsx`, `Gear.tsx`: the always-loaded part. The control (`createSettingsControl`) holds whether the sheet is open, the page it was last on and the loading of the rest; closed, it is a store that holds nothing (no node, no listener, no timer). With `openWindow` it asks the host for its window instead and falls back to the sheet if the host cannot.
- `runtime.ts`: the production clients over the generated bindings (`SettingsService`, `WindowClient`, `Events`).
- `view/`: `Body`, `Nav`, `Page`, `SettingRow`, `words` (the vocabulary: what the lane says), the two containers.

## What a row is

Apply-on-change (S125): a switch, a select, a stepper or a text field commits when the field model says it does (a text field on Enter or blur), the host validates and either applies or answers with its own words (shown in the row's lane, the typed text kept), and a value that differs from the default offers Reset in the row's trailing slot. There is no Save and no unsaved question. A secret is drawn only for a sensitive setting the host says whether it holds (`Snapshot.Stored`): its value never reaches the page, the field says "Saved" or not, and clearing commits the empty string.

**Colors** offers the kit's nine built-in themes as radio cards. Each miniature window uses that theme's palette. The saved theme stays visible even if this build cannot render it. **Layout and text** uses segmented choices for density and motion and a five-stop text-size slider. The labels and stored scale values (80%, 90%, 100%, 110%, 125%, stored as strings without `%`) come from the host options. Choosing a card or segment applies that setting; a slider commits once per completed adjustment. Reset restores the host's declared default. A rejected write restores the applied choice and describes the error in the field.

**Window material** and **Surface opacity** follow when the host declares those settings. Unsupported materials remain visible but unavailable. The four opacity sliders preview locally and commit integer percentages on release. Cancellation returns to the latest applied value, including an edit from another window. Reset material settings sends only the six material defaults in one commit.

## Staying true to the host

The session shows what the host holds and asks again when that may have changed: on the host's `settings/changed` event, when the page is looked at again (focus, visibility, `online`: `view/Body.tsx`) and when the page's events connection comes back (`onEventsReconnect` in `@omniviewdev/runtime/runtime`: in server mode a dropped socket is reopened and nothing told meanwhile is replayed). Only the answer to the newest question is given to the form; a question that is lost is asked again after waits of 0.5, 1, 2, 4 and 8 s (15.5 s in all, `RETRY_WAITS` in `model/session.ts`), and then the session waits to be told something. At rest it holds no timer. What a host-side revision would let it delete is the brief in `docs/ui-next/status/ST1.md` section 8.

## Not drawn yet (the next slices, with what each needs)

`terminal.nativeApplication` (a native-application chooser listing what the host finds), developer-only settings, multi-select / colour / date-time types, general-purpose schema grouping, AI Tools, Updates and Notifications pages.

## Checks

`pnpm exec vitest run ui-next/shell/settings` (model, control, chords, containers, kind screen, stylesheet). Real-engine and real-host checks: the seam scenario `s` (`ui-next/plugins/e2e/seam.check.mjs`) and the settings probe (`ui-next/shell/probes/settings-probe.mjs`).
