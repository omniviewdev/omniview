// Measures the design mock's rail: the REFERENCE the shell's rail is built to (slice S2a, rail-probe.mjs).
//
// What it measures, per engine (webkit, chromium) and viewport (1440x900, 1280x800), in a FRESH page per screen, with the mock's default context (no text scale, default density; font
// normalized as mock-strip-measure.mjs does):
//   - two screens: `tools` (the mock's first plugin screen, MOCK_OPEN: three tools under each other, 16 px glyphs) and `second` (the mock's second plugin screen, MOCK_OPEN_RAIL: the rail of
//     ch12 section 4, `railHtml()` of core.js: 20 px glyphs, its first tool open). On each: the track, every tool's target, glyph and face (the `::before` the mock paints; its rectangle is
//     read from its computed insets), the tab stops, and the tip attributes (delay, placement).
//   - on `second` only: the paint of the open tool and of another tool in the states rest, hover, open and hovered, focus (a keyboard focus), open and focused, and open while the region it
//     opens (the sidebar) has the focus: the face's fill, outline and radius, and the tool's colour.
//
// Serve the mock first: a CommonJS copy of its server.js with `root` set to the mock directory (see mock-strip-measure.mjs), e.g.
//   sed 's#const root=__dirname#const root="<mock dir>"#' <mock dir>/server.js > /tmp/server.cjs && PORT=49471 node /tmp/server.cjs
// Without MOCK_URL the script serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) on port 49473.
// Run:  MOCK_URL=http://127.0.0.1:49471/ node ui-next/shell/probes/mock-rail-measure.mjs
// Writes mock-rail.json. Exits non-zero when a screen does not draw the tools or a state is missing.
//
// mock-rail.json: { mockTree, viewports, note,
//   data:   { <engine>: { <viewport>: { tools: reading, second: reading } } },
//   states: { <engine>: { <viewport>: { <state>: { open: paint, other: paint } } } } }       state: rest | hover | openHover | focus | openFocus | regionFocus
// reading: { track, buttons, glyphs, faces: [[x, y, w, h]...] (px, 0.01), open: [bool], stops: [tabIndex], tip: [{ delay, placement }] }       (no names: the mock's tools carry its plugins' words)
// paint: { matches: { hover, focus, focusVisible }, color, face: { backgroundColor, outline: { style, width, color, offset }, borderRadius } }
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';
import { MOCK_OPEN, MOCK_OPEN_RAIL } from '../../../packages/kit/probes/mock-screen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const STATES = ['rest', 'hover', 'openHover', 'focus', 'openFocus', 'regionFocus'];
const started = Date.now();

const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
let server = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server.js with `root` set to the mock directory.
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-rail-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: '49473' }, stdio: 'ignore' });
  url = 'http://127.0.0.1:49473/';
  await sleep(1500);
}

const READ = `(() => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)]; };
  const rail = document.querySelector('.frame__rail');
  if (rail === null) return null;
  const buttons = [...rail.querySelectorAll('button')];
  // The face is the \`::before\` of the target: its rectangle follows from its insets, the target having no border.
  const face = (button) => {
    const b = button.getBoundingClientRect(), c = getComputedStyle(button, '::before');
    const top = parseFloat(c.top), left = parseFloat(c.left), right = parseFloat(c.right), bottom = parseFloat(c.bottom);
    return [r2(b.x + left), r2(b.y + top), r2(b.width - left - right), r2(b.height - top - bottom)];
  };
  return {
    track: rect(rail),
    buttons: buttons.map(rect),
    glyphs: buttons.map((button) => rect(button.querySelector('svg'))),
    faces: buttons.map(face),
    // (The tools' names are not read: they are the mock's plugins' words, which the vocabulary guard keeps out of this tree.)
    open: buttons.map((button) => button.classList.contains('open') || button.getAttribute('aria-pressed') === 'true'),
    stops: buttons.map((button) => button.tabIndex),
    tip: buttons.map((button) => ({ delay: button.getAttribute('data-tooltip-delay'), placement: button.getAttribute('data-tooltip-placement') })),
  };
})()`;

const PAINT = (el) => {
  const cs = getComputedStyle(el);
  const face = getComputedStyle(el, '::before');
  return {
    matches: { hover: el.matches(':hover'), focus: el.matches(':focus'), focusVisible: el.matches(':focus-visible') },
    color: cs.color,
    face: { backgroundColor: face.backgroundColor, outline: { style: face.outlineStyle, width: face.outlineWidth, color: face.outlineColor, offset: face.outlineOffset }, borderRadius: face.borderTopLeftRadius },
  };
};

async function open(browser, viewport, script) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(url, { waitUntil: 'load' });
  await sleep(3000);
  await page.evaluate(script);
  await sleep(3500);
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  return page;
}

/** The paint of the open tool and of the second tool in each state, on the second screen's rail. */
async function readStates(page) {
  const out = {};
  const buttons = await page.$$('.frame__rail button');
  const [openTool, other] = [buttons[0], buttons[1]];
  const read = async () => ({
    open: await openTool.evaluate((el, paint) => new Function(`return (${paint})`)()(el), PAINT.toString()),
    other: await other.evaluate((el, paint) => new Function(`return (${paint})`)()(el), PAINT.toString()),
  });
  for (const state of STATES) {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.mouse.move(1, 1);
    if (state === 'hover' || state === 'openHover') {
      const box = await (state === 'hover' ? other : openTool).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
    } else if (state === 'focus' || state === 'openFocus') {
      // A key press first, so the engines treat the focus as the keyboard's (focus-visible).
      await page.keyboard.press('Shift');
      await (state === 'focus' ? other : openTool).evaluate((el) => el.focus());
    } else if (state === 'regionFocus') {
      await page.evaluate(() => document.querySelector('.frame__sidebar [tabindex="0"]')?.focus());
    }
    await sleep(250);
    out[state] = await read();
  }
  await page.mouse.move(1, 1);
  return out;
}

const data = {};
const states = {};
let failed = false;
for (const [engineName, engine] of Object.entries(ENGINES)) {
  const browser = await engine.launch(engineName === 'chromium' ? { args: ['--font-render-hinting=none'] } : {});
  data[engineName] = {};
  states[engineName] = {};
  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    data[engineName][viewportName] = {};
    for (const [screen, script] of [['tools', MOCK_OPEN], ['second', MOCK_OPEN_RAIL]]) {
      const page = await open(browser, viewport, script);
      const reading = await page.evaluate(READ);
      if (reading === null || reading.buttons.length < 3 || reading.glyphs.some((glyph) => glyph === null)) {
        console.log('MISSING', engineName, viewportName, screen, 'the rail does not draw its tools');
        failed = true;
      }
      data[engineName][viewportName][screen] = reading;
      if (screen === 'second') {
        states[engineName][viewportName] = await readStates(page);
        for (const state of STATES) if (states[engineName][viewportName][state] === undefined) failed = true;
      }
      console.log(engineName, viewportName, screen, reading?.buttons.length, 'tools', 'ok');
      await page.context().close();
    }
  }
  await browser.close();
}

const note = 'Rectangles [x, y, w, h] in viewport px, rounded to 0.01. Mock default context. `tools`: the first plugin screen (three tools, 16 px glyphs); `second`: the second plugin screen (20 px glyphs, its first tool open). States are read on `second`.';
const file = path.join(here, 'mock-rail.json');
writeFileSync(file, `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, note, data, states })}\n`);
server?.kill();
console.log('wrote', file, statSync(file).size, 'bytes', Math.round((Date.now() - started) / 1000), 's');
if (failed) {
  console.log('FAILED: a screen does not draw its tools, or a state is missing');
  process.exit(1);
}
