// Probes the shell frame on the fixture (fixture.tsx: the real `Shell` around invented, neutral registrations), in WebKit and Chromium at 1440 x 900 and 1030 x 720.
// The shell is plugin-agnostic and so is its probe: the mock's reference screen is named once, in packages/kit/probes/mock-screen.mjs.
//
//   node ui-next/shell/probes/shell-probe.mjs           builds the fixture (OMNIVIEW_UI=next) into a temp dir, serves it, probes it
//
//   FIXTURE_DIST=<dir>         probe an existing fixture build instead of building
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1030x720   (defaults: both of each)
//   AXE=<path to axe.min.js>   also run axe-core over every case (a dev dependency is the lead's call: `npm i axe-core` in a temp dir)
//   SHOTS=<dir>                write a screenshot per engine and viewport
//   REPORT=<file>              write the full report as JSON
//
// What it checks, per engine and viewport (the mock's reference is mock-shell.json, made by mock-measure.mjs):
//   parity      every target of targets.mjs against the mock: rectangles within 1 px, colours, radius and type exactly, under text size 100 and
//               125 and compact density; then each theme's colours against the mock's, in the nine themes, and the paint of rows and tab by state
//   load        on the production build, no region moves from its first frame to the end of the load (a sampler of every region's rectangle at
//               every frame; the layout-shift observer where the engine has one), every region is there in the first frame, the DOM node count
//   keyboard    F6 and Shift+F6 through the regions, Escape back to the page, the tree's keys, Tab in reading order, with real key presses
//   variants    the fixture's cases: a frame with no optional region, text longer than its room, a tree that scrolls, a page that scrolls,
//               the smallest window (960 x 640)
//   a11y        axe-core, when AXE is given, on every case
// Exit code 1 when anything outside KNOWN differs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, VIEWPORTS, normalizeFont, setContext } from '../../../packages/kit/probes/probe-lib.mjs';
import { MOCK_REGISTRATION } from '../../../packages/kit/probes/mock-screen.mjs';
import { compare, compareStates, readSide, readStates } from './lib.mjs';
import { CONTEXTS, THEME_MAP } from './targets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const reference = JSON.parse(readFileSync(path.join(here, 'mock-shell.json'), 'utf8'));
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(VIEWPORTS).join(',')).split(',');
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const report = { parity: {}, themes: {}, states: {}, load: {}, keyboard: {}, variants: {}, a11y: {}, notes: [] };
const fail = (where, what) => failures.push(`${where}: ${what}`);

// ---------------------------------------------------------------------------------------------------------------------------
function build() {
  const fixture = process.env.FIXTURE_DIST ?? mkdtempSync(path.join(os.tmpdir(), 'shell-probe-fixture-'));
  const env = { ...process.env, OMNIVIEW_UI: 'next' };
  if (!process.env.FIXTURE_DIST) execFileSync('node', [path.join(here, 'build-fixture.mjs'), fixture], { cwd: repo, env, stdio: 'pipe' });
  return fixture;
}

/** The frame with every region, in the words of the mock's reference screen (`?case=injected`: `open` injects them): the shell's one subject, compared with the mock. */
const full = (origins) => `${origins.fixture}/shell/probes/fixture.html?case=injected`;

function serve(dist) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    try {
      if (!file.startsWith(dist)) throw new Error('outside');
      response.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
      response.end(readFileSync(file));
    } catch {
      response.statusCode = 404;
      response.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

// The sampler: from the first animation frame, the rectangle of every region and part at every frame. Installed before the page's own scripts.
const SAMPLER = `
(() => {
  const state = (window.__probe = { frames: 0, first: new Map(), moves: [], layoutShift: null, shiftSources: [] });
  try {
    state.layoutShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        state.layoutShift += entry.value;
        for (const source of entry.sources ?? []) state.shiftSources.push(source.node?.nodeName ?? '?');
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    state.layoutShift = null;
  }
  const nameOf = (el) => el.getAttribute('data-shell-part') ?? el.getAttribute('data-shell-region') ?? el.getAttribute('role') ?? el.tagName;
  const last = new Map();
  const tick = () => {
    state.frames += 1;
    for (const el of document.querySelectorAll('[data-shell-part], [data-shell-region], [role=tab], [role=tree], [role=treeitem]')) {
      const box = el.getBoundingClientRect();
      const now = [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 100) / 100).join(',');
      if (!last.has(el)) { last.set(el, now); state.first.set(nameOf(el) + '#' + state.first.size, state.frames); }
      else if (last.get(el) !== now) { state.moves.push({ part: nameOf(el), frame: state.frames, from: last.get(el), to: now }); last.set(el, now); }
    }
    if (state.frames < 240) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

async function open(browser, url, viewport, { init } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
  page.on('response', (response) => {
    // The Go host serves /wails/*; the static server of this probe does not, and the screen does not need it for its frame.
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico') && !response.url().includes('/wails/')) errors.push(`${response.status()} ${response.url()}`);
  });
  if (init) await page.addInitScript(init);
  if (url.includes('case=injected')) await page.addInitScript((value) => { window.__registration = value; }, MOCK_REGISTRATION);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('[data-shell-part="window"]');
  return { page, context, errors };
}

const normalized = async (page, context = 'default') => {
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  await setContext(page, { ...CONTEXTS[context], flavour: 'kit' });
  await sleep(200);
};

// ---------------------------------------------------------------------------------------------------------------------------
async function parity(browser, engine, viewportName, viewport, origins) {
  for (const contextName of Object.keys(CONTEXTS)) {
    const where = `${engine} ${viewportName} ${contextName}`;
    const { page, context, errors } = await open(browser, full(origins), viewport);
    await normalized(page, contextName);
    const got = await readSide(page, 'shell');
    const result = compare(reference.data[engine][viewportName][contextName], got);
    report.parity[where] = { worst: result.worst, problems: result.problems.length, errors };
    for (const problem of result.problems) fail(`parity ${where}`, problem);
    for (const error of errors) fail(`errors ${where}`, error);
    if (SHOTS && contextName === 'default') await page.screenshot({ path: path.join(SHOTS, `shell-${engine}-${viewportName}.png`) });
    await context.close();
  }
}

async function themes(browser, engine, origins) {
  const { page, context } = await open(browser, full(origins), VIEWPORTS['1440x900']);
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  for (const themeId of Object.keys(THEME_MAP)) {
    await page.evaluate((id) => document.documentElement.setAttribute('data-ov-theme', id), themeId);
    await sleep(150);
    const result = compare(reference.themes[engine][themeId], await readSide(page, 'shell'), { stylesOnly: true });
    report.themes[`${engine} ${themeId}`] = result.problems.length;
    for (const problem of result.problems) fail(`theme ${engine} ${themeId}`, problem);
  }
  await context.close();
}

async function states(browser, engine, origins) {
  const { page, context } = await open(browser, full(origins), VIEWPORTS['1440x900']);
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  const got = await readStates(page, 'shell');
  report.states[engine] = got;
  for (const problem of compareStates(reference.states[engine], got)) fail(`states ${engine}`, problem);
  await context.close();
}

async function load(browser, engine, viewportName, viewport, origins) {
  const where = `${engine} ${viewportName}`;
  const { page, context } = await open(browser, full(origins), viewport, { init: SAMPLER });
  await page.waitForTimeout(3000);
  const result = await page.evaluate(() => {
    const state = window.__probe;
    const count = (selector) => (document.querySelector(selector)?.querySelectorAll('*').length ?? 0) + 1;
    const window_ = document.querySelector('[data-shell-part="window"]');
    return {
      frames: state.frames,
      layoutShift: state.layoutShift,
      shiftSources: state.shiftSources,
      moves: state.moves,
      firstFrames: [...new Set(state.first.values())],
      nodes: { root: (document.getElementById('root')?.querySelectorAll('*').length ?? 0), window: window_ ? window_.querySelectorAll('*').length + 1 : 0, topRow: count('[data-shell-region="topRow"]'), rail: count('[data-shell-part="rail"]'), sidebar: count('[data-shell-region="sidebar"]'), island: count('[data-shell-region="island"]'), lane: count('[data-shell-part="lane"]'), page: count('[data-shell-part="page"]'), statusBar: count('[data-shell-region="statusBar"]') },
      scrolls: { x: document.documentElement.scrollWidth > innerWidth, y: document.documentElement.scrollHeight > innerHeight },
    };
  });
  report.load[`${where} frame`] = result;
  if (result.moves.length > 0) fail(`load ${where}`, `${result.moves.length} regions moved after their first frame: ${JSON.stringify(result.moves.slice(0, 3))}`);
  if (result.layoutShift !== null && result.layoutShift > 0) fail(`load ${where}`, `layout shift ${result.layoutShift} from ${result.shiftSources.join(', ')}`);
  if (result.firstFrames.length !== 1) fail(`load ${where}`, `the frame was not complete in its first frame: parts first seen at frames ${result.firstFrames.join(', ')}`);
  if (result.scrolls.x || result.scrolls.y) fail(`load ${where}`, 'the document scrolls');
  await context.close();
}

/** Real key presses, in the engine. The Tab key in WebKit on macOS skips buttons (Alt+Tab reaches them), so tab order is read from the DOM. */
async function keyboard(browser, engine, origins) {
  const { page, context } = await open(browser, `${origins.fixture}/shell/probes/fixture.html?case=full`, VIEWPORTS['1440x900']);
  const active = () => page.evaluate(() => {
    const el = document.activeElement;
    return el === null || el === document.body ? 'body' : `${el.getAttribute('role') ?? el.tagName.toLowerCase()}${el.getAttribute('aria-level') ? `-${el.getAttribute('aria-level')}` : ''}`;
  });
  const steps = [];
  await page.evaluate(() => document.body.focus());
  for (const key of ['F6', 'F6', 'F6', 'F6', 'Shift+F6', 'Shift+F6']) {
    await page.keyboard.press(key);
    steps.push(`${key}: ${await active()}`);
  }
  await page.keyboard.press('Escape');
  steps.push(`Escape from the tree: ${await active()}`);
  await page.keyboard.press('Escape');
  steps.push(`Escape in the page: ${await active()}`);
  await page.keyboard.press('Shift+F6');
  steps.push(`Shift+F6 after Escape: ${await active()}`);
  await page.evaluate(() => document.querySelector('[role=treeitem][aria-level="2"]').focus());
  const names = [];
  for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowRight', 'End', 'Home']) {
    await page.keyboard.press(key);
    names.push(`${key}: ${await page.evaluate(() => `${document.activeElement.getAttribute('aria-level')}${document.activeElement.getAttribute('aria-expanded') ?? ''}`)}`);
  }
  const order = await page.evaluate(() => [...document.querySelectorAll('[tabindex], button, a[href], input')].filter((el) => el.tabIndex >= 0).map((el) => el.getAttribute('role') ?? el.tagName.toLowerCase()));
  report.keyboard[engine] = { steps, tree: names, tabOrder: order };
  const wanted = ['F6: tab', 'F6: treeitem-2', 'F6: main', 'F6: tab', 'Shift+F6: main', 'Shift+F6: treeitem-2', 'Escape from the tree: main', 'Escape in the page: main', 'Shift+F6 after Escape: treeitem-2'];
  for (const [index, step] of wanted.entries()) if (steps[index] !== step) fail(`keyboard ${engine}`, `step ${index + 1}: wanted "${step}", got "${steps[index]}"`);
  if (order.join() !== 'tab,treeitem,tabpanel') fail(`keyboard ${engine}`, `tab order is ${order.join()}, wanted tab,treeitem,tabpanel`);
  await context.close();
}

async function variants(browser, engine, origins) {
  const page = async (name, viewport = VIEWPORTS['1440x900']) => {
    const opened = await open(browser, `${origins.fixture}/shell/probes/fixture.html?case=${name}`, viewport);
    await normalized(opened.page);
    return opened;
  };
  const rects = (p) => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-shell-part], [data-shell-region]')].map((el) => [el.getAttribute('data-shell-part') ?? el.getAttribute('data-shell-region'), [...Object.values(el.getBoundingClientRect().toJSON()).slice(0, 4)].map((n) => Math.round(n * 100) / 100)])));
  const full = await page('full');
  const fullRects = await rects(full.page);
  await full.context.close();

  // No optional region: no rail, no sidebar, no lane. The island takes the frame, the page starts under the top row.
  const bare = await page('bare');
  const bareRects = await rects(bare.page);
  const bareNames = await bare.page.evaluate(() => ({ lane: document.querySelector('[data-shell-part="lane"]') !== null, sidebar: document.querySelector('[data-shell-region="sidebar"]') !== null, rail: document.querySelector('[data-shell-part="rail"]') !== null }));
  report.variants[`${engine} bare`] = { rects: bareRects, ...bareNames };
  if (bareNames.lane || bareNames.sidebar || bareNames.rail) fail(`variants ${engine} bare`, `an undeclared region was drawn: ${JSON.stringify(bareNames)}`);
  const wantIsland = [5, 40, 1430, 823];
  const wantPage = [5, 40, 1430, 823];
  if (bareRects.island.join() !== wantIsland.join()) fail(`variants ${engine} bare`, `island ${bareRects.island}, wanted ${wantIsland}`);
  if (bareRects.page.join() !== wantPage.join()) fail(`variants ${engine} bare`, `page ${bareRects.page}, wanted ${wantPage} (no lane: 0 px)`);
  await bare.context.close();

  // Text longer than its room: nothing moves, nothing overflows, the ellipsis is there and the chevrons keep their 12 px.
  const long = await page('long');
  const longRects = await rects(long.page);
  for (const name of ['window', 'topRow', 'sidebar', 'island', 'lane', 'page', 'statusBar']) {
    if (longRects[name].join() !== fullRects[name].join()) fail(`variants ${engine} long`, `${name} moved: ${fullRects[name]} -> ${longRects[name]}`);
  }
  const clip = await long.page.evaluate(() => {
    const clipped = (el) => el !== null && el.scrollWidth > el.clientWidth;
    const tab = document.querySelector('[role=tab]');
    const chevrons = [...document.querySelectorAll('[data-shell-region="statusBar"] nav svg')].map((el) => Math.round(el.getBoundingClientRect().width));
    return {
      tabWidth: tab.getBoundingClientRect().width,
      tabTitleClipped: clipped(tab.querySelector('span:last-child')),
      treeLabelsClipped: [...document.querySelectorAll('[role=treeitem] > :nth-child(2)')].map(clipped),
      faceClipped: [...document.querySelectorAll('[data-shell-part="scopeFace"] span:last-child')].map(clipped),
      chevrons,
      windowOverflows: document.querySelector('[data-shell-part="window"]').scrollWidth > innerWidth,
    };
  });
  report.variants[`${engine} long`] = clip;
  if (clip.tabWidth !== 208) fail(`variants ${engine} long`, `tab width ${clip.tabWidth}, wanted 208`);
  if (!clip.tabTitleClipped) fail(`variants ${engine} long`, 'the long tab title is not clipped');
  if (clip.windowOverflows) fail(`variants ${engine} long`, 'the window overflows sideways');
  if (!clip.treeLabelsClipped.every(Boolean)) fail(`variants ${engine} long`, 'a long tree label is not clipped');
  if (!clip.chevrons.every((w) => w === 12)) fail(`variants ${engine} long`, `a chevron of the path was squeezed: ${clip.chevrons}`);
  await long.context.close();

  // A tree of 3 levels that scrolls, and a deeper row's indent: 7 px and 26 per level.
  const deep = await page('deep');
  const tree = await deep.page.evaluate(() => {
    const el = document.querySelector('[role=tree]');
    const before = document.querySelector('[data-shell-region="sidebar"]').getBoundingClientRect().toJSON();
    el.scrollTop = 400;
    const leaf = [...document.querySelectorAll('[role=treeitem][aria-level="3"]')][0];
    const row = leaf.getBoundingClientRect();
    const glyph = leaf.firstElementChild.getBoundingClientRect();
    const after = document.querySelector('[data-shell-region="sidebar"]').getBoundingClientRect().toJSON();
    return { scrolls: el.scrollHeight > el.clientHeight, scrolled: el.scrollTop, glyphIndent: Math.round((glyph.x - row.x) * 100) / 100, sidebarMoved: before.y !== after.y || before.height !== after.height };
  });
  report.variants[`${engine} deep`] = tree;
  if (!tree.scrolls || tree.scrolled === 0) fail(`variants ${engine} deep`, 'the tree is not its own scroll owner');
  if (tree.glyphIndent !== 7 + 2 * 26) fail(`variants ${engine} deep`, `a level-3 row's glyph sits ${tree.glyphIndent} px in, wanted ${7 + 2 * 26}`);
  if (tree.sidebarMoved) fail(`variants ${engine} deep`, 'scrolling the tree moved the sidebar');
  await deep.context.close();

  // A page taller than the island scrolls inside it, under the lane.
  const scroll = await page('scroll');
  const before = await rects(scroll.page);
  const scrolled = await scroll.page.evaluate(() => {
    const el = document.querySelector('[data-shell-part="page"]');
    const lane = document.querySelector('[data-shell-part="lane"]').getBoundingClientRect().toJSON();
    el.scrollTop = 600;
    return { scrolls: el.scrollHeight > el.clientHeight, top: el.scrollTop, laneMoved: lane.y !== document.querySelector('[data-shell-part="lane"]').getBoundingClientRect().y, documentScrolls: document.documentElement.scrollHeight > innerHeight };
  });
  const after = await rects(scroll.page);
  report.variants[`${engine} scroll`] = scrolled;
  if (!scrolled.scrolls || scrolled.top === 0) fail(`variants ${engine} scroll`, 'the page does not scroll inside the island');
  if (scrolled.laneMoved || scrolled.documentScrolls) fail(`variants ${engine} scroll`, 'the lane or the document moved with the page');
  for (const name of Object.keys(before)) if (before[name].join() !== after[name].join()) fail(`variants ${engine} scroll`, `${name} moved while the page scrolled`);
  await scroll.context.close();

  // The smallest window (ch16 R1: 960 x 640): the island keeps 661 px and nothing overflows.
  const small = await page('full', { width: 960, height: 640 });
  const smallRects = await rects(small.page);
  report.variants[`${engine} 960x640`] = smallRects;
  if (smallRects.island[2] !== 661) fail(`variants ${engine} 960x640`, `island width ${smallRects.island[2]}, wanted 661`);
  if (smallRects.statusBar.join() !== '0,608,960,32') fail(`variants ${engine} 960x640`, `status bar ${smallRects.statusBar}`);
  await small.context.close();
}

async function a11y(browser, engine, origins, axe) {
  for (const [label, url] of ['injected', 'full', 'bare', 'long', 'deep', 'scroll'].map((name) => [name, `${origins.fixture}/shell/probes/fixture.html?case=${name}`])) {
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      const { page, context } = await open(browser, url, viewport);
      await page.addScriptTag({ content: axe });
      const result = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, first: v.nodes[0]?.html.slice(0, 120) }))));
      report.a11y[`${engine} ${label} ${viewportName}`] = result;
      for (const violation of result) {
        const text = `${violation.id} (${violation.impact}, ${violation.nodes}): ${violation.first}`;
        if (violation.impact === 'serious' || violation.impact === 'critical') fail(`a11y ${engine} ${label} ${viewportName}`, text);
        else report.notes.push(`a11y ${engine} ${label} ${viewportName}: ${text}`);
      }
      await context.close();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
const fixture = await serve(build());
const origins = { fixture: fixture.origin };
const axe = process.env.AXE ? readFileSync(process.env.AXE, 'utf8') : null;

for (const engineName of engineNames) {
  const browser = await ENGINES[engineName].launch();
  for (const viewportName of viewportNames) {
    await parity(browser, engineName, viewportName, VIEWPORTS[viewportName], origins);
    await load(browser, engineName, viewportName, VIEWPORTS[viewportName], origins);
    console.log(engineName, viewportName, 'parity and load done');
  }
  await themes(browser, engineName, origins);
  await states(browser, engineName, origins);
  await keyboard(browser, engineName, origins);
  await variants(browser, engineName, origins);
  if (axe) await a11y(browser, engineName, origins, axe);
  await browser.close();
  console.log(engineName, 'done');
}

fixture.server.close();
if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ parity: report.parity, nodes: Object.fromEntries(Object.entries(report.load).map(([key, value]) => [key, value.nodes])), notes: report.notes.slice(0, 10) }, null, 1));
if (failures.length > 0) {
  console.error(`\n${failures.length} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}
console.log('\nshell probe: no failures');
