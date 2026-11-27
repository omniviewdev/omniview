# T6-settings: the terminal's settings, declared by the host and applied live (#697 step 1, "Declare and read")

Worktree: `~/omniview/wt/t697-settings`. Branch: `feat/terminal-settings` (from `origin/main` `d91a8d70f`). Not pushed, no pull request.

## What is declared (`internal/settings/terminal.go`, category `terminal`)

Typed, validated, with the producer's own bounds. A value outside them is refused at the commit (`Setting.Validator`), and the page reads every value as one inside them anyway (`preferences.ts`: an older host or a file edited by hand may carry one outside).

| Id | Type | Default | Bound |
|---|---|---|---|
| `fontFamily` | text | `""` (the theme's face) | a comma list of names, at most 256 bytes; each name is letters, digits, space, `.`, `-`, `_`, in one pair of quotes or none. No `;`, no `url(...)`, no brace, no backslash, no line break |
| `fontSize` (kept) | integer | 12 | 6 to 72 (a validator now; there was none) |
| `lineHeight` | float | 1.5 | 1 to 2, a multiple of the font size; a row is never shorter than the font's own row (the emulator takes no multiple under 1) |
| `scrollback` | integer | 5000 | 0 to 100000 |
| `cursorStyle` (kept) | text | `block` | `block`, `underline`, `bar` (a validator now) |
| `cursorBlink` (kept, legacy) | toggle | **true**, unchanged | |
| `cursorBlinkNext` (new) | toggle | false | the new tool's own key, see the decision below |
| `macOptionIsMeta` | text | `auto` | `auto`, `on`, `off`. `auto` is "true for US and US International, else false" and is the page's later step (2), not this one |
| `bell` | text | `visual` | `off`, `visual` |
| `gpuAcceleration` | text | `auto` | `auto`, `on`, `off` |
| `copyOnSelect` | toggle | false | |
| `multiLinePasteWarning` | text | `auto` | `auto`, `always`, `never` |

No bound Go call was added (the category is data): `internal/auditgate/policy.json` is unchanged and `task check:bindings-check` is clean.

## The cursorBlink decision

The new tool reads a NEW key, `cursorBlinkNext` (label "Blinking Cursor (new terminal)", default false). The legacy `cursorBlink` keeps its declared default (true) and is not read by the new tool at all.

Why a new key and not the same one:

- The same key cannot give the new tool "idle is zero timers" and the legacy UI "true" at once: a setting has one default, and the snapshot cannot tell "the person left it" from "the person chose true" (value equals default either way). Reading `cursorBlink` and treating "equals the default" as unset would turn every person who chose true into false.
- Changing the declared default would change the legacy UI (the issue forbids it).
- The cost is two toggles named alike on the Terminal page for as long as both UIs live. The label of the new one says "new terminal". When the legacy UI goes, `cursorBlink` goes and `cursorBlinkNext` can be renamed by a migration (`MigrateTerminalValues` is the place).

This step does NOT apply the blink: `cursorBlinkNext` is read (`preferences.cursorBlink`) and `xtermEngine.ts` still fixes `cursorBlink: false`. Step 2 applies it.

## What the page reads and what it applies live (exactly)

Read (`preferences.ts`, one store over `SettingsService.GetSnapshot`, the event `settings/changed`): all eleven of the page's settings: `fontFamily`, `fontSize`, `lineHeight`, `scrollback`, `cursorStyle`, `cursorBlink` (from `cursorBlinkNext`), `macOptionIsMeta`, `bell`, `gpuAcceleration`, `copyOnSelect`, `multiLinePasteWarning`.

APPLIED LIVE to every open terminal in this step, with no new emulator and no scrollback lost: `fontFamily`, `fontSize`, `lineHeight`, `cursorStyle`.

READ ONLY here (applied by later steps): `cursorBlink` (step 2), `scrollback` (read when the emulator is MADE: a terminal opened later has it; a change does not reach one that is open; step 2), `macOptionIsMeta` (step 2), `bell` (step 3), `gpuAcceleration` (step 4), `copyOnSelect` and `multiLinePasteWarning` (step 5). A change of any of these is read and tells nobody (a unit test: `screen.test.ts` "are not applied for a change of what the emulator is not told of").

How a change travels: the host emits `settings/changed` (one event) -> the store asks for the snapshot (one question) -> if a value the terminal reads moved, every screen is told once -> a screen applies the look when it is shown, and when it is shown again if it was not (a hidden terminal measures nothing behind a hidden element, so it takes the change on show). `settings/changed` listeners and the snapshot are held only while a screen is alive; with none, nothing is asked and no listener is held.

Decisions:

- The person's size is multiplied by the theme's text scale (the swatch's size over 12 px), so "UI Text Size" still reaches the terminal as it did; at 100 percent it is the person's number. The person's line height is a multiple of that size (default 1.5: the mock's 18 px at 12 px); the theme's own row is the fallback when there are no settings.
- The person's font names come BEFORE the theme's face in the list, so a name that is not installed falls through to the theme's face and never to the browser's serif.
- A terminal is made after the host's first answer (`settled()`, at most 1.5 s: a host that does not answer does not hold a terminal), so a font that is not the default is known before the first cell.
- `calibrate()` in `xtermEngine.ts` threw (the emulator refuses `lineHeight < 1`) whenever the wanted row was shorter than the font's own row, which the new settings made reachable; it now clamps at 1. This was found by the probe (rows of 23 px, the change half-applied).

## Font before `open()` and before a change measures

`screen.ts` `start()` awaited `fontsReady` before the first emulator already; it now also waits for the settings' first answer so the awaited family is the person's. `look()` awaits `fontsReady` when a change CHANGES THE FAMILY, then re-reads the appearance and applies it (a later change that came meanwhile wins; the earlier one is dropped). A size, line-height or cursor change needs no font and is applied before the call returns. `addon-web-fonts` is not installed and is not needed: `document.fonts.load` of the font string is what the page already used.

Proof in a REAL browser and the real emulator (DOM renderer, WebKit and Chromium, 1440 x 900 and 1280 x 800), `terminal-settings.mjs` (section names are the assertion names): a face `ProbeFace` (Inter under another name, 12.08 px a cell against the theme face's 7.20 px) whose file comes 600 ms late:

- `settings.font-open`: a terminal made with the family already set has the loaded font's cell (111 columns, 12.081 px against 12.081 measured on a canvas after the load).
- `settings.font-live`: the family chosen while a terminal is open: the same cell, and the host is told the new column count.
- Controls `settings-font-unloaded-open` and `settings-font-unloaded-live` make `FontFaceSet.load` answer at once with nothing loaded (what measuring before the load is): the cell is the fallback's and the assertion trips.

## Tests, first and seen red

- Red commit `cd1369ca5` (tests only): in a clean checkout of it, `go test ./internal/settings -run 'TestTheTerminal|TestTheLegacy'` fails 4 tests by assertion (the settings are not declared, the bounds are not enforced, `cursorBlinkNext` is missing). The vitest files fail to load there (`preferences` does not exist yet); when they were written against the old code before the implementation, `xtermEngine.test.ts` failed by assertion (`cursorStyle` `block` against `bar`) and the seven new `screen.test.ts` tests failed by assertion (nothing applied, no listener).
- Green commit `8241c2072` (declaration, store, look, application, wiring).
- Emulator of each page test: `xtermEngine.test.ts` "the person's settings on a real emulator" is the REAL xterm (jsdom, no layout: it proves the options and the buffer, not the cell); `screen.test.ts` "the person's settings" is a FAKE engine (the order of the calls: first answer, font, hidden, disposal); `appearance.test.ts` reads swatches in jsdom; `preferences.test.ts` has no emulator. The real renderer's cell is the probe's (real xterm in WebKit and Chromium).
- Drift: `TestTheUIsCopyOfTheTerminalCategoryHasEverySettingTheHostDeclares` ties `ui-next/shell/settings/model/testing.ts` to the declaration (its regex now takes a decimal default). Its control found a real mistake in my own fixture (an unescaped apostrophe in a description).

## The controls, run whole

`ui-next/shell/probes/terminal-settings-controls.sh` (from the repository root; `FIXTURE_DIST=<a build>` reuses a build): 15 controls, each planted, each run with its assertion (DETECTED) and, for the probe's, with the assertion dropped (NOT DETECTED); the source and Go ones also run clean first (must pass) so that a control that proves nothing is a line of the table. It restores every file it touched, whatever happens.

- probe: a setting the page never hears (`settings-not-live`), an emulator made for the change (`settings-recreate`), the scrollback lost by the change (`settings-scrollback-lost`), a font measured before it loaded, twice (`settings-font-unloaded-open`, `-live`).
- source: the font not awaited, a change lost while hidden, a change applied that the emulator was not to be told of, the cursor style not applied, the legacy blink key read, a bound not held in the page, a font name not cleaned.
- Go: a bound not enforced, a font family that takes a semicolon, a setting missing from the UI's copy.

The first whole run found two weak controls: the semicolon control was not seen (the adversarial list had no value whose only fault was `;`; `Menlo;monospace` and `Menlo; monospace` are in it now), and the drift control failed clean (the apostrophe above). Both fixed; see the result below.

CI: the probe is a unit (`terminal-settings`, 100 s ESTIMATE) and its controls a unit (`terminal-controls-settings`, 100 s ESTIMATE) in `scripts/ci/probe-units/terminal.mjs`, listed in the manifest; `node scripts/ci/probe-shards.mjs check` is ok. The seconds are the laptop's guesses, to be set from the first nightly figure.

## Commands and results

All on the final tree (branch head; commits `cd1369ca5` red tests, `8241c2072` implementation, `4d48e3638` label fix, `59cf39074` probe and controls, then this file):

| Check | Result |
|---|---|
| `go test -race ./internal/settings/...` | exit 0 |
| `golangci-lint run --new-from-rev=origin/main ./internal/settings/...` | 0 issues (the first run had 5: `exhaustruct`, 4 `goconst`; fixed) |
| `task bindings`, `task check:bindings-check` | exit 0, no bindings change (the category is data, no bound type changed) |
| `tsc -p tsconfig.app.json`, `tsconfig.test.json`, `packages/kit` | exit 0, exit 0, exit 0 (needed `task packages`; its dirtied files were restored with `git checkout --`, not committed) |
| `eslint ui-next --report-unused-disable-directives` | exit 0 |
| `vitest run ui-next/shell/panel/terminal ui-next/shell/settings` | 62 files, 2407 tests, exit 0 |
| `vitest run ui-next/shell` (whole shell, before the final label commit) | 230 of 232 files passed; `core/panel/fuzz.test.ts` timed out at 5 s under load 8 to 19 and `notices/centreList.test.ts` failed once; re-run alone, centreList passed and fuzz timed out again: neither imports anything of this slice (`core/panel` is untouched) and the load average of the machine was 14 to 19 (other agents' seams) |
| `terminal-settings-probe.mjs`, WebKit and Chromium at 1440 x 900 and 1280 x 800 | PASS, 12 assertions (3 sections x 2 engines x 2 viewports). Real xterm, DOM renderer, the probe's own host and synthetic shell |
| `terminal-settings-controls.sh` | exit 0: "every control was seen" (15 lines, above) |
| `settings-probe.mjs` `SECTIONS=page,sheet,keys,a11y`, both engines and viewports | 3620 checks, 0 failures: the Terminal page with the new fields in the sheet and the window: nav, rows, keys, axe in nine themes |
| `task local:seam -- terminal-core,settings` (`SEAM_SHELL=/bin/bash`) | exit 0 (PASS in WebKit and Chromium; the first run FAILED on the ambiguous switch name, see below) |
| `node scripts/ci/probe-shards.mjs check` | ok (102 units, 56 control units, 455 controls). `scripts/ci/probe-shards.test.mjs` has 8 tests that fail here only for lack of `jq` ("jq is needed for this test") |

The first seam run found a real regression: the new toggle's label "Cursor Blink (new terminal)" matched the legacy toggle's accessible name by substring, so `getByRole('switch', { name: 'Cursor Blink' })` (seam `settings`, `seam.check.mjs` 6572) matched two switches. The label is "Blinking Cursor (new terminal)" now (commit `4d48e3638`).

I looked at the Terminal page in the sheet (WebKit, 1440 x 900, `probe-sheet-over-shell.png`): the new settings draw as a select (Bell), switches (Copy on Select, both blinks) and text/number fields (Font Family, Font Size) with the generic rows, descriptions and Reset. The settings are listed in the field model's own order (by id), not grouped by what they do; grouping is the field model's (FM1) and was not changed here.

## Not verified

- The Settings WINDOW natively (a Wails window): only the probe of the sheet and the fixture's page. The sheet draws the new fields through the generic field model (a switch, a select for each closed choice, a whole number, a decimal and a text); no new view code was written for them.
- "A setting survives a reload" is the host's store (Go), which persists every setting; the probe's fixture keeps its settings in the page, so no reload is proved here.
- The GPU renderer's cells (the probe uses `?renderer=dom`): the font's cell is the same measure, rounded to a device pixel by the GPU renderer; not run.
- A change while a flood runs and the 10^9 scrollback and a font that is not installed at all are covered by the bounds (Go and page) and by the fallback list, but not by a probe with a flood in this step.
- Option as Meta by layout, AZERTY and the real shell: step 2.
- `core/panel/fuzz.test.ts` timed out (5 s) in a whole run of `ui-next/shell` on a loaded machine and passed in the same load only partly; the files are untouched by this slice.
