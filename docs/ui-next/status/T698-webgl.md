# T698-webgl: the WebGL addon is made once for a terminal (#698 item 15)

## Problem

`xtermEngine.ts` `setRenderer('gpu')` made a `WebglAddon` at every showing and `setRenderer('dom')` disposed it at every hiding. In `@xterm/addon-webgl` 0.19.0 `dispose()` does not release the GL context, and WebKit allows 16 live contexts in a page. 40 showings of one terminal made 41 contexts (the probe counts 42 with the page's own).

## Rule

- The addon is made once for a terminal, at its first showing with the GPU on screen, and kept while the screen is hidden. `screen.ts` is unchanged: it still says `gpu` when shown and `dom` when hidden; the engine decides what that costs.
- A hidden terminal draws nothing: the emulator's render service pauses what is not intersecting (the hidden panel is out of the layout), the terminal keeps parsing, and no renderer is switched.
- The addon is disposed on a lost context (`onContextLoss`) and with the terminal.
- A failure counter per terminal: each lost context and each addon that could not be made (chunk or context) counts. At 2 (`GPU_FAILURES`) the terminal stays on the DOM renderer for its life (sticky). One loss still gets a new addon at the next showing. HLT-22 holds: WebGL while shown, DOM after a loss.

## Proof

- `xtermEngine.test.ts` "the GPU renderer of a real emulator": 40 cycles make 1 addon; 3 terminals make 3; a loss disposes and the next showing makes one; two losses or two creation failures stay on DOM; losses are counted per terminal. Red on `9597270b`, green on the fix.
- `terminal-probe.mjs` `gpu.once` (section `size`, 1440x900, WebKit and Chromium): the page's `getContext('webgl'|'webgl2')` calls are counted; 40 hidings and showings of the panel make 0 more (after: 1). On the old engine: 42.

## Not verified

The native WKWebView (the probe's WebKit is Playwright's build). The 16-context cap itself is not reached by the probe.
