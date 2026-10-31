# Drive, capture, review

The capture driver is also the prototype's smoke test: if real input cannot reach a state, the screenshot of that state is not evidence.

## Setup

- Serve the prototype (`python3 -m http.server` in its directory) or enable file access in the browser launch.
- Headless Chromium (omp `browser` helper or Puppeteer), viewport **1440x900**, device scale 1.25–2. Each URL-param variant is its own page load.
- Keep the driver as one reusable function (`captureAll()`), not a series of ad-hoc steps, so every fix is followed by a full re-capture.

## Real input only

Puppeteer-style input (the omp `tab.run` exposes the raw `page`):

```js
await page.keyboard.down('Meta'); await page.keyboard.press('t'); await page.keyboard.up('Meta');
await page.keyboard.press('ArrowDown'); await page.keyboard.type('p');       // type-ahead
await page.keyboard.down('Shift'); await page.mouse.click(x, y); await page.keyboard.up('Shift');
await page.mouse.click(x, y, { button: 'middle' });                           // auxclick
```

Hold a modifier, screenshot, then release, to capture held-modifier hints. Do not call prototype functions to fake a state the user could not reach with input.

**Isolated-world gotcha:** inside omp `tab.run`, raw `page.evaluate` ran in an isolated world where `window.__mock` was `undefined`. Use the tab helper with an expression string, which evaluates in the page world:

```js
await tab.evaluate('window.__mock.freezeAt(70)');
await tab.evaluate('JSON.stringify({ tabs: __mock.state.tabs.map(t => t.title), menu: __mock.state.menu?.index })');
```

## Assert state after every step

After each input step, read `__mock.state` (tabs, highlight index, open overlays, secondary window) and compare with the expected result; stop on mismatch rather than screenshotting a wrong state. Also check the page's console errors.

## Name screenshots by flow step

Numbered, sortable, descriptive: `00-current-layout-with-rail.png`, `01-launcher-layout-no-rail.png`, `03a-menu-opening-animation-70ms.png`, `03b-menu-open-kubernetes-preselected.png`, `05-shift-held-new-window-hint.png`. Letter suffixes for sub-steps; include the variant (`current`, `single-plugin`) and animation offset in the name. The order is the order of the issue's screenshot section.

## Review and iterate

Open and look at **every** image before publishing. Checklist:

- Colors, fonts, sizes match the real capture side by side (before/after variant).
- Nothing clipped: lists show whole rows, shadows not cut, tooltips inside the window.
- Titles/labels are what the app would show (a new tab is titled with the plugin name, not "New tab").
- Only items the real app would list; plausible data; correct platform modifier labels.
- Animations read as intended in frozen frames (a drop-down looks like a drop-down, not a flash).
- Each screenshot demonstrates exactly one step of the behavior table.

Fix the prototype, then re-run the whole driver; never patch a single image.

## Animation GIF

No ffmpeg needed. For each offset t = 0..360 ms in 20 ms steps: reload, reach the pre-animation state with real input, trigger the animation, `tab.evaluate('window.__mock.freezeAt(t)')`, screenshot a clipped region (`clip: {x, y, width, height}`) to `anim-000.png`, `anim-020.png`, …. Capture still `rest*.png` before and `hold*.png` frames between key presses. Assemble:

```sh
convert -loop 0 -delay 10 rest*.png -delay 2 anim*.png -delay 7 hold*.png -resize 75% -layers Optimize flow.gif
```

Check frames before trusting the GIF:

```sh
montage anim-000.png anim-060.png anim-120.png anim-180.png anim-240.png anim-360.png -tile 2x3 -geometry +4+4 review.png
```
