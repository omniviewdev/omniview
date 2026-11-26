# T698-paste: one paste path, and the xterm.js line (#698 items 13, 14, 16)

## Goal

- Item 13: every paste (the platform chord through the browser's paste event, the context menu's Paste) goes through ONE function, `pasteText` in `xtermEngine.ts`.
- Item 14: `onBinary` (legacy X10 mouse reports): NOT in this PR, see "Item 14".
- Item 16: decide the xterm.js line.

Worktree: `~/omniview/wt/t698-paste`. Branch: `fix/terminal-paste-and-binary` (from `origin/main` `8a2160a1`).

## Item 13: the paste path

- `open` takes the host's `paste` event in the capture phase, cancels it and stops it, so xterm's own paste handler (on its textarea and its element) is never reached: no second paste, and no key handler pastes (`keys.ts` already answers `paste` for the chords, so the terminal sends no key for them).
- `engine.paste(text)` (the menu) and that event call the same `pasteText`. While the program has bracketed paste on (`terminal.modes.bracketedPasteMode`), it removes ESC (0x1b), ETX (0x03) and the C1 CSI (0x9b), then calls `terminal.paste`, which makes the line endings carriage returns and wraps the text. With bracketed paste off, the text goes unchanged: there is no bracket to end.
- Decision, trailing newline: KEPT (not stripped, unlike the plan in the issue and `prior-art.md`). VS Code keeps it in bracketed mode: the program between the markers tells a paste from typing and decides; a newline cut off in silence changes what a pasted line means (a pasted `ls\n` in a program that reads lines). Without brackets the newline runs the line as typing it would.
- xterm 6.1 beta replaces ESC with U+241B (`␛`) inside `bracketTextForPaste`. Ours removes ESC first, so the two do not both act; moving to the beta would leave our rule the one that shows.
- Tests (`xtermEngine.test.ts`, real emulator, "one paste path into a real emulator"): red by assertion in `6adfdf0a`, green in the fix commit. Hostile `a ESC[201~ rm -rf x CR` reaches the shell with no ESC inside one bracket; menu paste and chord paste give equal bytes; one paste event is one write.

## Item 14: `onBinary` (done on `feat/terminal-onbinary`, after the channel v2 of #716 and #763)

- `Engine.onBinary(listener: (bytes: Uint8Array) => void)` (`engine.ts`, `xtermEngine.ts`): xterm's latin1 string becomes one byte for each char, so a coordinate above 127 is one byte and not the two of UTF-8.
- `screen.ts` hands them to `TerminalFeed.writeBinary(bytes)` (`feed.ts`), and drops them while a replay is applied (they refer to the screen the replay replaces; the emulator's other answers are dropped the same way).
- `execFeed.ts`: `write` and `writeBinary` share one path (`type`): counted for `inputs`, clear `inputLost`, kept in pieces of at most `MAX_INPUT_BYTES` inside the 1 MiB bound, sent again once in order after a cut, dropped on `writer_known: false`. Only the encoding differs (`keep` for text, `keepBinary` for bytes).
- `testing.ts`: fake engine `binary(bytes)`, fake feed `binaries()`.
- Tests: real emulator (`xtermEngine.test.ts`: DECSET 9, a press at column 150 gives `ESC [ M` and the three bytes, 182 intact, nothing on `onData`), `screen.test.ts`, `execFeed.test.ts`.

## Item 16: the xterm.js line

Read from the npm packages (`npm pack`) and GitHub on 2026-11-24; `@xterm/xterm` dist-tags: `latest` 6.0.0, `beta` 6.1.0-beta.339 (2026-11-22). The repository has 6.0.0 and `@xterm/addon-webgl` 0.19.0 (beta line: 0.20.0-beta.332).

| Fix | In 6.0.0 | In 6.1.0-beta.337 and .339 |
|---|---|---|
| #5716 paste sanitising (merged 2026-02-17) | No: `bracketTextForPaste` wraps the text as it is | Yes: ESC becomes U+241B. ETX and 0x9b are not touched |
| #6200 (merged 2026-10-28): the title is "Don't arm the `_keyDownSeen` gate on modifier-only keydowns", an IME fix on macOS | No | Yes (`CoreBrowserTerminal.ts` 848-857). The beta also keeps the composition's trailing text from being sent again (`CompositionHelper.ts`) |
| #6069 WebGL context release on dispose (merged 2026-10-29) | No (addon-webgl 0.19.0 has no `WEBGL_lose_context`) | Yes in `@xterm/addon-webgl` 0.20.0-beta.332 (`loseContext()` on dispose). It is the addon's beta, a separate dependency |

Recommendation: move to the 6.1 beta line (VS Code ships `^6.1.0-beta.337`) in its own PR, once the keyboard probe, the IME probe and the GPU switch run on the beta with `@xterm/addon-webgl@0.20.0-beta.332` (the pair must move together). The kitty keyboard protocol stays OFF. Reason: all three fixes are in it, and the paste rule here stands whichever line is used. This PR does not change the dependency.

## Log

- 2026-11-24: red tests `6adfdf0a`; `pasteText` and the capture listener; facts for item 16 read from the packages.

## Dev tools

None added. Checks: `pnpm test ui-next/shell/panel/terminal`, `FONT_DELAY_MS=40 node ui-next/shell/probes/terminal-probe.mjs`.

## Backend catalog

Nothing asked of the Go side by this work. Item 14 asks the feed (UI side) for a binary write; the host's `WriteTerminal` takes base64 bytes already.
