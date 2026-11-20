// Probes the host's Logs tool in WebKit and Chromium at 1440 x 900 and 1280 x 800 (P1b-3a, decision A15), on the host fixture (host-fixture.tsx `?logs=1&panel=1`: the product's own `PluginHost`
// around invented plugins; the fixture plugin's four Logs sessions are opened through the `ctx.panel` a page was given, as a plugin's command does).
//
//   node ui-next/shell/probes/logs-probe.mjs      builds the fixtures (OMNIVIEW_UI=next: production, and React's development build for the commit counts), serves them, probes them
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1280x800   (defaults: both of each)      REPORT=<file>   the full report as JSON      FONT_DELAY_MS=40   as a runner serves fonts
//
// What it checks, per engine and viewport:
//   fills      the log view's rectangle is the panel body's (a body is an item of a row in the panel's slot: the view once stood at the width of its filter row, about half of the panel)
//   shift      opening a session with the panel open moves nothing outside the panel's strip (the sampler's rectangles in both engines, `layout-shift` in Chromium: 0)
//   keep       the lines and the scroll place of a session come back when another tool was shown and the Logs tool is chosen again
//   listeners  what the plugin counts (`window.__fixtureLogs`): the registry and the view (two) listen while the session is on screen, only the registry while another tool is shown, none and the feed
//              closed once the tab is closed
//   hidden     the 10,000 lines a second session, and that it is the HIDDEN VIEW that costs nothing, not a feed that went quiet:
//                open    at most one React commit a frame and at least one (a view that draws nothing would pass every zero below), frames asked for and nodes changed, the feed making lines at its rate
//                        and the view taking them in
//                hidden  with the panel CLOSED (3 s), and with ANOTHER tool shown (a tool with no session; 9 s, long enough for the stream to reach its bound of 100,000 lines): no commit, no frame requested, no
//                        timer started, no DOM mutation, and in Chromium no layout and no style recalculation (WebKit has no such counter: it reports frames, timers, mutations and commits only); AND the feed
//                        went on making lines at its rate (the fixture's own count), none of them was read (each is held by the stream or counted as dropped past its bound) and the view took in no entry
//                back    the view catches up with the stream and shows NEWER lines than it had when it was hidden (the ordinal of its newest row, and its rows), follows the tail, and every line the feed made
//                        since is accounted for: taken in by the view, still held by the stream, or dropped past the stream's bound (the marker of the dropped ones is an entry of the view, not a line)
//                        and the rate on the strip is the feed's (10,000 a second), not the burst of the catch-up (L1)
//                told    the user is told of every line that was dropped (L1): the sources go quiet once the view has caught up, and then the lines the feed made are EXACTLY the lines the strip shows plus the
//                        lines it says were dropped (emitted = shown + told-dropped), and the note on the strip says that the lines the stream dropped (its own count) never reached the view
//   sources    the source of a line (L2): the fixture's `pair` session follows two sources (`app` and `worker`, listed by the stream, its lines taking them in turn): every mounted row has a Source cell, the name in it is the label the
//              feed gave the line's source, its hue is the source's place in the series (blue, then green), the column is the mock's 168 px in the head and in the rows, and the chip is the mock's (10 px into the cell, 3 px under
//              the row's top, 18 px high, its name 19 px in, an 8 px swatch with a 2 px radius: MOCK_SOURCE); the `app` session follows one source: no Source head, three cells in a row, no chip
//   appears    the column appears (L2): the fixture's `late` session follows one source and hears of a second while it is open (`__fixtureLogs.speak()`), once the feeds were quiet, following the end and scrolled back: the
//              rows that were drawn do not move (the same y and height, the clock and level cells where they were, the text 168 px on), the list does not scroll (scrolled back: the same scrollTop and the same rows; following:
//              at the end, on the newest line, which is the second source's, cut with its whole name for its tip), the view measures nothing (no `getBoundingClientRect` of an element of it, no ResizeObserver callback for it) and,
//              in Chromium, the page lays out at most once
// NEGATIVE_CONTROL=feed-stopped   the feed goes quiet once the view is hidden (Chromium at 1440 x 900, the `hidden` section only): the probe must fail its check that the feed went on, which a view that
//                                 costs nothing because its feed is quiet would pass; the exit code is 0 when it did, 1 when it did not
// NEGATIVE_CONTROL=source-label   the name in every Source cell of the `pair` session is the other source's (the text of the name element only: the chip, its hue, its clip marker and the cell stay; the `sources` section only): the probe must fail its check that each row names the feed's source for its line
// NEGATIVE_CONTROL=column-moves   the list scrolls 48 px when the column has appeared (scrolled back; the `appears` section only): the probe must fail its check that the list did not scroll
// NEGATIVE_CONTROL=kept-leak      every listener ever added to a Set is kept, which keeps the model of the view of a session after its tab closed (Chromium, the `memory` section only): the probe must fail its check that the
//                                 heap fell back after the tab closed
// NEGATIVE_CONTROL=close-twice    the count of the calls to the first feed's close is one more just before the check that close was asked of each feed once (the `kept` section only): `closed` counts a feed once, so only
//                                 the calls themselves show a stream closed twice
// NEGATIVE_CONTROL=kept-lines     the number of the oldest line of the first session's view is not the one the page drew, just before the check that the lines a view had are the ones it has (the `kept` section only)
//
// Sections added for A21 (a plugin's unload keeps its sessions of the host's Logs tool): `kept` (both engines: the tabs, the views, the streams closed once, the cards, the new press, the four tabs closed) and `memory`
// (Chromium: a session fills the view to its bound, the plugin is unloaded, the tab is closed, and after a forced garbage collection the heap has fallen back; WebKit has no heap counter to drive: `kept` is its check).
// SECTIONS=kept,memory runs only those sections (a draft run); a name that is no section, or a section that ran in no engine (`memory` measures in Chromium only), fails the run.
// Exit code 1 when anything differs.
import { writeFileSync } from 'node:fs';
import { ENGINES, launch } from '../../../packages/kit/probes/probe-lib.mjs';
import { NATIVE_VIEWPORTS, SAMPLER, buildFixtures, open, serveFixtures, sleep } from './harness.mjs';

// The negative control: one perturbation of what the page does after it loaded, which the probe must see. With NEGATIVE_CONTROL the exit code is 0 when it did.
const PERTURBATIONS = {
  'feed-stopped': { sections: ['hidden'], expected: /^hidden .*: the feed emitted/ },
  'source-label': { sections: ['sources'], expected: /^sources .*: two sources: .* rows name the wrong source/ },
  'column-moves': { sections: ['appears'], expected: /^appears .*: the list scrolled/ },
  // A21: every listener ever added to a Set is kept for good, which keeps the view's model (its listeners close over it) after its tab closed: the heap must not be seen to fall (Chromium, the `memory` section).
  'kept-leak': { sections: ['memory'], expected: /^memory .*: the heap kept/ },
  // A21: a stream closed twice, which the count of closed feeds does not see (it counts a feed once): the calls to close are counted, and the page says one more.
  'close-twice': { sections: ['kept'], expected: /^kept .*: after the unload: close was asked of each feed once/ },
  // A21: the lines a held view shows are the ones it had, not only as many: the oldest line's number is changed in the page.
  'kept-lines': { sections: ['kept'], expected: /^kept .*: the oldest line of app was/ },
};
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
if (CONTROL !== '' && PERTURBATIONS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);
// SECTIONS=kept,memory runs only those sections (a draft run: the exit code says nothing of the others). A name that is no section is an error before a browser starts, and a section that ran in no engine (`memory`
// measures the heap in Chromium only, so SECTIONS=memory ENGINES=webkit ran nothing) fails the run: a draft that proved nothing does not pass.
const SECTION_NAMES = ['fills', 'sources', 'appears', 'hidden', 'kept', 'memory'];
const ONLY = (process.env.SECTIONS ?? '').split(',').filter(Boolean);
for (const name of ONLY) if (!SECTION_NAMES.includes(name)) throw new Error(`SECTIONS names ${name}, which is no section of this probe: ${SECTION_NAMES.join(', ')}`);
/** The sections that really ran, in at least one engine. */
const ran = new Set();
const wants = (section) => (CONTROL === '' ? ONLY.length === 0 || ONLY.includes(section) : PERTURBATIONS[CONTROL].sections.includes(section));
const engineNames = (process.env.ENGINES ?? (CONTROL === '' ? Object.keys(ENGINES).join(',') : 'chromium')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? (CONTROL === '' ? Object.keys(NATIVE_VIEWPORTS).join(',') : '1440x900')).split(',');
const failures = [];
const report = { fills: {}, shift: {}, keep: {}, listeners: {}, sources: {}, appears: {}, hidden: {}, kept: {}, memory: {}, notes: [] };
const fail = (where, what) => failures.push(`${where}: ${what}`);
const url = (origin) => `${origin}/shell/probes/host-fixture.html?logs=1&panel=1&inventoryMs=30&loadMs=30&nodesMs=30&dataMs=30`;

// The 10,000 lines a second session is the fixture's `audit` (plugins/fixture/src/logs.ts). The stream that keeps what a hidden view does not read holds at most 100,000 lines (the kit's synthetic feed, as the
// runtime's stream does), so a view hidden for more than ten seconds at this rate loses the oldest lines to the stream's bound.
const RATE = 10_000;
const STREAM_BOUND = 100_000;
// The view's own bound (the kit's default, HLT-4): its buffer holds 100,000 lines and the markers of dropped lines (the first of which stays as the view's first row, L1), and the oldest lines go when more come.
const VIEW_BOUND = 100_000;
// How long each hidden window lasts. The panel closed and, after it, another tool shown, with half a second to settle before each: about 13 s in all, 130,000 lines, past the stream's bound.
const CLOSED_MS = 3000;
const OTHER_MS = 9000;
// A view has caught up with its stream when what the stream still holds is a few frames of lines (the stream makes 10 a millisecond).
const CAUGHT_UP_LINES = 3000;

/**
 * What can be seen at one instant, read in one task so that nothing moves between the numbers: the clock; what the fixture's sources emitted, hold (nobody has read it) and dropped past their bound; and, of the
 * view, the ordinal of its newest row (an entry the view took in: a line, or the marker of lines the stream dropped), its rows and its strip. Nothing here lays out, draws or asks for a frame.
 */
const READ_FEED = () => {
  const grid = document.querySelector('[data-log-session] [role=grid]');
  const rows = grid === null ? [] : grid.querySelectorAll('[data-n]');
  return {
    at: performance.now(),
    ...window.__fixtureLogs.stats(),
    newest: rows.length === 0 ? 0 : Number(rows[rows.length - 1].getAttribute('data-n')),
    rows: Number(grid?.getAttribute('aria-rowcount') ?? 0),
    strip: document.querySelector('[data-log-session] [aria-label="Session status"]')?.textContent ?? '',
    note: document.querySelector('[data-log-session] [aria-label="Session status"] [data-ov-tip]')?.getAttribute('data-ov-tip') ?? '',
  };
};

const PANEL_PARTS = ['panel', 'panelHandle', 'panelHeader', 'panelToggle', 'panelTools', 'panelSeparator', 'panelSessions', 'panelActions'];
const MUST_NOT_MOVE = ['window', 'topRow', 'safeArea', 'frame', 'rail', 'sidebar', 'sidebarHeader', 'island', 'lane', 'page', 'statusBar'];
// Chromium's layout-shift entries, split by where the shifted node is: outside the log view (the shell, the panel's strip: must be 0) or inside it. A list that is shorter than its box grows a row at a time as the
// first lines of a stream arrive, which Chromium counts as a shift of the list's own window (the box and everything around it stay): reported, not failed.
const SHIFT = `window.__shift = { outside: 0, inside: 0, nodes: [] }; try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) { if (entry.hadRecentInput) continue; const out = entry.sources.filter((source) => !source.node || !source.node.closest || source.node.closest('[data-log-session]') === null); if (out.length > 0) { window.__shift.outside += entry.value; window.__shift.nodes.push(...out.map((source) => (source.node?.nodeName ?? '?') + '.' + String(source.node?.className ?? '').slice(0, 36) + '[' + (source.node?.getAttribute?.('data-shell-part') ?? source.node?.getAttribute?.('role') ?? '') + '] y ' + Math.round(source.previousRect.y) + ' h ' + Math.round(source.previousRect.height) + ' to y ' + Math.round(source.currentRect.y) + ' h ' + Math.round(source.currentRect.height))); } else window.__shift.inside += entry.value; } }).observe({ type: 'layout-shift', buffered: true }); } catch { window.__shift = null; }`;
const SAMPLE = `window.__probeParts = ${JSON.stringify(PANEL_PARTS)}; ${SAMPLER}; ${SHIFT}; window.__probeFrames = 200;`;

// What a window of time costs, counted from outside the page's own work: every call that starts a frame or a timer, every DOM mutation. `__rawRaf` is the engine's own, for the probe's sampler.
const COUNT = `(() => {
  const work = (window.__work = { raf: 0, timeout: 0, interval: 0, mutations: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  window.__rawRaf = raf;
  window.requestAnimationFrame = (callback) => { work.raf += 1; return raf(callback); };
  const timeout = window.setTimeout.bind(window);
  window.setTimeout = (...args) => { work.timeout += 1; return timeout(...args); };
  const interval = window.setInterval.bind(window);
  window.setInterval = (...args) => { work.interval += 1; return interval(...args); };
  new MutationObserver((list) => { work.mutations += list.length; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
})();`;

const rect = (selector) => `(() => { const el = document.querySelector('${selector}'); if (el === null) return null; const b = el.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 100) / 100); })()`;
const ready = (page) => page.waitForFunction(() => window.__logs?.ready() === true && window.__panel !== undefined, null, { timeout: 15000 });
const rowcount = (page) => page.evaluate(() => Number(document.querySelector('[data-log-session] [role=grid]')?.getAttribute('aria-rowcount') ?? 0));
const counters = (page) => page.evaluate(() => ({ ...window.__fixtureLogs }));

async function fills(browser, engine, viewportName, viewport, origin) {
  const where = `fills ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, url(origin), viewport);
  await ready(page);
  await page.evaluate(() => { window.__logs.open(0); });
  await page.waitForSelector('[data-log-session] [role=grid]');
  await sleep(500);
  const body = await page.evaluate(`${rect('[data-shell-part="panelBody"]:not([hidden])')}`);
  const view = await page.evaluate(`${rect('[data-log-session]')}`);
  report.fills[`${engine} ${viewportName}`] = { body, view };
  if (body === null || view === null || body.some((value, index) => Math.abs(value - view[index]) > 1)) fail(where, `the log view is ${JSON.stringify(view)}, the panel's body ${JSON.stringify(body)}`);
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

async function shift(browser, engine, viewportName, viewport, origin) {
  const where = `shift ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, url(origin), viewport, { init: SAMPLE });
  await ready(page);
  await page.evaluate(() => window.__panel.show({ tool: 'logs' }));
  await sleep(400);
  const openedAt = await page.evaluate(() => window.__probe.frames);
  // The page's own load (a list's footer arriving) is not the session's: count from here.
  await page.evaluate(() => { if (window.__shift !== null) { window.__shift.outside = 0; window.__shift.inside = 0; window.__shift.nodes.length = 0; } });
  await page.evaluate(() => { window.__logs.open(0); });
  await sleep(1500);
  const result = await page.evaluate(() => ({ ...window.__probe, shift: window.__shift }));
  const moved = result.moves.filter((move) => move.frame > openedAt && [...MUST_NOT_MOVE, ...PANEL_PARTS].includes(move.part));
  report.shift[`${engine} ${viewportName}`] = { frames: result.frames, moved, layoutShiftOutsideTheView: result.shift?.outside ?? null, layoutShiftInsideTheView: result.shift?.inside ?? null };
  if (moved.length > 0) fail(where, `${moved.length} parts moved when a session opened: ${JSON.stringify(moved.slice(0, 4))}`);
  if (result.shift !== null && result.shift.outside > 0) fail(where, `layout shift ${result.shift.outside} outside the log view, from ${result.shift.nodes.join(', ')}`);
  if (result.shift === null) report.notes.push(`${where}: this engine has no layout-shift entries: the sampler's rectangles are what it checks`);
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

async function keep(browser, engine, viewportName, viewport, origin) {
  const where = `keep ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, url(origin), viewport);
  await ready(page);
  await page.evaluate(() => { window.__logs.open(0); });
  await page.waitForFunction(() => Number(document.querySelector('[data-log-session] [role=grid]')?.getAttribute('aria-rowcount') ?? 0) > 30, null, { timeout: 15000 });
  const place = () => page.evaluate(() => { const grid = document.querySelector('[data-log-session] [role=grid]'); return { top: Math.round(grid.scrollTop), first: grid.querySelector('[data-n]')?.getAttribute('data-n') ?? '', rows: Number(grid.getAttribute('aria-rowcount')) }; });
  await page.evaluate(() => { document.querySelector('[data-log-session] [role=grid]').scrollTop = 0; });
  await sleep(300);
  const before = await place();
  await page.evaluate(() => window.__panel.show({ tool: 'alpha:streams' }));
  await sleep(800);
  await page.evaluate(() => window.__panel.show({ tool: 'logs' }));
  await sleep(500);
  const after = await place();
  report.keep[`${engine} ${viewportName}`] = { before, after };
  if (after.top !== before.top || after.first !== before.first) fail(where, `the scroll place changed: ${JSON.stringify(before)} then ${JSON.stringify(after)}`);
  if (after.rows < before.rows) fail(where, `the lines went: ${before.rows} then ${after.rows}`);
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

async function listeners(browser, engine, viewportName, viewport, origin) {
  const where = `listeners ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, url(origin), viewport);
  await ready(page);
  await page.evaluate(() => { window.__logs.open(0); });
  await page.waitForSelector('[data-log-session] [role=grid]');
  await sleep(300);
  const shown = await counters(page);
  await page.evaluate(() => window.__panel.show({ tool: 'alpha:streams' }));
  await sleep(300);
  const hiddenView = await counters(page);
  await page.evaluate(() => window.__panel.show({ tool: 'logs' }));
  await sleep(300);
  const back = await counters(page);
  await page.evaluate(() => { window.__logs.close(0); });
  await sleep(500);
  const closed = await counters(page);
  report.listeners[`${engine} ${viewportName}`] = { shown, hiddenView, back, closed };
  const same = (got, wanted, label) => { if (JSON.stringify(got) !== JSON.stringify(wanted)) fail(where, `${label}: ${JSON.stringify(got)}, wanted ${JSON.stringify(wanted)}`); };
  same(shown, { opened: 1, closed: 0, listeners: 3 }, 'on screen (the registry and the view\'s two)');
  same(hiddenView, { opened: 1, closed: 0, listeners: 1 }, 'another tool shown (the registry only)');
  same(back, { opened: 1, closed: 0, listeners: 3 }, 'shown again');
  same(closed, { opened: 1, closed: 1, listeners: 0 }, 'tab closed');
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// A21: the sessions of the host's Logs tool across their plugin's unload, in a real engine (the host fixture: the product's own `PluginHost`; `window.__plugin.unload` takes the plugin out of the live set and holds
// it there). Three sessions of one item: `app` streams, `migrate` ends on its own and `sync` fails on its own. The unload ends `app` with the cause and keeps the other two as they were; all three tabs stay, each
// view is the SAME element and shows the oldest line it showed (read by its number and its text, not counted), every stream was closed once (the calls to `close` are counted, repeats too) and the registry let go of
// it; the card of the failed one says what it says of itself and then that the plugin was unloaded, its link is no link and its Open button is unavailable; when the plugin is back nothing resumed and the link
// works; a new press opens a new session; closing the four tabs leaves no listener and closes each stream once.
async function kept(browser, engine, viewportName, viewport, origin) {
  const where = `kept ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, url(origin), viewport);
  await ready(page);
  await page.evaluate(() => {
    window.__logs.open(0);
    window.__logs.open(1);
    window.__logs.open(2);
  });
  await page.waitForFunction(() => Object.values(window.__panel.getSnapshot().sessions).filter((one) => one.state === 'ended' || one.state === 'failed').length === 2, null, { timeout: 15000 });
  await sleep(400);
  const sessions = () => page.evaluate(() => Object.fromEntries(Object.values(window.__panel.getSnapshot().sessions).map((one) => [one.title.split('/')[1], { id: one.id, state: one.state, cause: one.cause, since: one.since, held: one.held === true }])));
  const rows = (id) => page.evaluate((one) => Number(document.querySelector(`[data-log-session="${one}"] [role=grid]`)?.getAttribute('aria-rowcount') ?? -1), id);
  const marked = (id) => page.evaluate((one) => document.querySelector(`[data-log-session="${one}"] [role=grid]`)?.__kept === one, id);
  const tabs = () => page.evaluate(() => [...document.querySelectorAll('[data-shell-part="sessionTab"] [role=tab]')].map((tab) => tab.getAttribute('aria-label')));
  const same = (got, wanted, label) => {
    if (JSON.stringify(got) !== JSON.stringify(wanted)) fail(where, `${label}: ${JSON.stringify(got)}, wanted ${JSON.stringify(wanted)}`);
  };
  const before = await sessions();
  const ids = Object.fromEntries(Object.entries(before).map(([name, one]) => [name, one.id]));
  /**
   * The oldest line a session's view shows, read by its number and its text: the session's tab is chosen, its list scrolled to the top and the first row read once it is drawn. A count of rows would pass for a view
   * that never had a line, or lost its lines and gained as many. `change` is the one perturbation of the control `kept-lines`: the number of the row is not the one the page drew.
   */
  const firstLine = async (name, change = false) => {
    await page.locator(`[data-shell-part="sessionTab"] [role=tab][aria-label^="orders-api/${name} "]`).click();
    await page.waitForFunction((id) => {
      const grid = document.querySelector(`[data-log-session="${id}"] [role=grid]`);
      return grid !== null && grid.getClientRects().length > 0 && grid.querySelector('[role=row][data-n]') !== null;
    }, ids[name], { timeout: 15000 });
    const line = await page.evaluate(({ id, perturb }) => new Promise((resolve) => {
      const grid = document.querySelector(`[data-log-session="${id}"] [role=grid]`);
      grid.scrollTop = 0;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const row = grid.querySelector('[role=row][data-n]');
          if (row !== null && perturb) row.setAttribute('data-n', `${row.getAttribute('data-n')}0`);
          resolve(row === null ? null : { n: row.getAttribute('data-n'), text: row.textContent.replace(/\s+/g, ' ').trim() });
        });
      });
    }), { id: ids[name], perturb: change });
    // The click gave the tab the focus: it is taken off, so that the card the check opens later is the one a pointer alone opens, as when no tab was chosen first.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    return line;
  };
  // Each session is on screen once, in the order they were opened (so the last is the one on screen again), and its oldest line is kept to be found after the unload.
  const linesBefore = {};
  for (const name of ['app', 'migrate', 'sync']) {
    linesBefore[name] = await firstLine(name);
    if (linesBefore[name] === null) fail(where, `the view of ${name} drew no line before the unload: the check of its lines proves nothing`);
  }

  await page.mouse.move(1, 1);
  await sleep(300);
  await page.evaluate((all) => {
    for (const id of all) document.querySelector(`[data-log-session="${id}"] [role=grid]`).__kept = id;
  }, Object.values(ids));
  const rowsBefore = { app: await rows(ids.app), migrate: await rows(ids.migrate), sync: await rows(ids.sync) };
  same(await counters(page), { opened: 3, closed: 0, listeners: 5 }, 'three feeds opened: the registry listens to each (3) and the view on screen to its own (2)');

  // The unload: the plugin leaves, and what it has in the Logs tool stays, whatever its state.
  await page.evaluate(() => window.__plugin.unload('alpha'));
  await page.waitForFunction(() => !window.__panel.getSnapshot().live.includes('alpha'), null, { timeout: 15000 });
  await sleep(900);
  const off = await sessions();
  same(await tabs(), ['orders-api/app · north-yard, ended', 'orders-api/migrate · north-yard, ended', 'orders-api/sync · north-yard, failed'], 'the tabs after the unload');
  if (!(off.app.state === 'ended' && off.app.cause === 'The plugin was unloaded.' && off.app.held)) fail(where, `the running session is ${JSON.stringify(off.app)} after the unload, wanted ended with "The plugin was unloaded." and held`);
  for (const name of ['migrate', 'sync']) {
    const a = before[name];
    const b = off[name];
    if (!(b.held && a.state === b.state && a.cause === b.cause && a.since === b.since)) fail(where, `${name} was ${JSON.stringify(a)} and is ${JSON.stringify(b)}: what was over before the unload stays as it was, and is held`);
  }

  for (const name of ['app', 'migrate', 'sync']) {
    if (!(await marked(ids[name]))) fail(where, `the view of ${name} is not the element it was: it was made again`);
    const now = await rows(ids[name]);
    if (now < rowsBefore[name]) fail(where, `${name} had ${String(rowsBefore[name])} lines and has ${String(now)}`);
    const line = await firstLine(name, CONTROL === 'kept-lines' && name === 'app');
    if (JSON.stringify(line) !== JSON.stringify(linesBefore[name])) fail(where, `the oldest line of ${name} was ${JSON.stringify(linesBefore[name])} and is ${JSON.stringify(line)}: the lines its view had are not the ones it has`);
  }

  await page.mouse.move(1, 1);
  await sleep(300);
  const rowsOff = await rows(ids.app);
  await sleep(800);
  if ((await rows(ids.app)) !== rowsOff) fail(where, 'the lines of the session the unload ended went on growing');
  same(await counters(page), { opened: 3, closed: 3, listeners: 2 }, 'after the unload: each stream closed once, the registry let go of all three, the view on screen keeps its two');
  const calls = () => page.evaluate(() => [...window.__fixtureLogs.closeCalls]);
  // The negative control `close-twice`: the count of the calls to the first feed's close is one more, as if the registry had closed it twice; it is put back right after the check.
  if (CONTROL === 'close-twice') await page.evaluate(() => { window.__fixtureLogs.closeCalls[0] += 1; });
  same(await calls(), [1, 1, 1], 'after the unload: close was asked of each feed once (the calls are counted, repeats too; `closed` counts a feed once)');
  if (CONTROL === 'close-twice') await page.evaluate(() => { window.__fixtureLogs.closeCalls[0] -= 1; });
  const cardOf = async (name) => {
    await page.mouse.move(1, 1);
    await sleep(500);
    const box = await page.locator(`[data-shell-part="sessionTab"] [role=tab][aria-label^="orders-api/${name} "]`).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
    await sleep(1000);
    return page.evaluate(() => {
      const content = document.querySelector('[popover]:popover-open [data-shell-part="sessionCard"]');
      if (content === null) return null;
      const button = content.querySelector('button');
      return {
        text: content.innerText.replace(/\s+/g, ' '),
        links: content.querySelectorAll('a').length,
        button: button === null ? null : { unavailable: button.getAttribute('aria-disabled'), why: (button.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent.trim() ?? '').join(' ') },
      };
    });
  };
  const cardOff = await cardOf('sync');
  report.kept[`${engine} ${viewportName} plugin off`] = cardOff;
  if (cardOff === null) fail(where, 'no card opened on the failed session');
  else {
    if (!/The log stream stopped\. The source did not answer\. The plugin was unloaded\./.test(cardOff.text)) fail(where, `the card of the failed session says ${JSON.stringify(cardOff.text)}: its own words, then that the plugin was unloaded`);
    if (cardOff.links !== 0) fail(where, `the card of the failed session has ${String(cardOff.links)} link(s) while the plugin is off`);
    if (cardOff.button?.unavailable !== 'true' || cardOff.button.why !== 'The plugin was unloaded.') fail(where, `its button is ${JSON.stringify(cardOff.button)}, wanted an unavailable one that says "The plugin was unloaded."`);
  }

  // The plugin is back: nothing resumes, and the way back to the resource works.
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__plugin.reload('alpha'));
  await page.waitForFunction(() => window.__panel.getSnapshot().live.includes('alpha'), null, { timeout: 15000 });
  await sleep(900);
  const back = await sessions();
  const facts = (all) => Object.fromEntries(Object.entries(all).map(([name, one]) => [name, [one.state, one.cause, one.since, one.held]]));
  same(facts(back), facts(off), 'the sessions after the plugin came back');
  same(await counters(page), { opened: 3, closed: 3, listeners: 2 }, 'the plugin\'s return opened and closed nothing');
  const cardBack = await cardOf('sync');
  report.kept[`${engine} ${viewportName} plugin back`] = cardBack;
  if (cardBack === null || cardBack.links !== 1 || cardBack.button?.unavailable !== null) fail(where, `the card once the plugin is back: ${JSON.stringify(cardBack)}, wanted one link and an available button`);

  // A new press opens a new session beside them; closing the four tabs frees every listener and closes each stream once.
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__logs.open(0);
  });
  await sleep(900);
  same(await tabs(), ['orders-api/app · north-yard, ended', 'orders-api/migrate · north-yard, ended', 'orders-api/sync · north-yard, failed', 'orders-api/app (2) · north-yard'], 'the tabs after a new press');
  same(await counters(page), { opened: 4, closed: 3, listeners: 3 }, 'a fourth feed: its registry listener and its view\'s two (the held views are hidden and listen to nothing)');
  for (let tab = 0; tab < 4; tab += 1) {
    await page.locator('[data-shell-part="sessionTab"] [role=tab]').first().focus();
    await page.keyboard.press('Delete');
    await sleep(300);
  }

  await page.getByText('No log sessions').waitFor({ timeout: 10000 });
  await sleep(300);
  same(await counters(page), { opened: 4, closed: 4, listeners: 0 }, 'after the four tabs closed: each stream closed once, no listener left');
  same(await calls(), [1, 1, 1, 1], 'after the four tabs closed: close was asked of each feed once');
  report.kept[`${engine} ${viewportName}`] = { before, off, back: facts(back), rowsBefore };
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// A21, "closing the tab frees the buffer", in Chromium (the only engine with a heap counter we can drive): a session fills the view to its bound (100,000 lines), its plugin is unloaded (the stream closes and drops
// its buffer; the view keeps its lines, so the heap stays up), and the tab is closed: after a forced garbage collection (CDP) the heap is back near what it was before the session. The control `kept-leak` keeps every
// listener ever added to a Set, which keeps the view's model alive, and the check must see that the heap did not fall.
const MIB = 1024 * 1024;
const LEAK = '(() => { const keep = (window.__leak = []); const add = Set.prototype.add; Set.prototype.add = function (value) { if (typeof value === "function") keep.push(value); return add.call(this, value); }; })();';

async function memory(browser, engine, viewportName, viewport, origin) {
  if (engine !== 'chromium') {
    report.notes.push(`memory ${engine} ${viewportName}: no heap counter to drive in this engine: the counters of the \`kept\` section are what it checks`);
    return false;
  }

  const where = `memory ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, url(origin), viewport, CONTROL === 'kept-leak' ? { init: LEAK } : {});
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  /** The heap in use after three forced collections: what the page still holds. */
  const heap = async () => {
    for (let pass = 0; pass < 3; pass += 1) await cdp.send('HeapProfiler.collectGarbage');
    await sleep(200);
    return (await cdp.send('Runtime.getHeapUsage')).usedSize;
  };
  await ready(page);
  const baseline = await heap();
  await page.evaluate(() => {
    window.__logs.open(3);
  });
  await page.waitForFunction(() => Number(document.querySelector('[data-log-session] [role=grid]')?.getAttribute('aria-rowcount') ?? 0) >= 100000, null, { timeout: 60000, polling: 500 });
  const full = await heap();
  await page.evaluate(() => window.__plugin.unload('alpha'));
  await page.waitForFunction(() => !window.__panel.getSnapshot().live.includes('alpha'), null, { timeout: 15000 });
  await sleep(500);
  const held = await heap();
  await page.locator('[data-shell-part="sessionTab"] [role=tab]').first().focus();
  await page.keyboard.press('Delete');
  await page.getByText('No log sessions').waitFor({ timeout: 10000 });
  await sleep(500);
  const closed = await heap();
  const mib = (bytes) => Math.round((bytes / MIB) * 10) / 10;
  report.memory[`${engine} ${viewportName}`] = { baselineMiB: mib(baseline), fullMiB: mib(full), heldMiB: mib(held), closedMiB: mib(closed) };
  // The session really held a buffer (a probe that never filled the view would prove nothing), the held session still holds its lines, and closing the tab gave back all but a fraction of them.
  if (full - baseline < 8 * MIB) fail(where, `the session added ${String(mib(full - baseline))} MiB to the heap: the view was not filled, so the check proves nothing`);
  if (held - baseline < 8 * MIB) fail(where, `the held session adds ${String(mib(held - baseline))} MiB to the heap: its lines are not kept`);
  const kept = closed - baseline;
  const grew = held - baseline;
  if (!(held - closed >= 8 * MIB && kept <= 0.3 * grew)) fail(where, `the heap kept ${String(mib(kept))} MiB of the ${String(mib(grew))} MiB the session held after its tab closed (the heap was ${String(mib(baseline))} before, ${String(mib(held))} held, ${String(mib(closed))} after): the buffer is not freed`);
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
  return true;
}

/**
 * One window of `ms`: what the page did in it (frames and timers asked for, DOM changes, commits from the development build's profiler and, in Chromium, layouts and style recalculations), and the feed and the view at
 * its two ends.
 */
async function windowOf(page, cdp, ms) {
  const read = async () => {
    const work = await page.evaluate(() => ({ ...window.__work, commits: window.__commits.length }));
    if (cdp === null) return work;
    const { metrics } = await cdp.send('Performance.getMetrics');
    const named = Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
    return { ...work, layouts: named.LayoutCount, styleRecalcs: named.RecalcStyleCount };
  };
  // The feed and the view are read just outside the counted window, so that reading them is no part of what the window cost.
  const from = await page.evaluate(READ_FEED);
  const a = await read();
  await sleep(ms);
  const b = await read();
  const to = await page.evaluate(READ_FEED);
  return { work: Object.fromEntries(Object.keys(a).map((key) => [key, b[key] - a[key]])), from, to };
}

/** The Source column of the session on screen, read in one task: the heads, the columns the grid says it has and, for each mounted row, its cells, the name and hue in the third, its width, and the chip's place. */
const READ_SOURCES = () => {
  const grid = document.querySelector('[data-log-session] [role=grid]');
  const r2 = (value) => Math.round(value * 100) / 100;
  const third = (row) => row.querySelectorAll('[role=gridcell]')[2];
  return {
    heads: [...grid.querySelectorAll('[role=columnheader]')].map((head) => head.textContent),
    headWidths: [...grid.querySelectorAll('[role=columnheader]')].map((head) => r2(head.getBoundingClientRect().width)),
    colcount: grid.getAttribute('aria-colcount'),
    rows: [...grid.querySelectorAll('[role=row][data-n]')].map((row) => {
      const cells = row.querySelectorAll('[role=gridcell]').length;
      const cell = third(row);
      // With one source the third cell is the text: only a row with four cells has a source cell and a chip.
      const chip = cells === 4 ? cell?.firstElementChild ?? null : null;
      const name = chip?.firstElementChild ?? null;
      const box = row.getBoundingClientRect();
      const cellBox = cell?.getBoundingClientRect();
      const chipBox = chip?.getBoundingClientRect();
      const swatch = chip === null ? null : getComputedStyle(chip, '::before');
      return {
        n: Number(row.getAttribute('data-n')),
        cells,
        name: cell?.textContent ?? '',
        hue: cell?.querySelector('[data-ov-hue]')?.getAttribute('data-ov-hue') ?? null,
        width: r2(cellBox?.width ?? 0),
        chips: row.querySelectorAll('[data-ov-clip]').length,
        chip: chipBox === undefined || cellBox === undefined ? null : { x: r2(chipBox.left - cellBox.left), y: r2(chipBox.top - box.top), w: r2(chipBox.width), h: r2(chipBox.height) },
        nameX: chipBox === undefined || name === null ? null : r2(name.getBoundingClientRect().left - chipBox.left),
        swatch: swatch === null ? null : { w: swatch.width, h: swatch.height, radius: swatch.borderTopLeftRadius },
      };
    }),
  };
};

// The mock's Source column, measured in WebKit and Chromium at 1440 x 900 (they agree) by docs/ui-next/status/L2/mock-sources-measure.mjs.txt, mock tree c8e44a44: the cell is 168 px; the chip stands 10 px into it (the cell's
// inset) and 3 px under the row's top, and is 18 px high; its name starts 19 px into it (the 1 px edge, the 6 px inset, the 8 px swatch and the 4 px gap); the swatch is 8 x 8 with a 2 px radius; a name that does not fit fills
// the cell (a chip 148 px wide).
const MOCK_SOURCE = { cell: 168, chipX: 10, chipY: 3, chipH: 18, nameX: 19, swatch: '8px', radius: '2px', chipWidthCut: 148 };

/**
 * The source of a line (L2), in a page of its own for each session. The fixture's `pair` (4) follows two sources and lists them with their labels; its lines take them in turn, the odd ones the first (`n` is the line's
 * number while nothing was dropped, and at 20 lines a second nothing is). `app` (0) follows one source.
 */
async function sources(browser, engine, viewportName, viewport, origin) {
  const where = `sources ${engine} ${viewportName}`;
  const readSession = async (index) => {
    const { page, context, errors } = await open(browser, url(origin), viewport);
    await ready(page);
    await page.evaluate((i) => { window.__logs.open(i); }, index);
    // The panel's body is short (about 19 rows are mounted at 1440 x 900): the lines the session has are counted by the grid's own row count, as the other sections do.
    await page.waitForFunction(() => Number(document.querySelector('[data-log-session] [role=grid]')?.getAttribute('aria-rowcount') ?? 0) > 30, null, { timeout: 15000 });
    await sleep(500);
    // The negative control: the name in every Source cell is the other source's. Only the text of the name element changes (the chip, its hue, its clip marker and the cell stay), so the check of the label is the only one that can see it.
    if (CONTROL === 'source-label' && index === 4) await page.evaluate(() => { for (const name of document.querySelectorAll('[data-log-session] [role=grid] [role=row][data-n] [role=gridcell] [data-ov-clip]')) name.textContent = name.textContent === 'app' ? 'worker' : 'app'; });
    const read = await page.evaluate(READ_SOURCES);
    for (const error of errors) fail(`errors ${where}`, error);
    await context.close();
    return read;
  };
  const LABELS = ['app', 'worker'];
  const HUES = ['blue', 'green'];
  const two = await readSession(4);
  const one = await readSession(0);
  if (JSON.stringify(two.heads) !== JSON.stringify(['Time', 'Level', 'Source', 'Message'])) fail(where, `two sources: the heads are ${JSON.stringify(two.heads)}, wanted Time, Level, Source, Message`);
  if (two.colcount !== '4') fail(where, `two sources: aria-colcount is ${String(two.colcount)}, wanted 4`);
  if (Math.abs((two.headWidths[2] ?? 0) - MOCK_SOURCE.cell) > 1) fail(where, `two sources: the Source head is ${String(two.headWidths[2])} px wide, the mock's is ${String(MOCK_SOURCE.cell)}`);
  if (two.rows.length < 8) fail(where, `two sources: ${String(two.rows.length)} rows mounted, wanted at least 8`);
  const wanted = (row) => (row.n - 1) % 2;
  // Each thing a row says about its source is a check of its own, so that a negative control that changes one of them is seen by that check and by no other.
  const wrongName = two.rows.filter((row) => row.name !== LABELS[wanted(row)]);
  if (wrongName.length > 0) fail(where, `two sources: ${String(wrongName.length)} of ${String(two.rows.length)} rows name the wrong source (the feed's label for the line's source: app for the odd lines, worker for the even); first: ${JSON.stringify(wrongName[0])}`);
  const bad = two.rows.filter((row) => row.cells !== 4 || row.hue !== HUES[wanted(row)] || Math.abs(row.width - MOCK_SOURCE.cell) > 1 || row.chips !== 1);
  if (bad.length > 0) fail(where, `two sources: ${String(bad.length)} of ${String(two.rows.length)} rows have no Source cell of the feed's source (four cells, its hue, 168 px, one chip); first: ${JSON.stringify(bad[0])}`);
  if (new Set(two.rows.map((row) => row.name)).size !== 2) fail(where, `two sources: the names in the rows are ${JSON.stringify([...new Set(two.rows.map((row) => row.name))])}, wanted both ${JSON.stringify(LABELS)}`);
  const off = two.rows.filter((row) => row.chip === null || row.swatch === null || Math.abs(row.chip.x - MOCK_SOURCE.chipX) > 1 || Math.abs(row.chip.y - MOCK_SOURCE.chipY) > 0.5 || Math.abs(row.chip.h - MOCK_SOURCE.chipH) > 0.5 || Math.abs((row.nameX ?? 0) - MOCK_SOURCE.nameX) > 1 || row.swatch.w !== MOCK_SOURCE.swatch || row.swatch.h !== MOCK_SOURCE.swatch || row.swatch.radius !== MOCK_SOURCE.radius);
  if (CONTROL === '' && off.length > 0) fail(where, `two sources: ${String(off.length)} of ${String(two.rows.length)} chips are not the mock's (10 px in, 3 px down, 18 px high, the name 19 px in, an 8 px swatch with a 2 px radius); first: ${JSON.stringify(off[0])}`);
  if (JSON.stringify(one.heads) !== JSON.stringify(['Time', 'Level', 'Message'])) fail(where, `one source: the heads are ${JSON.stringify(one.heads)}, wanted Time, Level, Message`);
  if (one.colcount !== '3') fail(where, `one source: aria-colcount is ${String(one.colcount)}, wanted 3`);
  if (one.rows.length < 8) fail(where, `one source: ${String(one.rows.length)} rows mounted, wanted at least 8`);
  const extra = one.rows.filter((row) => row.cells !== 3 || row.chips !== 0);
  if (extra.length > 0) fail(where, `one source: ${String(extra.length)} rows draw more than a clock, a level and a text; first: ${JSON.stringify(extra[0])}`);
  report.sources[`${engine} ${viewportName}`] = { twoHeads: two.heads, twoHeadWidths: two.headWidths, twoRows: two.rows.length, firstTwoRows: two.rows.slice(0, 2), oneHeads: one.heads, oneRows: one.rows.length };
}

/**
 * What the view measures, counted from the page's start (the probe resets it before the window it reads): the `getBoundingClientRect` calls on an element of a log view, and the ResizeObserver callbacks that told a log view
 * one of its boxes changed. The view reads its row height and its box once when it mounts and when either changes; a column that appears changes neither.
 */
const MEASURES = `(() => {
  const measures = (window.__measures = { observed: 0, rects: 0 });
  const inView = (element) => element instanceof Element && element.closest('[data-log-session]') !== null;
  const Observer = window.ResizeObserver;
  window.ResizeObserver = class extends Observer {
    constructor(callback) {
      super((entries, observer) => {
        if (entries.some((entry) => inView(entry.target))) measures.observed += 1;
        callback(entries, observer);
      });
    }
  };
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (inView(this)) measures.rects += 1;
    return rect.call(this);
  };
})();`;

/** The list of the session on screen, read in one task: its heads, where it is scrolled, whether it follows, and for each mounted row where it is in the content (its y from the top of the rows' block) and where its cells are (x and width from the canvas). */
const READ_APPEAR = () => {
  const grid = document.querySelector('[data-log-session] [role=grid]');
  const r2 = (value) => Math.round(value * 100) / 100;
  const rows = [...grid.querySelectorAll('[role=row][data-n]')];
  const canvas = grid.firstElementChild.getBoundingClientRect();
  // A row sits in the window, which sits in the block as high as all the rows.
  const block = rows[0]?.parentElement?.parentElement?.getBoundingClientRect();
  return {
    heads: [...grid.querySelectorAll('[role=columnheader]')].map((head) => head.textContent),
    colcount: grid.getAttribute('aria-colcount'),
    rowcount: Number(grid.getAttribute('aria-rowcount')),
    scrollTop: grid.scrollTop,
    scrollHeight: grid.scrollHeight,
    clientHeight: grid.clientHeight,
    following: (document.querySelector('[data-log-session] [aria-label="Session status"]')?.textContent ?? '').includes('Following'),
    rows: rows.map((row) => {
      const box = row.getBoundingClientRect();
      const clip = row.querySelector('[data-ov-clip]');
      return {
        n: Number(row.getAttribute('data-n')),
        y: r2(box.top - (block?.top ?? 0)),
        h: r2(box.height),
        cells: [...row.querySelectorAll('[role=gridcell]')].map((cell) => { const cellBox = cell.getBoundingClientRect(); return [r2(cellBox.left - canvas.left), r2(cellBox.width)]; }),
        source: clip?.getAttribute('data-ov-full') ?? clip?.textContent ?? null,
        cut: clip === null ? null : clip.scrollWidth > clip.clientWidth,
        chipWidth: clip === null ? null : r2(clip.parentElement.getBoundingClientRect().width),
      };
    }),
  };
};

/**
 * The column appears (L2). The fixture's `late` session (5) follows one source and, when `speak()` is called, hears of a second and writes its first line. The feeds are made quiet first and given the time the strip's rate
 * needs to settle (3 s), so what the page does in the window is the column's own. Read twice: following the end, and scrolled back 150 rows. Chromium counts the page's layouts (CDP); WebKit has no such counter, so the
 * rest of what is asserted, which both have, is what "one layout, no jump" means in a page: no row moved, the list did not scroll, the view measured nothing.
 */
async function appears(browser, engine, viewportName, viewport, origin) {
  const SECOND = 'late/orders-7d8c6f49b-f8q4m/init-migrations';
  for (const mode of ['following', 'scrolled back']) {
    const where = `appears ${engine} ${viewportName} (${mode})`;
    const { page, context, errors } = await open(browser, url(origin), viewport, { init: MEASURES });
    const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
    if (cdp !== null) await cdp.send('Performance.enable');
    const layouts = async () => (cdp === null ? null : (await cdp.send('Performance.getMetrics')).metrics.find((metric) => metric.name === 'LayoutCount')?.value ?? null);
    await ready(page);
    await page.evaluate(() => { window.__logs.open(5); });
    await page.waitForFunction(() => Number(document.querySelector('[data-log-session] [role=grid]')?.getAttribute('aria-rowcount') ?? 0) > 400, null, { timeout: 30000 });
    if (mode === 'scrolled back') {
      await page.evaluate(() => { document.querySelector('[data-log-session] [role=grid]').scrollTop = 24 * 150; });
      await sleep(300);
    }

    await page.evaluate(() => window.__fixtureLogs.stopSources());
    await sleep(3800);
    const before = await page.evaluate(READ_APPEAR);
    const layoutsBefore = await layouts();
    await page.evaluate(() => { window.__measures.observed = 0; window.__measures.rects = 0; window.__commitsAt = window.__commits.length; window.__fixtureLogs.speak(); });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-log-session] [role=columnheader]')].some((head) => head.textContent === 'Source'), null, { polling: 'raf', timeout: 5000 });
    await sleep(120);
    const layoutsAfter = await layouts();
    const counted = await page.evaluate(() => ({ observed: window.__measures.observed, rects: window.__measures.rects, commits: window.__commits.length - window.__commitsAt }));
    // The negative control: the list is moved when the column has appeared.
    if (CONTROL === 'column-moves' && mode === 'scrolled back') await page.evaluate(() => { document.querySelector('[data-log-session] [role=grid]').scrollTop += 48; });
    const after = await page.evaluate(READ_APPEAR);

    const said = JSON.stringify;
    if (said(before.heads) !== said(['Time', 'Level', 'Message']) || before.colcount !== '3') fail(where, `with one source the heads were ${said(before.heads)} and aria-colcount ${String(before.colcount)}, wanted Time, Level, Message and 3`);
    if (said(after.heads) !== said(['Time', 'Level', 'Source', 'Message']) || after.colcount !== '4') fail(where, `after the second source spoke the heads are ${said(after.heads)} and aria-colcount ${String(after.colcount)}, wanted Time, Level, Source, Message and 4`);
    const rowHeight = before.rows[0]?.h ?? 0;
    const was = new Map(before.rows.map((row) => [row.n, row]));
    const near = (a, b, by) => Math.abs(a - b) <= by;
    const moved = [];
    let kept = 0;
    for (const row of after.rows) {
      const old = was.get(row.n);
      if (old === undefined) continue;
      kept += 1;
      // The clock and the level are where they were, the row is where and as high as it was, and the text is one column on.
      if (!near(row.y, old.y, 0.5) || !near(row.h, old.h, 0.5) || row.cells.length !== 4 || old.cells.length !== 3 || !near(row.cells[0][0], old.cells[0][0], 0.5) || !near(row.cells[0][1], old.cells[0][1], 0.5) || !near(row.cells[1][0], old.cells[1][0], 0.5) || !near(row.cells[1][1], old.cells[1][1], 0.5) || !near(row.cells[3][0], old.cells[2][0] + MOCK_SOURCE.cell, 1)) moved.push(row.n);
    }

    if (kept < 8) fail(where, `only ${String(kept)} rows were drawn before and after: the check had nothing to compare`);
    if (moved.length > 0) fail(where, `${String(moved.length)} of ${String(kept)} rows that were drawn moved or changed size when the column appeared (rows ${moved.slice(0, 5).join(', ')}); first: ${said(was.get(moved[0] ?? 0))} then ${said(after.rows.find((row) => row.n === moved[0]))}`);
    const off = [...before.rows, ...after.rows].filter((row) => !near(row.y, (row.n - 1) * rowHeight, 0.5));
    if (off.length > 0) fail(where, `${String(off.length)} rows are not at their line's place in the content (y = (n - 1) x ${String(rowHeight)}); first: ${said(off[0])}`);
    if (mode === 'scrolled back') {
      if (after.scrollTop !== before.scrollTop) fail(where, `the list scrolled: scrollTop ${String(before.scrollTop)}, then ${String(after.scrollTop)}`);
      if (after.rows[0]?.n !== before.rows[0]?.n || after.rows.at(-1)?.n !== before.rows.at(-1)?.n) fail(where, `the rows on screen changed: ${String(before.rows[0]?.n)} to ${String(before.rows.at(-1)?.n)}, then ${String(after.rows[0]?.n)} to ${String(after.rows.at(-1)?.n)}`);
      if (before.following || after.following) fail(where, 'the list was following the end: the scrolled-back case is not what it was meant to be');
    } else {
      if (!after.following) fail(where, 'the list stopped following the end when the column appeared');
      if (!near(after.scrollTop, after.scrollHeight - after.clientHeight, 1)) fail(where, `the list is not at the end: scrollTop ${String(after.scrollTop)} of ${String(after.scrollHeight - after.clientHeight)}`);
      const last = after.rows.at(-1);
      if (last === undefined || last.n !== after.rowcount - 1) fail(where, `the last row on screen is line ${String(last?.n)}, the newest line is ${String(after.rowcount - 1)}`);
      else if (last.source !== SECOND || last.cut !== true || !near(last.chipWidth ?? 0, MOCK_SOURCE.chipWidthCut, 1)) fail(where, `the newest line's source is not the second source cut to the cell (its whole name for the tip): ${said(last)}`);
    }

    if (counted.observed !== 0) fail(where, `the view was told its box changed ${String(counted.observed)} time(s) when the column appeared, wanted none`);
    if (counted.rects !== 0) fail(where, `the view measured ${String(counted.rects)} element(s) when the column appeared, wanted none`);
    const lays = layoutsBefore === null || layoutsAfter === null ? null : layoutsAfter - layoutsBefore;
    if (lays !== null && lays > 1) fail(where, `the page laid out ${String(lays)} times when the column appeared, wanted at most one`);
    report.appears[`${engine} ${viewportName} ${mode}`] = { layouts: lays, commits: counted.commits, observed: counted.observed, rects: counted.rects, rowsDrawnBefore: before.rows.length, rowsKept: kept, rowsMoved: moved.length, scrollTop: [before.scrollTop, after.scrollTop], following: [before.following, after.following], rowCount: [before.rowcount, after.rowcount] };
    if (cdp === null) report.notes.push(`${where}: WebKit has no layout counter: no row moved, the list did not scroll and the view measured nothing is what it checks`);
    for (const error of errors) fail(`errors ${where}`, error);
    await context.close();
  }
}

async function hidden(browser, engine, viewportName, viewport, origin) {
  const where = `hidden ${engine} ${viewportName}`;
  /** Nothing the page did in a window of `ms`: no frame, timer, mutation or commit asked for. */
  const zero = (label, ms, { work }) => {
    for (const [key, value] of Object.entries(work)) if (value !== 0) fail(where, `${label}: ${String(value)} ${key} in ${String(ms / 1000)} s, wanted none (${JSON.stringify(work)})`);
  };
  /** The feed made lines at its rate in the window. A feed that is quiet passes every zero, so it fails here, and says so. */
  const emitting = (label, { from, to }) => {
    const seconds = (to.at - from.at) / 1000;
    const lines = to.emitted - from.emitted;
    const wanted = RATE * seconds;
    if (lines < 0.8 * wanted || lines > 1.25 * wanted) fail(where, `the feed emitted ${String(lines)} lines ${label} in ${seconds.toFixed(2)} s, wanted about ${String(Math.round(wanted))} (${String(RATE)} a second)`);
    return lines;
  };
  /** A hidden view reads nothing: every line the feed made is still held or was dropped past its bound, and the view took in no entry. */
  const unread = (label, { from, to }) => {
    const made = to.emitted - from.emitted;
    const kept = to.held - from.held + (to.dropped - from.dropped);
    if (made !== kept) fail(where, `${label}: ${String(made)} lines were made and ${String(kept)} are held or dropped: the view read ${String(made - kept)} of them`);
    if (to.newest !== from.newest) fail(where, `${label}: the view took in entries (its newest was ${String(from.newest)}, then ${String(to.newest)}) while it was hidden`);
    if (to.held > STREAM_BOUND) fail(where, `${label}: the stream holds ${String(to.held)} lines, past its bound of ${String(STREAM_BOUND)}`);
  };
  const { page, context, errors } = await open(browser, url(origin), viewport, { init: COUNT });
  const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
  if (cdp !== null) await cdp.send('Performance.enable');
  await ready(page);
  await page.evaluate(() => window.__panel.show({ tool: 'logs' }));
  await page.evaluate(() => { window.__logs.open(3); });
  await page.waitForSelector('[data-log-session] [role=grid]');
  await sleep(2500);
  // Open: one commit a frame at most, counted frame by frame for 2 s (the engine's own requestAnimationFrame: the page's is wrapped and counted).
  const frames = await page.evaluate((ms) => new Promise((resolve) => {
    const raf = window.__rawRaf;
    let last = window.__commits.length;
    let count = 0;
    let most = 0;
    let total = 0;
    const end = performance.now() + ms;
    const tick = () => {
      const now = window.__commits.length;
      const d = now - last;
      last = now;
      count += 1;
      total += d;
      most = Math.max(most, d);
      if (performance.now() < end) raf(tick);
      else resolve({ frames: count, mostCommitsInAFrame: most, commits: total });
    };
    raf(tick);
  }), 2000);
  const open_ = await windowOf(page, cdp, 2000);
  if (frames.mostCommitsInAFrame > 1) fail(where, `${frames.mostCommitsInAFrame} commits in one frame with the panel open (${JSON.stringify(frames)})`);
  // With the panel open the view draws the stream: without commits, frames and DOM changes the zeros below would mean nothing, and without lines taken in it would be drawing nothing.
  if (frames.commits === 0 || open_.work.commits === 0) fail(where, `no commit in 2 s with the panel open (${JSON.stringify(frames)}, ${JSON.stringify(open_.work)}): the view is not drawing the stream`);
  if (open_.work.raf === 0 || open_.work.mutations === 0) fail(where, `with the panel open the view asked for no frame or changed no node in 2 s (${JSON.stringify(open_.work)})`);
  const madeOpen = emitting('with the panel open', open_);
  if (open_.to.newest <= open_.from.newest) fail(where, `the view took in no line in 2 s with the panel open (its newest row was ${String(open_.from.newest)}, then ${String(open_.to.newest)})`);
  // The panel closed: nothing is drawn, nothing is asked for, and the feed goes on.
  await page.evaluate(() => window.__panel.hide());
  await sleep(500);
  // The negative control: the feed goes quiet once the view is hidden. Every zero below passes for a feed that makes no lines, so the check that the feed went on must fail.
  if (CONTROL === 'feed-stopped') await page.evaluate(() => window.__fixtureLogs.stopSources());
  const closed = await windowOf(page, cdp, CLOSED_MS);
  zero('the panel closed', CLOSED_MS, closed);
  const madeClosed = emitting('while the panel was closed', closed);
  unread('the panel closed', closed);
  // Another tool shown, one that holds no session: the log session is mounted and hidden. Long enough for the stream to reach its bound and drop the oldest lines.
  await page.evaluate(() => window.__panel.show({ tool: 'alpha:streams' }));
  await sleep(500);
  const other = await windowOf(page, cdp, OTHER_MS);
  zero('another tool shown', OTHER_MS, other);
  const madeOther = emitting('while another tool was shown', other);
  unread('another tool shown', other);
  // Back on the Logs tool: the view reads what the stream kept, a frame at a time, and follows the tail again.
  const atReturn = await page.evaluate(READ_FEED);
  await page.evaluate(() => window.__panel.show({ tool: 'logs' }));
  const returned = Date.now();
  // The strip's rate while the view catches up and for 3.5 s after (the window the rate is told over is 3 s): the feed makes 10,000 lines a second, and the lines the view reads in a burst are the feed's
  // past, so the strip must not read them as live (L1: the rate was about 35,000 lines/s for a few seconds after coming back).
  const rateOf = (text) => Number((/([\d,.]+) lines\/s/.exec(text)?.[1] ?? '0').replace(/,/g, ''));
  const rates = [];
  let caughtUp = false;
  let caughtUpAt = 0;
  const deadline = Date.now() + 30000;
  for (;;) {
    const now = await page.evaluate(READ_FEED);
    rates.push(rateOf(now.strip));
    if (!caughtUp && now.held < CAUGHT_UP_LINES) {
      caughtUp = true;
      caughtUpAt = Date.now();
    }

    if (caughtUp && Date.now() - caughtUpAt >= 3500) break;
    if (Date.now() > deadline) break;
    await sleep(100);
  }

  const caughtUpMs = caughtUpAt === 0 ? Date.now() - returned : caughtUpAt - returned;
  const back = await page.evaluate(READ_FEED);
  // The view stopped reading when it was hidden (`closed.from`). Since then the feed made `made` lines. The view took in `tookIn` entries: the lines it read, and a marker where the stream dropped some. The
  // stream still holds `held` of them and dropped `dropped`. So `tookIn + held + dropped - made` is the number of markers, a few at most.
  const stopped = closed.from;
  const made = back.emitted - stopped.emitted;
  const tookIn = back.newest - stopped.newest;
  const held = back.held - stopped.held;
  const dropped = back.dropped - stopped.dropped;
  const markers = tookIn + held + dropped - made;
  const fastest = Math.max(...rates);
  const lastRate = rates.at(-1) ?? 0;
  if (fastest > 1.5 * RATE) fail(where, `the strip read ${String(fastest)} lines/s on the way back, the feed makes ${String(RATE)}: the catch-up was counted as live`);
  if (lastRate < 0.5 * RATE || lastRate > 1.5 * RATE) fail(where, `3.5 s after the view caught up the strip reads ${String(lastRate)} lines/s, the feed makes ${String(RATE)}`);
  if (!caughtUp) fail(where, `the view had not caught up with the stream 30 s after it came back (the stream still holds ${String(back.held)} lines)`);
  if (back.newest <= stopped.newest) fail(where, `back on the Logs tool the view shows no newer line than before it was hidden (its newest row was ${String(stopped.newest)}, then ${String(back.newest)})`);
  if (tookIn < atReturn.held - CAUGHT_UP_LINES) fail(where, `the stream held ${String(atReturn.held)} lines when the view came back and the view took in ${String(tookIn)} entries since it was hidden`);
  if (markers < 0 || markers > 3) fail(where, `${String(made)} lines were made since the view stopped reading; it took in ${String(tookIn)} entries, the stream holds ${String(held)} more and dropped ${String(dropped)}: ${String(markers)} markers, wanted 0 to 3`);
  if (back.rows < stopped.rows) fail(where, `back on the Logs tool the view has ${String(back.rows)} rows, it had ${String(stopped.rows)} when it was hidden`);
  if (!back.strip.includes('Following')) fail(where, `back on the Logs tool the view says "${back.strip}", wanted Following`);
  // The view's own words: its strip says ONE number of dropped lines, the lines the stream dropped while the view was not reading and the lines the view pushed out of its own buffer (L1). Every line
  // the stream dropped since the view stopped reading must be in it. The strip is told four times a second, so it may be a few thousand lines behind the feed, which is why the exact sum is checked below,
  // once the sources are quiet.
  const droppedSaid = (text) => Number((/([\d,]+) older lines? dropped/.exec(text)?.[1] ?? '0').replace(/,/g, ''));
  const countOf = (text) => Number((/^([\d,]+) lines?/.exec(text)?.[1] ?? '-1').replace(/,/g, ''));
  const neverShown = (text) => Number((/([\d,]+) lines? never reached the view/.exec(text)?.[1] ?? '0').replace(/,/g, ''));
  if (droppedSaid(back.strip) < dropped) fail(where, `the stream dropped ${String(dropped)} lines while the view was not reading and the strip says "${back.strip}": the user is not told of every dropped line`);
  // Told: the sources go quiet, the view reads what the stream still holds, and the strip is told. From here the numbers stand still, so they must add up exactly: every line the sources made is a line the
  // strip counts or a line it says was dropped, and the lines the note says never reached the view are the stream's own count of what it dropped.
  await page.evaluate(() => window.__fixtureLogs.stopSources());
  try {
    await page.waitForFunction(() => window.__fixtureLogs.stats().held === 0, undefined, { timeout: 30000, polling: 100 });
  } catch {
    fail(where, 'the view did not read what the stream held once the sources were quiet');
  }

  await sleep(800);
  const quiet = await page.evaluate(READ_FEED);
  const shownLines = countOf(quiet.strip);
  const toldDropped = droppedSaid(quiet.strip);
  if (shownLines < 0) fail(where, `the strip says "${quiet.strip}": no count of lines`);
  if (quiet.emitted !== shownLines + toldDropped) fail(where, `the sources made ${String(quiet.emitted)} lines; the strip shows ${String(shownLines)} and says ${String(toldDropped)} were dropped (${String(shownLines + toldDropped)}): "${quiet.strip}"`);
  if (quiet.dropped === 0) fail(where, 'the stream dropped no line in 13 s at 10,000 lines a second: the probe does not reach the case it is for');
  if (neverShown(quiet.note) !== quiet.dropped) fail(where, `the stream dropped ${String(quiet.dropped)} lines and the strip's note says ${String(neverShown(quiet.note))} never reached the view: "${quiet.note}"`);
  if (shownLines > VIEW_BOUND) fail(where, `the strip counts ${String(shownLines)} lines, more than the view's bound of ${String(VIEW_BOUND)}`);
  report.hidden[`${engine} ${viewportName}`] = {
    open: { ...frames, ...open_.work, emitted: madeOpen, newestRow: [open_.from.newest, open_.to.newest] },
    closed: { ...closed.work, emitted: madeClosed, streamHeldAfter: closed.to.held },
    other: { ...other.work, emitted: madeOther, streamHeldAfter: other.to.held, streamDroppedAfter: other.to.dropped },
    back: {
      streamHeldAtReturn: atReturn.held,
      caughtUpInMs: caughtUpMs,
      newestRow: [stopped.newest, back.newest],
      rows: [stopped.rows, back.rows],
      emittedSinceHidden: made,
      viewTookIn: tookIn,
      streamDropped: dropped,
      markers,
      stripBefore: stopped.strip,
      stripAfter: back.strip,
      stripRate: { fastestOnTheWayBack: fastest, last: lastRate },
    },
    told: { emitted: quiet.emitted, shown: shownLines, toldDropped, streamDropped: quiet.dropped, note: quiet.note, strip: quiet.strip },
  };
  console.log(
    `${where}: while hidden the feed made ${String(madeClosed + madeOther)} lines (${String(madeClosed)} panel closed, ${String(madeOther)} another tool shown), the stream held ${String(atReturn.held)} and dropped ${String(other.to.dropped - stopped.dropped)}; ` +
      `back: newest row ${String(stopped.newest)} to ${String(back.newest)}, rows ${String(stopped.rows)} to ${String(back.rows)}, caught up in ${String(caughtUpMs)} ms, the strip says ${String(droppedSaid(back.strip))} older lines dropped (before: ${String(droppedSaid(stopped.strip))}); quiet: made ${String(quiet.emitted)} = shown ${String(shownLines)} + told dropped ${String(toldDropped)}`,
  );
  if (cdp === null) report.notes.push(`${where}: WebKit has no layout or style counter: frames, timers, mutations and commits only`);
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

const production = wants('fills') || wants('sources') || wants('kept') || wants('memory') ? await serveFixtures(buildFixtures('production')) : null;
const development = wants('hidden') || wants('appears') ? await serveFixtures(buildFixtures('development')) : null;
for (const engineName of engineNames) {
  const browser = await launch(engineName);
  for (const viewportName of viewportNames) {
    const viewport = NATIVE_VIEWPORTS[viewportName];
    if (wants('fills')) {
      await fills(browser, engineName, viewportName, viewport, production.origin);
      await shift(browser, engineName, viewportName, viewport, production.origin);
      await keep(browser, engineName, viewportName, viewport, production.origin);
      await listeners(browser, engineName, viewportName, viewport, production.origin);
      ran.add('fills');
    }

    if (wants('sources')) {
      await sources(browser, engineName, viewportName, viewport, production.origin);
      ran.add('sources');
    }

    if (wants('kept')) {
      await kept(browser, engineName, viewportName, viewport, production.origin);
      ran.add('kept');
    }

    if (wants('memory') && (await memory(browser, engineName, viewportName, viewport, production.origin))) ran.add('memory');
    if (wants('appears')) {
      await appears(browser, engineName, viewportName, viewport, development.origin);
      ran.add('appears');
    }

    if (wants('hidden')) {
      await hidden(browser, engineName, viewportName, viewport, development.origin);
      ran.add('hidden');
    }
    console.log(engineName, viewportName, 'done');
  }

  await browser.close();
}

production?.server.close();
development?.server.close();
if (CONTROL === '') for (const name of ONLY) if (!ran.has(name)) fail('sections', `${name} was asked for (SECTIONS) and ran in no engine of ${engineNames.join(', ')}`);
if (ONLY.length > 0) report.notes.push(`SECTIONS=${ONLY.join(',')}: ran ${[...ran].join(', ') || 'nothing'}`);
if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ hidden: report.hidden, shift: report.shift, sources: report.sources, appears: report.appears, memory: report.memory, notes: report.notes }, null, 1));
if (CONTROL !== '') {
  const detected = failures.filter((line) => PERTURBATIONS[CONTROL].expected.test(line));
  console.log(`\nwhat the probe saw with the perturbation "${CONTROL}": ${String(failures.length)} differences\n${failures.map((line) => `  ${line}`).join('\n')}`);
  console.log(detected.length > 0 ? `\nNEGATIVE CONTROL "${CONTROL}": detected (${String(detected.length)} differences, e.g. ${detected[0]})` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${String(failures.length)} other failures)`);
  process.exit(detected.length > 0 ? 0 : 1);
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}

console.log('\nlogs probe: no failures');
