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
// NEGATIVE_CONTROL=feed-stopped   the feed goes quiet once the view is hidden (Chromium at 1440 x 900, the `hidden` section only): the probe must fail its check that the feed went on, which a view that
//                                 costs nothing because its feed is quiet would pass; the exit code is 0 when it did, 1 when it did not
// Exit code 1 when anything differs.
import { writeFileSync } from 'node:fs';
import { ENGINES, launch } from '../../../packages/kit/probes/probe-lib.mjs';
import { NATIVE_VIEWPORTS, SAMPLER, buildFixtures, open, serveFixtures, sleep } from './harness.mjs';

// The negative control: one perturbation of what the page does after it loaded, which the probe must see. With NEGATIVE_CONTROL the exit code is 0 when it did.
const PERTURBATIONS = {
  'feed-stopped': { sections: ['hidden'], expected: /^hidden .*: the feed emitted/ },
};
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
if (CONTROL !== '' && PERTURBATIONS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);
const wants = (section) => CONTROL === '' || PERTURBATIONS[CONTROL].sections.includes(section);
const engineNames = (process.env.ENGINES ?? (CONTROL === '' ? Object.keys(ENGINES).join(',') : 'chromium')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? (CONTROL === '' ? Object.keys(NATIVE_VIEWPORTS).join(',') : '1440x900')).split(',');
const failures = [];
const report = { fills: {}, shift: {}, keep: {}, listeners: {}, hidden: {}, notes: [] };
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

const production = wants('fills') ? await serveFixtures(buildFixtures('production')) : null;
const development = await serveFixtures(buildFixtures('development'));
for (const engineName of engineNames) {
  const browser = await launch(engineName);
  for (const viewportName of viewportNames) {
    const viewport = NATIVE_VIEWPORTS[viewportName];
    if (wants('fills')) {
      await fills(browser, engineName, viewportName, viewport, production.origin);
      await shift(browser, engineName, viewportName, viewport, production.origin);
      await keep(browser, engineName, viewportName, viewport, production.origin);
      await listeners(browser, engineName, viewportName, viewport, production.origin);
    }

    await hidden(browser, engineName, viewportName, viewport, development.origin);
    console.log(engineName, viewportName, 'done');
  }

  await browser.close();
}

production?.server.close();
development.server.close();
if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ hidden: report.hidden, shift: report.shift, notes: report.notes }, null, 1));
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
