// Measures the design mock's tab strip in the top row: the REFERENCE the shell's tab strip is built to (slice S1b).
//
// What it measures, per engine (webkit, chromium) and viewport (1440x900, 1280x800), in a FRESH page per reading, with the mock's default context
// (no text scale, default density; font normalized as mock-measure.mjs does):
//   - for N tabs in TAB_COUNTS, opened through the mock's own model (Shell.tabs.open(.., { how: 'new' }), one distinct list page per tab so none dedupes):
//     the rectangles of the top row, safe area, Back/Forward (and their svg), strip, scroller, plus button (and svg), lane, actions, every tab face,
//     and for the first and the active tab the tab button, lead svg, title, close button (and svg); the scroller's scroll state, the DOM size of a face.
//   - at N = 5 only: the paint (fill, edge, outline, colour, radius, opacity; the title's text style) of the active face, an inactive face (the 3rd),
//     the active tab's close button, the plus button and Back, in the states rest, hover and focus (focus reached by a Shift key press then .focus()).
//
// Serve the mock first: a CommonJS copy of its server.js with `root` set to the mock directory (see mock-measure.mjs), e.g.
//   sed 's#const root=__dirname#const root="<mock dir>"#' <mock dir>/server.js > /tmp/server.cjs && PORT=49471 node /tmp/server.cjs
// Without MOCK_URL the script serves the mock itself (MOCK_DIR, default: the lab's frontend/mock) on port 49472.
// Run:  MOCK_URL=http://127.0.0.1:49471/ node ui-next/shell/probes/mock-strip-measure.mjs
// Writes mock-strip.json. Exits non-zero when the 5-tab reading of an engine misses tabs, plus, lane or close.
//
// mock-strip.json: { mockTree, viewports, tabCounts, note,
//   data:   { <engine>: { <viewport>: { <N>: reading } } },
//   states: { <engine>: { <viewport>: { <part>: { rest, hover, focus } } } } }   part: activeTab | inactiveTab | activeClose | plus | back
// reading: { topRow, safe, navBack, navBackSvg, navForward, navForwardSvg, strip, scroller, plus, plusSvg, lane, actions,   all [x, y, w, h], px, 0.01
//   tabs: [[x, y, w, h]...] (faces in DOM order),
//   first, active: { tabButton, lead, title, close, closeSvg },
//   scroll: { left, width, client }, activeIndex, faceElements, plusInView }
// state entry: { matches: { hover, focus, focusVisible }, backgroundColor, edge, outline: { style, width, color }, color, borderRadius, opacity,
//   button?: same, title?: { color, fontSize, fontWeight, lineHeight } }   (button and title only for the two tab parts)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, normalizeFont, sleep } from '../../../packages/kit/probes/probe-lib.mjs';
import { MOCK_OPEN, MOCK_OPEN_TABS } from '../../../packages/kit/probes/mock-screen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK_TREE = 'c8e44a445bdbec07ad81d5ec036dd26cc0a8bef0';
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
const TAB_COUNTS = [1, 2, 5, 6, 8, 12, 30];
const STATE_COUNT = 5;
const started = Date.now();

const MOCK_DIR = process.env.MOCK_DIR ?? '/Users/joshuapare/Repos/omniviewdev/aws-wails-native-lab/app/OmniviewNativeLab/frontend/mock';
let server = null;
let url = process.env.MOCK_URL;
if (url === undefined) {
  // No MOCK_URL: serve the mock here, from a CommonJS copy of its server.js with `root` set to the mock directory.
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'mock-strip-')), 'server.cjs');
  writeFileSync(copy, readFileSync(path.join(MOCK_DIR, 'server.js'), 'utf8').replace('const root=__dirname', `const root=${JSON.stringify(MOCK_DIR)}`));
  server = spawn(process.execPath, [copy], { env: { ...process.env, PORT: '49472' }, stdio: 'ignore' });
  url = 'http://127.0.0.1:49472/';
  await sleep(1500);
}

const READ = `(() => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)]; };
  const q = (s, root = document) => root.querySelector(s);
  const faces = [...document.querySelectorAll('.tabstrip .tab-item')];
  const parts = (face) => face === undefined ? null : {
    tabButton: rect(q('[role=tab]', face)), lead: rect(q('.tab__lead svg', face)), title: rect(q('.tab__head', face)),
    close: rect(q('.tab__close', face)), closeSvg: rect(q('.tab__close svg', face)),
  };
  const active = faces.findIndex((f) => f.getAttribute('data-selected') === 'active' || q('[role=tab]', f)?.getAttribute('aria-selected') === 'true');
  const scroller = q('.tabstrip__scroller');
  const plus = q('.tabstrip__new');
  const pb = plus?.getBoundingClientRect();
  return {
    topRow: rect(q('.topbar')), safe: rect(q('.topbar__safe')),
    navBack: rect(q('#topbar-back')), navBackSvg: rect(q('#topbar-back svg')),
    navForward: rect(q('#topbar-forward')), navForwardSvg: rect(q('#topbar-forward svg')),
    strip: rect(q('.tabstrip')), scroller: rect(scroller), plus: rect(plus), plusSvg: rect(q('svg', plus ?? document.createElement('i'))),
    lane: rect(q('.topbar__lane')), actions: rect(q('.topbar__actions')),
    tabs: faces.map(rect),
    first: parts(faces[0]), active: parts(faces[active]),
    scroll: scroller ? { left: r2(scroller.scrollLeft), width: scroller.scrollWidth, client: scroller.clientWidth } : null,
    activeIndex: active,
    faceElements: faces[0] ? faces[0].querySelectorAll('*').length + 1 : null,
    plusInView: pb ? pb.left >= 0 && pb.top >= 0 && pb.right <= innerWidth && pb.bottom <= innerHeight : null,
  };
})()`;

const PAINT = `(el, kind) => {
  const cs = getComputedStyle(el);
  const edge = parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopColor : (cs.boxShadow.match(/rgba?\\([^)]*\\)/)?.[0] ?? '');
  const out = {
    backgroundColor: cs.backgroundColor, edge, outline: { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor },
    color: cs.color, borderRadius: cs.borderTopLeftRadius, opacity: cs.opacity,
  };
  return out;
}`;

const PARTS = {
  activeTab: { sel: '.tabstrip .tab-item[data-selected="active"]', focus: '[role=tab]', tab: true },
  inactiveTab: { sel: '.tabstrip .tab-item:nth-child(3)', focus: '[role=tab]', tab: true },
  activeClose: { sel: '.tabstrip .tab-item[data-selected="active"] .tab__close', focus: null },
  plus: { sel: '.tabstrip__new', focus: null },
  back: { sel: '#topbar-back', focus: null },
};

async function open(browser, viewport, count) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(url, { waitUntil: 'load' });
  await sleep(3000);
  await page.evaluate(MOCK_OPEN);
  await sleep(3500);
  await normalizeFont(page, { rootVar: '--int-font-ui' });
  // The strip holds the reference tab already (opened with how: 'here'); the others are opened through the mock's model.
  await page.evaluate(MOCK_OPEN_TABS(count));
  await sleep(600);
  return page;
}

async function readStates(page) {
  const out = {};
  for (const [name, part] of Object.entries(PARTS)) {
    const handle = await page.$(part.sel);
    if (handle === null) { console.log('MISSING', name); out[name] = null; continue; }
    out[name] = {};
    for (const state of ['rest', 'hover', 'focus']) {
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await page.mouse.move(1, 1);
      if (state === 'hover') {
        const box = await handle.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
      } else if (state === 'focus') {
        await page.keyboard.press('Shift');
        await handle.evaluate((el, sel) => (sel === null ? el : el.querySelector(sel)).focus(), part.focus);
      }
      await sleep(250);
      out[name][state] = await handle.evaluate((el, [paint, focusSel]) => {
        const read = new Function(`return (${paint})`)();
        const target = focusSel === null ? el : el.querySelector(focusSel);
        const entry = {
          matches: { hover: el.matches(':hover'), focus: el.matches(':focus-within'), focusVisible: target.matches(':focus-visible') },
          ...read(el),
        };
        if (focusSel !== null) {
          entry.button = read(target);
          const head = el.querySelector('.tab__head');
          const cs = getComputedStyle(head);
          entry.title = { color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight };
        }
        return entry;
      }, [PAINT, part.focus]);
    }
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
    for (const count of TAB_COUNTS) {
      const page = await open(browser, viewport, count);
      const reading = await page.evaluate(READ);
      const missing = Object.entries(reading).filter(([, v]) => v === null).map(([k]) => k);
      if (reading.tabs.length !== count) console.log('MISSING tabs: expected', count, 'got', reading.tabs.length);
      if (reading.first === null) missing.push('first');
      if (reading.active === null) missing.push('active');
      for (const name of ['first', 'active']) {
        for (const [k, v] of Object.entries(reading[name] ?? {})) if (v === null) missing.push(`${name}.${k}`);
      }
      for (const name of missing) console.log('MISSING', engineName, viewportName, count, name);
      if (count === STATE_COUNT) {
        if (reading.tabs.length !== count || reading.plus === null || reading.lane === null || reading.first?.close == null) failed = true;
        states[engineName][viewportName] = await readStates(page);
      }
      data[engineName][viewportName][count] = reading;
      console.log(engineName, viewportName, count, reading.tabs.length, 'tabs', missing.length === 0 ? 'ok' : 'missing');
      await page.context().close();
    }
  }
  await browser.close();
}

let note = 'Rectangles [x, y, w, h] in viewport px, rounded to 0.01. Mock default context. Pages opened with how: new, one distinct resource list per tab.';
const build = () => `${JSON.stringify({ mockTree: MOCK_TREE, viewports: VIEWPORTS, tabCounts: TAB_COUNTS, note, data, states })}\n`;
let text = build();
if (text.length > 150_000) {
  for (const engine of Object.values(data)) for (const vp of Object.values(engine)) for (const [n, reading] of Object.entries(vp)) {
    if (Number(n) >= 12) reading.tabs = [...reading.tabs.slice(0, 3), ...reading.tabs.slice(-2)];
  }
  note += ' For N >= 12 `tabs` keeps only the first three and last two faces (file size).';
  text = build();
}
const file = path.join(here, 'mock-strip.json');
writeFileSync(file, text);
server?.kill();
console.log('wrote', file, statSync(file).size, 'bytes', Math.round((Date.now() - started) / 1000), 's');
if (failed) { console.log('FAILED: the 5-tab reading misses tabs, plus, lane or close'); process.exit(1); }
