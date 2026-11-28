# T6-apply: the cursor's blink, the scrollback, Option as Meta and the bell, applied (#697 steps 2 and 3)

Worktree: `~/omniview/wt/t697-apply`. Branch: `feat/terminal-cursor-meta-bell` (from `origin/main` `a37c3fcfb`, after #807). Not pushed.

Step 1 (#807) declared these settings and READ them; this step APPLIES four of the ones it only read: `blinkingCursor`, `scrollback`, `macOptionIsMeta` and `bell`. Still read only: `gpuAcceleration` (step 4), `copyOnSelect` and `multiLinePasteWarning` (step 5).

## What is applied, live, to every open terminal

All through `Engine.setBehaviour({ scrollback, cursorBlink, optionIsMeta })` (`engine.ts`), told by `screen.ts` when a value it reads moves: no new emulator, nothing of the look touched, applied hidden or shown (nothing is measured or drawn for it).

- **Blink** (`xtermEngine.ts`): the emulator blinks only with the focus AND the setting. It is made with the blink off; `blinkWhenFocused` sets `options.cursorBlink = wantsBlink && hasFocus` from the textarea's `focus` and `blur`. The default stays off (`blinkingCursor`, step 1's decision). Idle is zero timers: with the setting on and no focus, the emulator holds nothing.
- **Scrollback**: `terminal.options.scrollback = n`. The emulator itself trims the oldest lines when the number is smaller and keeps what it has when it is larger (a larger number returns nothing that was trimmed). Asserted in lines on the real emulator: 100 lines in a scrollback of 50 are 54 buffer lines (50 + 4 rows), first `line 46`; at 10 they are 14, first `line 86`, and the lines kept are exactly the last 14 of before; at 200 they are still 14 and the first is still `line 86`; 60 more lines grow it to 74.
- **Option as Meta**: `terminal.options.macOptionIsMeta`. `on` and `off` are the person's word. `auto` is the keyboard's (`layout.ts`): true for a US layout (US and US International have the same base keys, and the Ghostty rule is "true for US and US-International"), false for any other. The page asks `navigator.keyboard.getLayoutMap()` (Chromium, secure contexts) and compares the characters of the keys on which layouts differ (`KeyQ`, `KeyW`, `KeyA`, `KeyZ`, `KeyM`, `;`, `'`, `` ` ``, `[`, `]`, `\`, `-`, `=`, `,`, `.`, `/`): all must be what the US layout types. **Where the layout is unknowable (no API: WKWebView and Firefox; a refused call; an answer that is not a map) `auto` is OFF: Option types characters**, the conservative answer (a person on AZERTY who cannot type `@` is worse off than a person on US who sets Meta on once). The layout is asked ONLY for `auto` (when the emulator is made, and when the setting changes), never for `on` or `off`. It is not asked again when the person switches input sources while the setting stays `auto`: [NOT DONE] `navigator.keyboard`'s `layoutchange` event is not listened to.
- **Bell** (`screen.ts` `onBell`, `bells.ts`): `visual` (default): a bell in a terminal that is SHOWN fades its screen, as before; a bell in a terminal that is NOT shown fades nothing (nobody sees it) and marks its tab. `off`: nothing at all, shown or not, no fade and no mark (the issue says the setting is "for the screen fade"; "off does nothing" was the brief's, and a person who turned the bell off has not asked for a mark). Nothing beeps (the host never plays a sound: asserted in the probe by counting audio contexts and `play()` calls).
- **The mark on the tab**: a new `SessionMarks` seam in the panel (`PanelBindings.marks`, `host.ts`: `subscribe` and `of(session)`, the same shape as `badges`), drawn by `SessionTabs` as a 6 px dot (`.sessionMark`, `--ov-warning-fg`, no animation) after the name, and said in the tab's accessible name: `zsh, bell rang`. `terminals.marks` (`bells.ts`, an external store: the same object while the mark stands, a notification only for a change) is what the Terminal tool gives. The mark ends when the body is shown (`TerminalBody` effect) and when it is closed (unmount). A session that was never shown has no emulator, so it cannot ring: a bell of a restored terminal that was never opened is not marked (not covered).

## Tests, first and seen red, and the emulator of each

- Red commit `d2eed6d3f` (tests only): 26 tests failed by assertion or at the import of a module that did not exist (`layout.ts`, `bells.ts`, `setBehaviour`, `terminals.marks`, `PanelBindings.marks`).
- **Real xterm (jsdom)**: `xtermEngine.test.ts` "the behaviour of a real emulator" (the options it holds, the focus gate, the buffer's line counts for scrollback). jsdom has no layout, and xterm makes NO blink timer there (measured: 0 timers with the blink on and the focus), so the timer count is the probe's.
- **Fake engine**: `screen.test.ts` "the behaviour the person's settings give the emulator" and "the bell" (the order of the calls, the layout it is asked, hidden and shown).
- No emulator: `layout.test.ts`, `bells.test.ts`, `SessionTabs.test.tsx` (the mark), `terminals.test.ts` (a bell in a hidden body marks the tab; showing it clears it; closing clears it).
- **Real xterm in WebKit and Chromium**, at 1440x900 and 1280x800: the probe `terminal-apply.mjs` (below). The probe's shell is the synthetic one.

## The probe (`terminal-apply-probe.mjs`, sections in `terminal-apply.mjs`; 10 assertions in each engine and viewport, 40 in all)

- `apply.blink`: the page's live timers (a wrapper of `setTimeout`, `setInterval` and their clears, installed before the page's scripts) plus the running animations inside an emulator, COUNTED after the count has settled (the same twice, 15 frames apart: never a time). The DOM renderer (`?renderer=dom`, what the probe forces) blinks with a CSS animation, not a timer: both are work for every frame, so both are counted. Result: 0 at rest, 0 with the blink off and the focus, **1 with the blink on and the focus**, 0 with the blink on and no focus, 1 when the focus comes back, 0 off again. The GPU renderer's timer (xterm's `CursorBlinkStateManager`) is not exercised here (the fixture's GPU path is not forced in headless): [NOT VERIFIED] with WebGL, though the gate is the same option.
- `apply.scrollback`: `dense 400 1` into a scrollback of 5000: first line 0; 60: first line 332 (68 held on a screen of 9 rows: 60 above and the rows); 2000: still 332. In both engines and both viewports.
- `apply.meta-on`, `-off`, `-auto`, `-live`: the page says `MacIntel` before its scripts (the emulator reads the platform once). Option B is the keydown a Mac makes (`key: 'ƒ'`, `code: 'KeyB'`, `keyCode: 66`, `altKey`), plus the keypress for `ƒ` when nobody takes the key. The host's byte log: `on` gives `ESC b` and no character (with an AZERTY keyboard: the person's word wins); `off` gives `ƒ` and no ESC (US keyboard); `auto` with a US map gives `ESC b`, with an AZERTY map and with no keyboard API gives `ƒ`; changed while open, off gives `ƒ` and on again `ESC b`.
- `apply.bell-mark`, `-visual`, `-off`, `-silent`: two terminals; the first runs `bell-later 400` (a program that rings after 400 ms) and the second is shown: the first tab gets the mark and "bell rang" in its name, the shown one has none; showing the first clears the mark; a bell in the shown terminal changes `data-bell` and marks no tab; with `bell: off` neither the fade nor a mark happens (a command after the bell proves it was parsed); no audio context, no `play()`.

### Real shell

- **The seam** (`seam.check.mjs`, `terminal-programs`, in unit `terminal-core`): Alt B at a REAL bash prompt moves back one word. `echo one two`, Alt B, `X`, Enter runs as `echo one Xtwo` and prints `one Xtwo`. On a Mac page the check first commits `macOptionIsMeta: on` through the host's settings service (and `auto` after). On Linux (this machine) Alt is Meta whatever the setting is, so this half proves the real readline's answer to the bytes the emulator sends; **the Mac half (Option types a character with the setting off, in a real shell) is the probe's byte log, not a real shell**: the seam cannot say it is a Mac on a Linux host, and no Mac was available here.
- Option on AZERTY (Alt+E for the euro or accents): the probe's `auto` with an AZERTY map types the character; a real AZERTY keyboard was not available.

## The controls, run whole

`ui-next/shell/probes/terminal-apply-controls.sh` (from the repository root; `FIXTURE_DIST=<a build>` reuses a build; it restores every file it touches): each control run clean first (must pass), then planted (must fail on the assertion), and the probe's also with the assertion dropped (`ASSERTION_OFF`: NOT DETECTED), in both halves.

- probe (both engines): a timer left with no focus, a timer left with the blink off, a scrollback and an Option never heard, a wrong layout (US for all), a mark lost, a mark stuck, a screen that fades with the bell off, a sound.
- source: the blink ignores the focus, the scrollback not applied, Option not applied, behaviour not told, the layout asked for `on` and `off`, an unknown layout is Meta, one US key is a US layout, the layout's refusal uncaught, the bell off ignored, a hidden screen faded, the mark told twice, the clear told for nothing, the mark never cleared on show, the mark not in the tab's name, the mark drawn for every tab.

The controls run in both engines (rule 25), not Chromium only. A control that does not compile is reported WRONG by the script (`control()`).

CI: `terminal-apply` (probe) and `terminal-controls-apply` (its controls) are units in `scripts/ci/probe-units/terminal.mjs` with ESTIMATED seconds (100 and 200), and are in the manifest; `node scripts/ci/probe-shards.mjs check` is ok.

## Commands and results

On the final tree (commits `d2eed6d3f` red tests, then the implementation commit; head in the git log):

| Check | Result |
|---|---|
| `tsc -p tsconfig.app.json`, `tsconfig.test.json`, `packages/kit` | exit 0, 0, 0 (after `task packages`; its shim and `dist/.gitkeep` restored with `git checkout --`, never committed) |
| `pnpm lint` | exit 0 (0 errors, 8 warnings that were there before); eslint of the probe files and the seam: exit 0 |
| `vitest run ui-next/shell/panel ui-next/shell/settings ui-next/plugins/host` | 168 files, 5589 tests: 5587 passed. Two failures that are not this slice's: `PluginHost.settings.test.tsx` "draws the sheet from the gear in a browser" fails the same way on a clean worktree of `origin/main` `a37c3fcfb`; `PluginHost.unload.test.tsx` passed alone (16 of 16) and timed out only in the whole run under load 16 to 19 |
| `terminal-apply-probe.mjs`, WebKit and Chromium, 1440x900 and 1280x800 | PASS, 40 assertions |
| `terminal-settings-probe.mjs` (step 1's, still green) | PASS, 12 assertions |
| `terminal-apply-controls.sh` WHOLE | exit 0, "every control was seen": 9 probe controls in both engines (each detected, and not detected with its assertion dropped) and 15 source controls (clean passes, planted fails). Its first whole run found two weak probe controls (a node removed from React's tree crashed the section; a planted mark leaked into the next assertion) and a missing check (the mark element itself), all fixed and rerun whole |
| `terminal-settings-controls.sh` WHOLE | exit 0, every control seen |
| `task local:seam -- terminal-core,terminal-restart,terminal-find` (`SEAM_SHELL=/bin/bash`) | exit 0, with the new real-bash Alt B check in `terminal-programs` |
| `pnpm run build`, `node --test scripts/ui-flavour.test.mjs` | exit 0, 7 of 7 |
| `node scripts/ci/probe-shards.mjs check` | ok (104 units, 57 control units, 465 controls) |


## Not verified

- A Mac, a real AZERTY keyboard, WKWebView's own (absent) keyboard map, and Option typing a character in a real shell.
- The GPU renderer's blink timer.
- `layoutchange` (a person switching input sources while `auto`).
- A bell in a session that was never shown (no emulator).
- `PluginHost.settings.test.tsx` "draws the sheet from the gear in a browser" fails in this environment on `origin/main` as well (checked on a clean worktree of `a37c3fcfb`: the same failure), and `core/panel/fuzz`, `LogStreams.fuzz` and `PluginHost.unload` time out at 5 s under this machine's load (16 to 19): none touches this slice.
