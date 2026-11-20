// Probes the shell's tab strip, its page host and the window's load, in WebKit and Chromium at 1440 x 900 and 1280 x 800 (decision A15; 1030 x 720 is retired).
// The strip is read on the fixture (fixture.tsx `?case=tabs`: the real `Shell` over the real tab model with invented pages); the page host and the load on the host fixture
// (host-fixture.tsx: the product's own `PluginHost` with invented plugins whose loader the probe controls). The mock's reference is mock-strip.json, made by mock-strip-measure.mjs.
//
//   node ui-next/shell/probes/strip-probe.mjs        builds the fixtures (OMNIVIEW_UI=next) into temp dirs, serves them, probes them
//
//   FIXTURE_DIST=<dir> FIXTURE_DIST_DEV=<dir>   probe existing builds (production, and development for the commit counts)     FONT_DELAY_MS=40   as a runner serves fonts
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1280x800   (defaults: both of each)      AXE=<axe.min.js>      REPORT=<file>   the full report as JSON      SHOTS=<dir>   a screenshot per engine and viewport
//
// What it checks, per engine and viewport:
//   parity     for 1, 2, 5, 6, 8, 12 and 30 tabs, the rectangle of every part of the top row (the safe area, Back and Forward and their glyphs, the strip, the scroller, the new-tab control, the drag lane,
//              every face, and the first and the tab on screen: glyph, title, close control and its glyph) against the mock within 1 px, the scroll state of the strip, and the paint (fill, edge,
//              outline, colour, radius) of the tab on screen, a tab at rest, the close control, the new-tab control and Back, at rest, hovered and focused
//   keyboard   with real key presses: Tab lands on the tab on screen, the arrows move the focus and select nothing, Home and End, Enter and Space select, Delete closes and moves the focus to the neighbour,
//              the chords (close, jump to a tab, the last tab), a middle click and the close control close, the new-tab control opens a tab, the page region is labelled by the selected tab
//   a11y       axe-core on the strip with 3 and with 30 tabs and on the host
//   counts     the DOM nodes of a tab (exact), and the commits one tab switch costs (React development build, React's profiler): exact
//   keep-alive on the host: a hidden page keeps its scroll offset, its local state and its DOM, holds no timer while it is hidden and takes it up again, tabs past the cap are unmounted, a hidden
//              page is not drawn; the time of a switch with a list of 500 rows mounted (recorded, never judged)
//   load       the window the way it opens (S3a: from the session the previous run left, the host fixture's `?session=`), with plugins that arrive after the first frame (the inventory, then each interface,
//              then the sidebar's entries, then the page's data): every region is in the first frame and not one moves for the rest of the load, and the layout-shift observer where the engine has one
//              reads 0; then with two plugins, the second of which registers 700 ms after the first and sorts after it or before it: the rail and the sidebar wait for every plugin (`held`), so no region
//              and no entry of the rail moves (0 px), a tab already open included; a session of two tabs, the plugin of the one on screen registering late; the window with no session (the empty window,
//              with no lane reserved for a tab that is not coming); a tab whose plugin is never installed (it stays and says so); and a text that cannot be used (kept aside, the window empty)
//   arrival    a count that arrives in the sidebar moves nothing (Q2a, ch12 SB1: every collection row has a count slot): the entries declare the slot in the skeleton, and when the counts come (an estimate
//              as "~25", an exact number as "1") every row's rectangle, its glyph's, its label's and the label's text are the ones they were, no label is cut that was not, the slot is where it was, and
//              the layout-shift observer where the engine has one reads 0 over the arrival; the host tells the plugin's hook which groups of its tree are open on screen, and follows the user's clicks on one
//   controls   NEGATIVE_CONTROL=<name> runs only `arrival` (Chromium at 1440 x 900 unless ENGINES and VIEWPORTS say otherwise) with one perturbation, which the probe must see: the exit code is 0 when it did.
//              slot-width: the slot of a count holds no width (`min-inline-size: 0`, as a tree that does not hold it); slot-undeclared: the plugin's skeleton declares no slot (`?counts=late`). Without the
//              assertions for a label's and a slot's rectangle neither is seen: every other check agrees with the perturbed page (the layout-shift observer reads 0 for both, the row and the glyph stand, and the digits are where the mock puts them)
// Exit code 1 when anything differs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, normalizeFont } from '../../../packages/kit/probes/probe-lib.mjs';
import { AXE, NATIVE_VIEWPORTS, SAMPLER, buildFixtures, open, serveFixtures, sleep } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(path.join(here, 'mock-strip.json'), 'utf8'));
// The negative controls: one perturbation of what the sidebar does when its counts arrive, which the probe must see. With NEGATIVE_CONTROL the exit code is 0 when it did.
const PERTURBATIONS = {
  'slot-width': { expected: /^arrival .*: the label of "widgets" moved or was cut/ },
  'slot-undeclared': { expected: /^arrival .*: the label of "widgets" moved or was cut/ },
};
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
if (CONTROL !== '' && PERTURBATIONS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);
const engineNames = (process.env.ENGINES ?? (CONTROL === '' ? Object.keys(ENGINES).join(',') : 'chromium')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? (CONTROL === '' ? Object.keys(NATIVE_VIEWPORTS).join(',') : '1440x900')).split(',');
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const report = { parity: {}, states: {}, keyboard: {}, a11y: {}, counts: {}, keepAlive: {}, switchTimes: {}, load: {}, arrival: {}, notes: [] };
const fail = (where, what) => failures.push(`${where}: ${what}`);

const fixtureUrl = (origin, query) => `${origin}/shell/probes/fixture.html?${query}`;
const hostUrl = (origin, query = '') => `${origin}/shell/probes/host-fixture.html${query === '' ? '' : `?${query}`}`;
const TAB_COUNTS = reference.tabCounts;
/** The DOM nodes of one tab of the strip: its face, the tab's button, glyph (svg and path), content, title and head, the text, the close control with its glyph (svg and path). Exact. */
const NODES_PER_TAB = 12;

// ---------------------------------------------------------------------------------------------------------------------------
// The shell's side of the reference's reading: the same names, from the shell's own markup.
const READ = () => {
  const r2 = (v) => Math.round(v * 100) / 100;
  const rect = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
  };
  const q = (s, root = document) => root.querySelector(s);
  const faces = [...document.querySelectorAll('[data-shell-part="tab"]')];
  const parts = (face) =>
    face === undefined
      ? null
      : { tabButton: rect(q('[role=tab]', face)), lead: rect(q('[role=tab] svg', face)), title: rect(q('[data-ov-variant]', face)), close: rect(q('button[aria-hidden="true"]', face)), closeSvg: rect(q('button[aria-hidden="true"] svg', face)) };
  const active = faces.findIndex((f) => f.hasAttribute('data-active'));
  const strip = q('[data-shell-part="tabStrip"]');
  const scroller = strip?.firstElementChild ?? null;
  const plus = q('[aria-label="New tab"]');
  const pb = plus?.getBoundingClientRect();
  return {
    topRow: rect(q('[data-shell-region="topRow"]')),
    safe: rect(q('[data-shell-part="safeArea"]')),
    navBack: rect(q('[aria-label="Back"]')),
    navBackSvg: rect(q('[aria-label="Back"] svg')),
    navForward: rect(q('[aria-label="Forward"]')),
    navForwardSvg: rect(q('[aria-label="Forward"] svg')),
    strip: rect(strip),
    scroller: rect(scroller),
    plus: rect(plus),
    plusSvg: rect(plus === null ? null : q('svg', plus)),
    lane: rect(q('[data-shell-part="dragLane"]')),
    tabs: faces.map(rect),
    first: parts(faces[0]),
    active: parts(faces[active]),
    scroll: scroller ? { left: r2(scroller.scrollLeft), width: scroller.scrollWidth, client: scroller.clientWidth } : null,
    activeIndex: active,
    faceElements: faces[0] ? faces[0].querySelectorAll('*').length + 1 : null,
    plusInView: pb ? pb.left >= 0 && pb.top >= 0 && pb.right <= innerWidth && pb.bottom <= innerHeight : null,
  };
};

/** The differences between the mock's reading and the shell's, in px: the largest, and a line for each beyond the tolerance. */
function compareReading(mock, shell, where, { tolerance = 1 } = {}) {
  const problems = [];
  let worst = 0;
  const near = (name, a, b, keys = [0, 1, 2, 3]) => {
    if (a === null || a === undefined) return;
    if (b === null || b === undefined) {
      problems.push(`${name}: the shell does not draw it`);
      return;
    }
    for (const k of keys) {
      const delta = Math.round(Math.abs(a[k] - b[k]) * 100) / 100;
      worst = Math.max(worst, delta);
      if (delta > tolerance) problems.push(`${name}[${'xywh'[k]}]: mock ${a[k]} shell ${b[k]} (off by ${delta})`);
    }
  };
  for (const name of ['topRow', 'safe', 'navBack', 'navBackSvg', 'navForward', 'navForwardSvg', 'strip', 'scroller', 'plus', 'plusSvg', 'lane']) near(name, mock[name], shell[name]);
  if (mock.tabs.length !== shell.tabs.length) problems.push(`tabs: mock ${mock.tabs.length} shell ${shell.tabs.length}`);
  // For 12 tabs and more the reference keeps only the first three and last two faces when the file was too big; it keeps them all when it fits.
  const wanted = mock.tabs.length === shell.tabs.length ? mock.tabs.map((rectangle, index) => [rectangle, shell.tabs[index], index]) : [];
  for (const [rectangle, got, index] of wanted) near(`tab ${index + 1}`, rectangle, got);
  for (const which of ['first', 'active']) {
    const a = mock[which];
    const b = shell[which];
    if (a === null || b === null) continue;
    near(`${which} lead`, a.lead, b.lead);
    near(`${which} title`, a.title, b.title, [0]);
    near(`${which} close`, a.close, b.close);
    near(`${which} closeSvg`, a.closeSvg, b.closeSvg);
  }
  if (mock.activeIndex !== shell.activeIndex) problems.push(`the tab on screen: mock ${mock.activeIndex} shell ${shell.activeIndex}`);
  for (const key of ['left', 'width', 'client']) {
    const delta = Math.abs(mock.scroll[key] - shell.scroll[key]);
    worst = Math.max(worst, delta);
    if (delta > tolerance) problems.push(`scroll.${key}: mock ${mock.scroll[key]} shell ${shell.scroll[key]}`);
  }
  if (mock.plusInView !== shell.plusInView) problems.push(`the new-tab control is ${shell.plusInView ? '' : 'not '}in view, the mock's is ${mock.plusInView ? '' : 'not '}`);
  for (const problem of problems) fail(`parity ${where}`, problem);
  return { worst, problems: problems.length };
}

async function parity(browser, engine, viewportName, viewport, origin) {
  for (const count of TAB_COUNTS) {
    const where = `${engine} ${viewportName} ${count} tabs`;
    const { page, context, errors } = await open(browser, fixtureUrl(origin, `case=tabs&tabs=${count}`), viewport);
    await normalizeFont(page, { rootVar: '--ov-font-ui' });
    await sleep(250);
    const got = await page.evaluate(READ);
    const mock = reference.data[engine][viewportName][count];
    const result = compareReading(mock, got, where);
    if (got.faceElements !== NODES_PER_TAB) fail(`counts ${where}`, `a tab is ${got.faceElements} DOM nodes, wanted ${NODES_PER_TAB} (the mock's is ${mock.faceElements})`);
    report.parity[where] = { worst: result.worst, problems: result.problems, faceElements: got.faceElements, mockFaceElements: mock.faceElements, scroll: got.scroll };
    for (const error of errors) fail(`errors ${where}`, error);
    if (SHOTS && count === 5) await page.screenshot({ path: path.join(SHOTS, `strip-${engine}-${viewportName}.png`) });
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The paint of a part in its states, read as the mock's reading is (mock-strip-measure.mjs, PAINT).
const PAINT = (el) => {
  const cs = getComputedStyle(el);
  const edge = parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopColor : (cs.boxShadow.match(/rgba?\([^)]*\)/)?.[0] ?? '');
  return { backgroundColor: cs.backgroundColor, edge, outline: { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor }, color: cs.color, borderRadius: cs.borderTopLeftRadius, opacity: cs.opacity };
};

const PARTS = {
  activeTab: { sel: '[data-shell-part="tab"][data-active]', focus: '[role=tab]', tab: true },
  inactiveTab: { sel: '[data-shell-part="tab"]:nth-child(3)', focus: '[role=tab]', tab: true },
  activeClose: { sel: '[data-shell-part="tab"][data-active] button[aria-hidden="true"]', focus: null },
  plus: { sel: '[aria-label="New tab"]', focus: null },
  back: { sel: '[aria-label="Back"]', focus: null },
};

async function states(browser, engine, viewportName, viewport, origin) {
  const { page, context } = await open(browser, fixtureUrl(origin, 'case=tabs&tabs=5'), viewport);
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  await sleep(250);
  const mine = {};
  for (const [name, part] of Object.entries(PARTS)) {
    const handle = await page.$(part.sel);
    if (handle === null) {
      fail(`states ${engine} ${viewportName}`, `${name}: the shell does not draw it`);
      continue;
    }
    mine[name] = {};
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
      mine[name][state] = await handle.evaluate(
        (el, [paint, focusSel]) => {
          const read = new Function(`return (${paint})`)();
          const target = focusSel === null ? el : el.querySelector(focusSel);
          const entry = { matches: { hover: el.matches(':hover'), focus: el.matches(':focus-within'), focusVisible: target.matches(':focus-visible') }, ...read(el) };
          if (focusSel !== null) {
            entry.button = read(target);
            const cs = getComputedStyle(el.querySelector('[data-ov-variant]'));
            entry.title = { color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight };
          }
          return entry;
        },
        [PAINT.toString(), part.focus],
      );
    }
  }
  await page.mouse.move(1, 1);
  report.states[`${engine} ${viewportName}`] = mine;
  const mock = reference.states[engine][viewportName];
  for (const [name, byState] of Object.entries(mine)) {
    for (const [state, entry] of Object.entries(byState)) {
      const wanted = mock[name]?.[state];
      if (wanted === undefined || wanted === null) continue;
      const where = `states ${engine} ${viewportName} ${name} ${state}`;
      if (state === 'hover' && !entry.matches.hover) fail(where, 'not really hovered');
      if (state === 'focus' && !(entry.matches.focus && entry.matches.focusVisible)) fail(where, 'not really focus-visible');
      const same = (a, b, path_) => {
        for (const [key, value] of Object.entries(a)) {
          if (key === 'matches') continue;
          if (typeof value === 'object' && value !== null) same(value, b?.[key] ?? {}, `${path_}.${key}`);
          // An outline that is not drawn has no width in some engines and 3 px in others: it is the style that says it is not there.
          else if (key === 'width' && path_.endsWith('outline') && a.style === 'none') continue;
          else if (key === 'color' && path_.endsWith('outline') && a.style === 'none') continue;
          else if (b?.[key] !== value) fail(where, `${path_}.${key}: mock ${value} shell ${b?.[key]}`);
        }
      };
      same(wanted, entry, 'paint');
    }
  }
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
/** The window's tabs: the strip's own. The bottom panel has tabs of its own (its tools and its sessions: the host's Logs tool is always there), so `[role=tab]` alone counts them too. Code that runs in the page writes it out. */
const STRIP_TABS = '[data-shell-part="tabStrip"] [role=tab]';

/** The selected tab and which has the focus, as the strip says it. */
const SNAPSHOT = () => {
  const tabs = [...document.querySelectorAll('[data-shell-part="tabStrip"] [role=tab]')];
  const focused = document.activeElement;
  const panel = document.querySelector('[role=tabpanel]');
  return {
    titles: tabs.map((el) => el.getAttribute('aria-label')),
    selected: tabs.findIndex((el) => el.getAttribute('aria-selected') === 'true'),
    focused: tabs.findIndex((el) => el === focused),
    stops: tabs.filter((el) => el.tabIndex === 0).length,
    panelLabelledBy: panel?.getAttribute('aria-labelledby') ?? null,
    selectedId: tabs.find((el) => el.getAttribute('aria-selected') === 'true')?.id ?? null,
    controls: [...new Set(tabs.map((el) => el.getAttribute('aria-controls')))],
    panelId: panel?.id ?? null,
  };
};

async function keyboard(browser, engine, viewportName, viewport, origin) {
  const where = `keyboard ${engine} ${viewportName}`;
  const { page, context } = await open(browser, fixtureUrl(origin, 'case=tabs&tabs=5&active=2'), viewport);
  const snap = () => page.evaluate(SNAPSHOT);
  const log = {};
  const check = (name, ok, got) => {
    log[name] = got;
    if (!ok) fail(where, `${name}: ${JSON.stringify(got)}`);
  };
  let s = await snap();
  check('one tab stop, on the selected tab', s.stops === 1 && s.selected === 1 && s.controls.length === 1 && s.controls[0] === s.panelId && s.panelLabelledBy === s.selectedId, s);
  // Tab from the window's start reaches Back, Forward, then the tab on screen: the strip's one stop (the close controls are not stops).
  await page.evaluate(() => document.body.focus());
  const reached = [];
  for (let i = 0; i < 3; i += 1) {
    // WebKit on macOS skips buttons with Tab (Alt+Tab reaches them: the window's own setting, which the native app turns on, N22); everywhere else Tab reaches every control.
    await page.keyboard.press(engine === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
    reached.push(await page.evaluate(() => document.activeElement.getAttribute('aria-label') ?? document.activeElement.tagName));
  }
  check('Tab reaches Back, Forward, then the tab on screen', reached[0] === 'Back' && reached[1] === 'Forward' && /^Page 2/.test(reached[2]), reached);
  await page.keyboard.press('ArrowRight');
  s = await snap();
  check('ArrowRight moves the focus and selects nothing', s.focused === 2 && s.selected === 1, s);
  await page.keyboard.press('End');
  s = await snap();
  check('End focuses the last tab', s.focused === 4 && s.selected === 1, s);
  await page.keyboard.press('ArrowRight');
  s = await snap();
  check('ArrowRight from the last wraps to the first', s.focused === 0 && s.selected === 1, s);
  await page.keyboard.press('ArrowLeft');
  s = await snap();
  check('ArrowLeft from the first wraps to the last', s.focused === 4, s);
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  s = await snap();
  check('Home then Enter selects the first tab', s.selected === 0 && s.focused === 0 && s.panelLabelledBy === s.selectedId, s);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  s = await snap();
  check('ArrowRight then Space selects the second', s.selected === 1 && s.stops === 1, s);
  await page.keyboard.press('Delete');
  s = await snap();
  check('Delete closes the focused tab and puts the focus on its right neighbour', s.titles.length === 4 && !s.titles.some((title) => /^Page 2/.test(title ?? '')) && s.focused === 1 && s.selected === 1, s);
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  s = await snap();
  check('Backspace on the last tab closes it and the focus goes to the left neighbour', s.titles.length === 3 && s.focused === 2, s);
  // The chords: the native one is Control or Command, and the web alternate Control and Option on any platform.
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('ControlOrMeta+Digit1');
  s = await snap();
  check('Command or Control and 1 jump to the first tab', s.selected === 0, s);
  await page.keyboard.press('ControlOrMeta+Digit9');
  s = await snap();
  check('Command or Control and 9 jump to the last tab', s.selected === s.titles.length - 1, s);
  await page.keyboard.press('Control+Alt+Digit2');
  s = await snap();
  check('Control Option and 2 jump to the second tab (the web alternate)', s.selected === 1, s);
  await page.keyboard.press('ControlOrMeta+KeyW');
  s = await snap();
  check('Command or Control and W close the tab on screen', s.titles.length === 2, s);
  await page.keyboard.press('Control+Alt+KeyW');
  s = await snap();
  check('Control Option and W close it too', s.titles.length === 1, s);
  // The close control and the middle button, and the new-tab control.
  await page.click('[aria-label="New tab"]');
  await page.click('[aria-label="New tab"]');
  s = await snap();
  check('the new-tab control opens a tab after the tab on screen and shows it', s.titles.length === 3 && s.selected === 2, s);
  const box = await (await page.$('[data-shell-part="tab"] [role=tab]')).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'middle' });
  s = await snap();
  check('a middle click closes the tab', s.titles.length === 2, s);
  await page.click('[data-shell-part="tab"] button[aria-hidden="true"]');
  s = await snap();
  check('the close control closes the tab', s.titles.length === 1, s);
  // F6 from nothing enters the top row on the tab on screen; Back and Forward walk the history of the tab on screen (the page opened a second route through the strip's `+` and a third).
  report.keyboard[`${engine} ${viewportName}`] = log;
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
async function a11y(browser, engine, viewportName, viewport, origin, axe) {
  const cases = [
    ['strip, 3 tabs', fixtureUrl(origin, 'case=tabs&tabs=3')],
    ['strip, 30 tabs', fixtureUrl(origin, 'case=tabs&tabs=30')],
    ['host', hostUrl(origin, 'dataMs=50&nodesMs=50&loadMs=50')],
  ];
  for (const [label, url] of cases) {
    const { page, context } = await open(browser, url, viewport);
    await sleep(700);
    await page.addScriptTag({ content: axe });
    const result = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, first: v.nodes[0]?.html.slice(0, 120) }))));
    report.a11y[`${engine} ${viewportName} ${label}`] = result;
    for (const violation of result) {
      const text = `${violation.id} (${violation.impact}, ${violation.nodes}): ${violation.first}`;
      if (violation.impact === 'serious' || violation.impact === 'critical') fail(`a11y ${engine} ${viewportName} ${label}`, text);
      else report.notes.push(`a11y ${engine} ${viewportName} ${label}: ${text}`);
    }
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
/** What a tab switch costs in commits: the development build, with React's profiler counting every commit of the tree. */
async function counts(browser, engine, viewportName, viewport, originDev) {
  const where = `counts ${engine} ${viewportName}`;
  const { page, context } = await open(browser, fixtureUrl(originDev, 'case=tabs&tabs=5&active=1'), viewport);
  await sleep(300);
  const commits = () => page.evaluate(() => window.__commits.length);
  const clickTab = async (index) => {
    const before = await commits();
    await page.locator(STRIP_TABS).nth(index).click();
    await sleep(200);
    return (await commits()) - before;
  };
  const switchCost = await clickTab(2);
  const again = await clickTab(3);
  const same = await clickTab(3);
  const key = await (async () => {
    const before = await commits();
    await page.keyboard.press('ArrowRight');
    await sleep(100);
    return (await commits()) - before;
  })();
  report.counts[`${engine} ${viewportName}`] = { 'switch to another tab': switchCost, 'and to a third': again, 'the tab already on screen': same, 'a roving arrow key': key };
  // Three commits: the switch itself, and two more that React makes for the two Activity boundaries it changes (the page hidden, the page shown) [INFERENCE: the count is observed, the cause is not
  // traced]. Observed in both engines at both viewports; a fourth would be a page rendering for a tab it does not belong to.
  if (switchCost !== 3) fail(where, `a tab switch is ${switchCost} commits, wanted 3`);
  if (again !== 3) fail(where, `a second tab switch is ${again} commits, wanted 3`);
  if (same !== 0) fail(where, `a click on the tab on screen is ${same} commits, wanted 0`);
  if (key !== 1) fail(where, `a roving arrow key is ${key} commits, wanted 1 (the focus is state of the strip)`);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
async function keepAlive(browser, engine, viewportName, viewport, origin) {
  const where = `keep-alive ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, hostUrl(origin, 'rows=500&dataMs=50&nodesMs=50&loadMs=50&inventoryMs=20'), viewport);
  await page.waitForSelector('[role=region][aria-label="Widgets"] tbody tr');
  const log = {};
  const slots = () => page.evaluate(() => [...document.querySelectorAll('[data-page-slot]')].map((el) => ({ id: el.dataset.tabId, display: getComputedStyle(el).display, size: el.getBoundingClientRect().height, nodes: el.querySelectorAll('*').length })));
  // Tab 1 is Widgets, with 500 rows. Scroll its list and type in its search; open a second tab on Gadgets by Control or Command click (a background tab), then Clock.
  const region = page.locator('[role=region][aria-label="Widgets"]').first();
  await region.evaluate((el) => { el.scrollTop = 4000; });
  await sleep(200);
  const scrolledTo = await region.evaluate((el) => el.scrollTop);
  await page.getByRole('searchbox', { name: 'Search Widgets' }).first().fill('widget-04');
  await sleep(300);
  await page.getByRole('treeitem', { name: 'Gadgets' }).click({ modifiers: ['ControlOrMeta'] });
  await page.getByRole('treeitem', { name: 'Clock' }).click({ modifiers: ['ControlOrMeta'] });
  await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 3, STRIP_TABS);
  const tabs = page.locator(STRIP_TABS);
  log.tabs = await tabs.evaluateAll((all) => all.map((el) => el.getAttribute('aria-label')));
  // The list as the user left it, before leaving.
  const state0 = await page.evaluate(() => ({ search: document.querySelector('[role=tabpanel] input[type=search], [role=tabpanel] input')?.value ?? null, rows: document.querySelectorAll('[role=region][aria-label="Widgets"] tbody tr').length }));
  // Switch to Clock: its timer runs; switch back and forth: it stops while hidden and takes up again.
  await tabs.nth(1).click();
  await sleep(300);
  const t1 = await page.evaluate(() => window.__ticks.alpha ?? 0);
  await sleep(200);
  const t2 = await page.evaluate(() => window.__ticks.alpha ?? 0);
  await tabs.nth(0).click();
  await sleep(100);
  const hiddenFrom = await page.evaluate(() => window.__ticks.alpha ?? 0);
  await sleep(400);
  const hiddenTo = await page.evaluate(() => window.__ticks.alpha ?? 0);
  await tabs.nth(1).click();
  await sleep(300);
  const resumed = await page.evaluate(() => window.__ticks.alpha ?? 0);
  log.timer = { visibleGrowth: t2 - t1, hiddenGrowth: hiddenTo - hiddenFrom, resumedGrowth: resumed - hiddenTo };
  if (t2 - t1 < 3) fail(where, `the clock page's timer did not run while it was on screen (${t2 - t1} ticks in 200 ms)`);
  if (hiddenTo - hiddenFrom !== 0) fail(where, `a hidden page's timer ran: ${hiddenTo - hiddenFrom} ticks in 400 ms`);
  if (resumed - hiddenTo < 3) fail(where, `the timer did not take up again when the page came back (${resumed - hiddenTo} ticks in 300 ms)`);
  // Back to the list: it is where it was.
  await tabs.nth(0).click();
  await sleep(300);
  const state1 = await page.evaluate(() => ({ search: document.querySelector('[role=tabpanel] input[type=search], [role=tabpanel] input')?.value ?? null, rows: document.querySelectorAll('[role=region][aria-label="Widgets"] tbody tr').length }));
  const scrolledBack = await region.evaluate((el) => el.scrollTop);
  log.list = { scrolledTo, scrolledBack, state0, state1 };
  if (Math.abs(scrolledBack - scrolledTo) > 1) fail(where, `the list's scroll offset was ${scrolledTo} and is ${scrolledBack} after a switch away and back`);
  if (state1.search !== state0.search) fail(where, `the search text was "${state0.search}" and is "${state1.search}"`);
  // The list is drawn at the offset it was left at: its rows are the ones for that offset, not the top.
  const firstRow = await page.evaluate(() => document.querySelector('[role=region][aria-label="Widgets"] tbody tr')?.textContent ?? '');
  log.firstRow = firstRow;
  // Hidden pages: not drawn, kept.
  const all = await slots();
  log.slots = all;
  const hidden = all.filter((slot) => slot.display === 'none');
  // Two pages are mounted: the one on screen and Clock, which was shown. Gadgets was opened in the background and was never shown, so it has no page (S32: a tab that was not shown is not rendered).
  if (all.length !== 2 || hidden.length !== 1 || hidden.some((slot) => slot.size !== 0)) fail(where, `slots: ${JSON.stringify(all)}`);
  if (hidden.some((slot) => slot.nodes === 0)) fail(where, 'a hidden page lost its DOM');
  // The cap: five pages mounted, then the least recently shown is unmounted. Open four more tabs.
  for (let i = 0; i < 4; i += 1) await page.click('[aria-label="New tab"]');
  await sleep(300);
  const capped = await slots();
  log.cap = { tabs: await tabs.count(), mounted: capped.length };
  if (log.cap.tabs !== 7 || capped.length !== 5) fail(where, `7 tabs should keep 5 pages mounted, got ${JSON.stringify(log.cap)}`);
  for (const error of errors) fail(`errors ${where}`, error);
  report.keepAlive[`${engine} ${viewportName}`] = log;
  await context.close();
}

/** How long a switch takes, with a list of 500 rows mounted in the tab that is left and in the one that is reached: from the click to the frame after it is presented. Recorded for a budget proposal, never judged. */
async function switchTimes(browser, engine, viewportName, viewport, origin) {
  const { page, context } = await open(browser, hostUrl(origin, 'rows=500&dataMs=50&nodesMs=50&loadMs=50&inventoryMs=20'), viewport);
  await page.waitForSelector('[role=region][aria-label="Widgets"] tbody tr');
  await page.click('[aria-label="New tab"]');
  await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 2, STRIP_TABS);
  await page.waitForSelector('[data-page-slot]:not([style*="none"]) [role=region][aria-label="Widgets"] tbody tr');
  await sleep(300);
  const samples = await page.evaluate(async () => {
    const tabs = [...document.querySelectorAll('[data-shell-part="tabStrip"] [role=tab]')];
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const out = [];
    for (let i = 0; i < 24; i += 1) {
      const target = tabs[(i + 1) % 2];
      const t0 = performance.now();
      target.click();
      const t1 = performance.now();
      await frame();
      const t2 = performance.now();
      out.push({ handler: t1 - t0, shown: t2 - t0 });
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return out;
  });
  const sorted = (key) => samples.slice(4).map((s) => s[key]).sort((a, b) => a - b);
  const pick = (list, p) => Math.round(list[Math.min(list.length - 1, Math.floor(list.length * p))] * 10) / 10;
  report.switchTimes[`${engine} ${viewportName}`] = { handlerMedian: pick(sorted('handler'), 0.5), handlerP95: pick(sorted('handler'), 0.95), shownMedian: pick(sorted('shown'), 0.5), shownP95: pick(sorted('shown'), 0.95), samples: samples.length - 4 };
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
const MUST_NOT_MOVE = ['window', 'topRow', 'safeArea', 'frame', 'rail', 'sidebar', 'sidebarHeader', 'island', 'lane', 'page', 'statusBar'];

/**
 * The window as it opens: nothing but the frame in the first frame, then the plugins arrive. No region moves, and every one is in the first frame. `expected`, for the cases that say what the
 * window ends on (S2a, S3a): the rail's entries in the order the plugins declare (the entry of the plugin that is current marked with a star), the sidebar's name, how many tabs (default 1), whether
 * the page's rows are drawn (default: when there is a tab), whether the empty window's home is (`home`) and whether the scope lane is one of the regions (`lane`, default true). A plugin that registers
 * late moves no entry that is drawn either: the rail and the sidebar are chosen once every plugin has settled, and the entries come with them.
 */
async function load(browser, engine, viewportName, viewport, origin, query, label, expected) {
  const where = `load ${engine} ${viewportName} ${label}`;
  const want = { tabs: 1, rows: undefined, home: false, lane: true, ...expected };
  const regions = MUST_NOT_MOVE.filter((name) => want.lane || name !== 'lane');
  const { page, context, errors } = await open(browser, hostUrl(origin, query), viewport, { init: `${SAMPLER}; window.__probeFrames = 150;` });
  await sleep(2800);
  const result = await page.evaluate(() => ({
    ...window.__probe,
    tabs: document.querySelectorAll('[data-shell-part="tabStrip"] [role=tab]').length,
    entries: document.querySelectorAll('[role=treeitem]').length,
    rows: document.querySelectorAll('tbody tr').length,
    home: document.querySelector('[data-shell-part="home"]') !== null,
    unavailable: /This plugin is not installed, or is turned off\./.test(document.body.textContent ?? ''),
    kept: Object.keys(window.sessionStorage).filter((key) => key.includes(':session.invalid.')).length,
    notes: window.__sessionNotes ?? [],
    rail: [...document.querySelectorAll('[data-shell-part="rail"] button')].map((button) => `${button.getAttribute('aria-label')}${button.getAttribute('aria-current') === 'true' ? '*' : ''}`),
    sidebar: document.querySelector('[data-shell-region="sidebar"]')?.getAttribute('aria-label') ?? null,
  }));
  report.load[`${engine} ${viewportName} ${label}`] = { frames: result.frames, first: result.first, moves: result.moves, gone: result.gone, layoutShift: result.layoutShift, shiftSources: result.shiftSources, tabs: result.tabs, entries: result.entries, rows: result.rows, home: result.home, rail: result.rail, sidebar: result.sidebar, notes: result.notes };
  const rows = want.rows ?? want.tabs > 0;
  if (result.tabs !== want.tabs || (rows && (result.entries === 0 || result.rows === 0)) || result.home !== want.home) {
    fail(where, `the load did not end as it should in the time given: ${result.tabs} tabs (wanted ${want.tabs}), ${result.entries} entries, ${result.rows} rows, home ${result.home} (wanted ${want.home})`);
  }
  const moved = result.moves.filter((move) => regions.includes(move.part));
  if (label !== 'a frame without a lane' && label !== 'a saved tab whose plugin is never installed') {
    if (moved.length > 0) fail(where, `${moved.length} regions moved: ${JSON.stringify(moved.slice(0, 4))}`);
    const late = regions.filter((name) => result.first[name] !== result.first.window);
    if (late.length > 0) fail(where, `regions not in the first frame: ${late.map((name) => `${name} at ${result.first[name]}`).join(', ')}`);
    if (result.gone.some((gone) => regions.includes(gone.part))) fail(where, `a region went away: ${JSON.stringify(result.gone)}`);
    if (result.layoutShift !== null && result.layoutShift > 0) fail(where, `layout shift ${result.layoutShift} from ${result.shiftSources.join(', ')}`);
  } else {
    // A frame that has no scope lane reserved one while it loaded, and gives it back once: the page moves up once. The shape of a plugin's frame is not known before it loads (README), and a
    // plugin that never comes has none.
    report.notes.push(`${where}: ${moved.length} moves (${[...new Set(moved.map((move) => move.part))].join(', ')}), layout shift ${result.layoutShift}`);
  }
  if (expected !== undefined) {
    if (expected.rail !== undefined && result.rail.join() !== expected.rail.join()) fail(where, `the rail lists ${result.rail.join(', ')}, wanted ${expected.rail.join(', ')}`);
    if (expected.sidebar !== undefined && result.sidebar !== expected.sidebar) fail(where, `the sidebar is "${result.sidebar}", wanted "${expected.sidebar}"`);
    const pushed = result.moves.filter((move) => move.part.startsWith('rail:'));
    if (expected.rail !== undefined && pushed.length > 0) fail(where, `${pushed.length} entries of the rail moved: ${JSON.stringify(pushed.slice(0, 4))}`);
    if (expected.unavailable !== undefined && result.unavailable !== expected.unavailable) fail(where, `the page says the plugin is not installed: ${result.unavailable}, wanted ${expected.unavailable}`);
    if (expected.kept !== undefined && result.kept !== expected.kept) fail(where, `${result.kept} texts kept aside, wanted ${expected.kept}`);
    if (expected.notes !== undefined && result.notes.length !== expected.notes) fail(where, `${result.notes.length} notes on the console, wanted ${expected.notes}`);
  }
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
/** What the sidebar's rows are, by the id of their entry: the row, its glyph, its label and the label's text, the count slot and the digits in it, and whether the label is cut. Code that runs in the page. */
const READ_ROWS = () => {
  const r2 = (value) => Math.round(value * 100) / 100;
  const rect = (el) => {
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return [r2(box.x), r2(box.y), r2(box.width), r2(box.height)];
  };
  return Object.fromEntries(
    [...document.querySelectorAll('[role=treeitem]')].map((row) => {
      const label = row.children[1];
      const slot = row.querySelector('[data-shell-part="count"]');
      return [row.getAttribute('data-id'), { row: rect(row), glyph: rect(row.children[0]), label: rect(label), labelText: rect(label?.firstElementChild), slot: rect(slot), digits: rect(slot?.firstElementChild), text: slot === null ? null : (slot.querySelector('[aria-hidden="true"]') ?? slot).textContent, cut: label ? label.scrollWidth > label.clientWidth : false }];
    }),
  );
};

/**
 * A count that arrives in the sidebar moves nothing (Q2a). The host fixture's plugin declares the slot of two entries in its skeleton (`count: null`) and answers `nodesMs` later with an estimate for one ("~25") and an exact
 * number for the other ("1"); the third entry has no count and no slot. The rows are read before and after: the row, the glyph, the label and the label's text are the rectangles they were (0.01 px), the label is cut or not
 * as it was, the slot is where it was, the layout-shift observer (Chromium) reads 0 over the arrival, and the digits end where the mock's count ends (7 px inside the row's end). The host's own report is read too: the
 * groups of the tree that are open on screen are what the plugin's hook was told, and they follow the user's clicks on the group.
 */
async function arrival(browser, engine, viewportName, viewport, origin) {
  const where = `arrival ${engine} ${viewportName}`;
  const query = `nodesMs=1500&dataMs=50&loadMs=50&inventoryMs=20${CONTROL === 'slot-undeclared' ? '&counts=late' : ''}`;
  const { page, context, errors } = await open(browser, hostUrl(origin, query), viewport, { init: `${SAMPLER}; window.__probeFrames = 600;` });
  await page.waitForSelector('[role=treeitem][data-id="widgets"]');
  // The perturbation of a tree that does not hold the slot, laid over the page once the entries are there.
  if (CONTROL === 'slot-width') await page.addStyleTag({ content: '[data-shell-part="count"] { min-inline-size: 0 !important; }' });
  await sleep(150);
  const before = await page.evaluate(READ_ROWS);
  if (before.widgets?.text !== '' && before.widgets?.text !== null) {
    fail(where, `the counts had arrived (${JSON.stringify(before.widgets?.text)}) before the skeleton was read: the probe measured nothing`);
    await context.close();
    return;
  }
  await page.evaluate(() => {
    window.__probe.layoutShift = window.__probe.layoutShift === null ? null : 0;
    window.__probe.shiftSources = [];
  });
  await page.waitForFunction(() => (document.querySelector('[role=treeitem][data-id="widgets"] [data-shell-part="count"]')?.textContent ?? '') !== '', null, { timeout: 15_000 });
  await sleep(400);
  const after = await page.evaluate(READ_ROWS);
  const shift = await page.evaluate(() => ({ layoutShift: window.__probe.layoutShift, shiftSources: window.__probe.shiftSources }));
  report.arrival[`${engine} ${viewportName}`] = { before, after, ...shift };

  const same = (a, b) => a !== null && b !== null && a.every((value, index) => Math.abs(value - b[index]) <= 0.01);
  for (const id of ['widgets', 'gadgets', 'clock']) {
    const was = before[id];
    const now = after[id];
    if (was === undefined || now === undefined) {
      fail(where, `the entry "${id}" is not in the sidebar (${was === undefined ? 'before' : 'after'} its count arrived)`);
      continue;
    }
    for (const part of ['row', 'glyph']) if (!same(was[part], now[part])) fail(where, `the ${part} of "${id}" moved when its count arrived: ${JSON.stringify(was[part])} then ${JSON.stringify(now[part])}`);
    if (!same(was.label, now.label) || !same(was.labelText, now.labelText) || was.cut !== now.cut) {
      fail(where, `the label of "${id}" moved or was cut when its count arrived: label ${JSON.stringify(was.label)} then ${JSON.stringify(now.label)}, its text ${JSON.stringify(was.labelText)} then ${JSON.stringify(now.labelText)}, cut ${String(was.cut)} then ${String(now.cut)}`);
    }
    if ((was.slot === null) !== (now.slot === null) || (was.slot !== null && now.slot !== null && !same(was.slot, now.slot))) fail(where, `the count slot of "${id}" moved or was resized when its count arrived: ${JSON.stringify(was.slot)} then ${JSON.stringify(now.slot)}`);
  }
  // What was drawn: "~25" (an estimate: the tilde is drawn, the digits are the grouped number), "1", and nothing for the entry that has no slot.
  const wanted = { widgets: '~25', gadgets: '1', clock: null };
  if (CONTROL === '') {
    for (const [id, text] of Object.entries(wanted)) if (after[id]?.text !== text) fail(where, `the count of "${id}" reads ${JSON.stringify(after[id]?.text)}, wanted ${JSON.stringify(text)}`);
    if (before.widgets?.slot === null || before.gadgets?.slot === null) fail(where, 'the slot was not there before the count arrived: the skeleton declares it and the host holds it from the first frame');
    if (before.clock?.slot !== null || after.clock?.slot !== null) fail(where, 'an entry that declares no count has a slot');
    // The digits end where the mock's count ends: the mock's row ends 7 px after its count (row padding), and so does this row (its last track).
    for (const id of ['widgets', 'gadgets']) {
      const row = after[id]?.row;
      const digits = after[id]?.digits;
      if (row === null || row === undefined || digits === null || digits === undefined || Math.abs(row[0] + row[2] - 7 - (digits[0] + digits[2])) > 1) fail(where, `the digits of "${id}" do not end 7 px inside the row: row ${JSON.stringify(row)}, digits ${JSON.stringify(digits)}`);
    }
    if (shift.layoutShift !== null && shift.layoutShift > 0) fail(where, `layout shift ${shift.layoutShift} from ${shift.shiftSources.join(', ')} while the counts arrived`);
    if (shift.layoutShift === null) report.notes.push(`${where}: no layout-shift observer in this engine; the rectangles above are what it checks`);
  }

  // The host tells the plugin's hook which groups are open on screen, and follows the user: the group of the page on screen is open when the tree mounts, a click on it closes it, a second opens it. The list
  // changes only when the groups do (a render of the host is not a change): no list is told twice in a row.
  if (CONTROL === '') {
    const told = () => page.evaluate(() => window.__sidebarOpen ?? []);
    const waitFor = (list) => page.waitForFunction((wanted) => JSON.stringify((window.__sidebarOpen ?? []).at(-1)) === wanted, JSON.stringify(list), { timeout: 5000 }).then(() => true, () => false);
    if (!(await waitFor(['group']))) fail(where, `the hook was not told that the group of the page on screen is open: ${JSON.stringify(await told())}`);
    await page.getByRole('treeitem', { name: 'Group' }).click();
    if (!(await waitFor([]))) fail(where, `the hook was not told that the group was closed: ${JSON.stringify(await told())}`);
    if ((await page.locator('[role=treeitem][data-id="widgets"]').count()) !== 0) fail(where, 'the entries of a closed group are on screen');
    await page.getByRole('treeitem', { name: 'Group' }).click();
    if (!(await waitFor(['group']))) fail(where, `the hook was not told that the group was opened again: ${JSON.stringify(await told())}`);
    const list = await told();
    report.arrival[`${engine} ${viewportName}`].told = list;
    if (list.some((open, index) => index > 0 && JSON.stringify(open) === JSON.stringify(list[index - 1]))) fail(where, `the hook was told the same groups twice in a row: ${JSON.stringify(list)}`);
  }
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
const production = await serveFixtures(buildFixtures('production'));
const development = await serveFixtures(buildFixtures('development'));
const axe = readFileSync(AXE, 'utf8');

for (const engineName of engineNames) {
  const browser = await (engineName === 'chromium' ? ENGINES.chromium.launch({ args: ['--font-render-hinting=none'] }) : ENGINES[engineName].launch());
  for (const viewportName of viewportNames) {
    const viewport = NATIVE_VIEWPORTS[viewportName];
    if (CONTROL !== '') {
      await arrival(browser, engineName, viewportName, viewport, production.origin);
      continue;
    }
    await parity(browser, engineName, viewportName, viewport, production.origin);
    await states(browser, engineName, viewportName, viewport, production.origin);
    await keyboard(browser, engineName, viewportName, viewport, production.origin);
    await a11y(browser, engineName, viewportName, viewport, production.origin, axe);
    await counts(browser, engineName, viewportName, viewport, development.origin);
    await keepAlive(browser, engineName, viewportName, viewport, production.origin);
    await switchTimes(browser, engineName, viewportName, viewport, production.origin);
    await arrival(browser, engineName, viewportName, viewport, production.origin);
    const here = (query, label, expected) => load(browser, engineName, viewportName, viewport, production.origin, query, label, expected);
    // A window restored from a session with one tab (the host fixture's default): the tab is in the strip in the first frame, and the plugin loads after it.
    await here('', 'a frame with a lane', { rail: ['Alpha*'], sidebar: 'Alpha navigation' });
    await here('lane=0', 'a frame without a lane');
    // Two plugins, the second of which registers 700 ms after the first: the rail and the sidebar are chosen once both have settled, with the plugin of the tab on screen current, whether the late
    // one sorts after the first or before it: a tab is open the whole time, and no entry of the rail moves (S2a left this uncovered at 0.00006 in Chromium).
    await here('plugins=2&lateMs=700', 'a second plugin that registers late and sorts last', { rail: ['Alpha*', 'Beta'], sidebar: 'Alpha navigation' });
    await here('plugins=2&lateMs=700&first=beta', 'a second plugin that registers late and sorts first', { rail: ['Beta', 'Alpha*'], sidebar: 'Alpha navigation' });
    // A saved window of two tabs, the plugin of the one on screen the late one: both tabs are in the strip in the first frame, the page is the kit's loading state until it registers.
    await here('session=two&plugins=2&lateMs=700&first=beta', 'a saved window of two tabs with the plugin of the tab on screen registering late', { tabs: 2, rail: ['Beta*', 'Alpha'], sidebar: 'Beta navigation' });
    // No session: the empty window, with the home content, and no lane: no tab is coming for one.
    await here('session=none&plugins=2&lateMs=700&first=beta', 'a window with no session, a plugin registering late and sorting first', { tabs: 0, home: true, lane: false, rail: ['Beta*', 'Alpha'], sidebar: 'Beta navigation' });
    // A tab whose plugin is never installed stays, and says so once the list of plugins has been read; a text that cannot be used is kept aside and the window is the empty one, with one note.
    await here('session=gone', 'a saved tab whose plugin is never installed', { rows: false, unavailable: true, rail: ['Alpha*'], sidebar: 'Alpha navigation' });
    await here('session=bad', 'a saved text that cannot be used', { tabs: 0, home: true, lane: false, kept: 1, notes: 1, rail: ['Alpha*'], sidebar: 'Alpha navigation' });
    console.log(engineName, viewportName, 'done');
  }
  await browser.close();
}

production.server.close();
development.server.close();
if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ counts: report.counts, switchTimes: report.switchTimes, parityWorst: Object.fromEntries(Object.entries(report.parity).map(([key, value]) => [key, value.worst])), notes: report.notes.slice(0, 12) }, null, 1));
if (CONTROL !== '') {
  const detected = failures.filter((line) => PERTURBATIONS[CONTROL].expected.test(line));
  console.log(`\nwhat the probe saw with the perturbation "${CONTROL}": ${failures.length} differences\n${failures.map((line) => `  ${line}`).join('\n')}`);
  console.log(detected.length > 0 ? `\nNEGATIVE CONTROL "${CONTROL}": detected (${detected.length} differences, e.g. ${detected[0]})` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${failures.length} other failures)`);
  process.exit(detected.length > 0 ? 0 : 1);
}
if (failures.length > 0) {
  console.error(`\n${failures.length} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}
console.log('\nstrip probe: no failures');
