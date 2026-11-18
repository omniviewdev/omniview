// Probes the shell frame on the fixture (fixture.tsx: the real `Shell` around invented, neutral registrations and invented tabs), in WebKit and Chromium at 1440 x 900 and 1030 x 720
// (the reference of the frame is measured there; the tab strip's own probe, strip-probe.mjs, runs at 1440 x 900 and 1280 x 800).
// The shell is plugin-agnostic and so is its probe: the mock's reference screen is named once, in packages/kit/probes/mock-screen.mjs.
//
//   node ui-next/shell/probes/shell-probe.mjs           builds the fixture (OMNIVIEW_UI=next) into a temp dir, serves it, probes it
//
//   FIXTURE_DIST=<dir>         probe an existing fixture build instead of building       FONT_DELAY_MS=40   hold every font file back, as a runner does (packages/kit/probes/serve.mjs)
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1030x720   (defaults: both of each)
//   AXE=<path to axe.min.js>   also run axe-core over every case (default: the kit's own axe-core)
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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, VIEWPORTS, launch, normalizeFont, setContext } from '../../../packages/kit/probes/probe-lib.mjs';
import { AXE, buildFixtures, open, SAMPLER, serveFixtures, sleep } from './harness.mjs';
import { compare, compareStates, readSide, readStates } from './lib.mjs';
import { CONTEXTS, THEME_MAP } from './targets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(path.join(here, 'mock-shell.json'), 'utf8'));
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(VIEWPORTS).join(',')).split(',');
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const report = { parity: {}, themes: {}, states: {}, load: {}, keyboard: {}, variants: {}, a11y: {}, notes: [] };
const fail = (where, what) => failures.push(`${where}: ${what}`);

/** The frame with every region, in the words of the mock's reference screen (`?case=injected`: `open` injects them): the shell's one subject, compared with the mock. */
const full = (origins) => `${origins.fixture}/shell/probes/fixture.html?case=injected`;

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
      firstFrames: [...new Set(Object.values(state.first))],
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
  // Back and Forward are controls that cannot act yet (aria-disabled, never natively disabled), so they are stops, then the tab: the strip's one stop; its close control is not a stop (Delete closes).
  if (order.join() !== 'button,button,tab,treeitem,tabpanel') fail(`keyboard ${engine}`, `tab order is ${order.join()}, wanted button,button,tab,treeitem,tabpanel`);
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
      tabTitleClipped: clipped(tab.querySelector('[data-ov-variant]').parentElement),
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
const fixture = await serveFixtures(buildFixtures());
const origins = { fixture: fixture.origin };
const axe = readFileSync(AXE, 'utf8');

for (const engineName of engineNames) {
  const browser = await launch(engineName);
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
