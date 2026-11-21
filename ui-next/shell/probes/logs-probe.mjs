// Probes the host's Logs tool in WebKit and Chromium at 1440 x 900 and 1280 x 800 (P1b-3a, decision A15), on the host fixture (host-fixture.tsx `?logs=1&panel=1`: the product's own `PluginHost`
// around invented plugins; the fixture plugin's seven Logs sessions are opened through the `ctx.panel` a page was given, as a plugin's command does).
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
//                                 the calls themselves show a stream closed twice. The calls are read before the raise and must be one each: any other baseline fails a check of its own and is no detection
// NEGATIVE_CONTROL=kept-lines     the number of the oldest line of the first session's view is not the one the page drew, just before the check that the lines a view had are the ones it has (the `kept` section only); a view that
//                                 drew no line fails a check of its own, which this control does not look for
// NEGATIVE_CONTROL=second-stream  one more stream is counted opened just before the check that `app` pressed twice opened ONE stream (the `identity` section only): the probe must fail that check. The count is read before the raise and must be
//                                 one: any other baseline fails a check of its own and is no detection (a probe that was already failing). The other counters have a check of their own, and a page that opened no stream a failure of its own
// NEGATIVE_CONTROL=lone-scope     a scope part is put into the label of the tab of the session (found by its id) just before the check that a lone session's tab draws none (the `identity` section only); the name of the tab stays, so only
//                                 that check sees it, and a strip that has no such tab fails a check of its own (the strip holds the tab of the session and no other), which this control does not look for
// NEGATIVE_CONTROL=same-name      the tab of the new session beside an ended one is given the ended tab's name just before the check that no two tabs share a name (the `identity` section only)
// NEGATIVE_CONTROL=axe-name       the name of each tab that draws a scope is its title only, just before axe runs (the `a11y` section only): axe's `label-content-name-mismatch` must be reported for the case of the two scoped tabs
// NEGATIVE_CONTROL=over-lines     the text of the oldest line of the ended session's view is another line's, under the same tab, just before the check that the view still shows that line as it was (the `identity` section only): the
//                                 count of its rows is the same, so only the check of the line itself sees it
//
// Sections added for A21 (a plugin's unload keeps its sessions of the host's Logs tool): `kept` (both engines: the tabs, the views, the streams closed once, the cards, the new press, the four tabs closed) and `memory`
// (Chromium: a session fills the view to its bound, the plugin is unloaded, the tab is closed, and after a forced garbage collection the heap has fallen back; WebKit has no heap counter to drive: `kept` is its check).
//
// Sections added for A22 (a Logs session is its plugin and its target, P1b-3d, on the host fixture): `identity` (both engines, one window: `app` pressed twice is one session, one tab that draws no scope and one stream; pressed again with the
// panel hidden and with another tool on screen it shows the session and the page's focus stays where it was; its twin in the south yard is a second session whose tab and `app`'s draw their scope, and the tab left loses its scope when the twin
// closes; a session that has ended, and one that has failed, get a new session beside them, named apart, with the old stream not closed and the old view not emptied (its rows counted, and its oldest line read again, by its number and
// its text, under the old tab, chosen by its id); a third press shows the live one (the stream of the new session is held live by the fixture, `hold`, so that a slow page cannot end it before that press, and the probe ends it itself,
// `endHeld`); closing every tab closes each stream once)
// and `a11y` (both engines: axe-core on the host fixture with the Logs tool open and the real log view under it, in three states: one session, two scoped twins, an ended session beside the new one its press opened; a serious or critical
// finding fails, a moderate one is a note in the report).
// SECTIONS=kept,memory runs only those sections (a draft run); a name that is no section, or a section that ran in no engine (`memory` measures in Chromium only), fails the run.
// Exit code 1 when anything differs.
import { readFileSync, writeFileSync } from 'node:fs';
import { ENGINES, launch } from '../../../packages/kit/probes/probe-lib.mjs';
import { AXE, NATIVE_VIEWPORTS, SAMPLER, buildFixtures, open, serveFixtures, sleep } from './harness.mjs';

// The negative control: one perturbation of what the page does after it loaded, which the probe must see. With NEGATIVE_CONTROL the exit code is 0 when it did.
const PERTURBATIONS = {
  'feed-stopped': { sections: ['hidden'], expected: /^hidden .*: the feed emitted/ },
  'source-label': { sections: ['sources'], expected: /^sources .*: two sources: .* rows name the wrong source/ },
  'column-moves': { sections: ['appears'], expected: /^appears .*: the list scrolled/ },
  // A21: every listener ever added to a Set is kept for good, which keeps the view's model (its listeners close over it) after its tab closed: the heap must not be seen to fall (Chromium, the `memory` section).
  'kept-leak': { sections: ['memory'], expected: /^memory .*: the heap kept/ },
  // A21: a stream closed twice, which the count of closed feeds does not see (it counts a feed once): the calls to close are counted, and the page says one more. The calls are read first and must be one each (see `second-stream`).
  'close-twice': { sections: ['kept'], expected: /^kept .*: after the unload: close was asked of each feed once/ },
  // A21: the lines a held view shows are the ones it had, not only as many: the oldest line's number is changed in the page.
  'kept-lines': { sections: ['kept'], expected: /^kept .*: the oldest line of app was/ },
  // A22: a press of a command whose session is open starts no second stream (the count of feeds opened is one more, as if it had), a lone session's tab draws no scope (a scope part is put into its label), the tab of a new session
  // beside an ended one has the ended tab's name (no two tabs share a name; the check of the two names beside it sees it too), the old view of an ended session shows another line under its tab (its rows are as many), and the name of
  // a tab that draws a scope leaves its scope out (axe's `label-content-name-mismatch`). Each is made in the page right before the check it is named for and undone right after, and each is for ONE check: a page that lacks what a
  // control changes (no tab of the session, no count of feeds, no row) fails a check of its own, with a message the control's line does not match, so a page that rendered nothing is no detection. A control that raises a count reads it
  // first (`second-stream`, and `close-twice` above): a baseline that is not what an unperturbed probe sees is a failure of its own too, so a probe that was already failing is no detection either.
  'second-stream': { sections: ['identity'], expected: /^identity .*: pressed twice: one stream was opened/ },
  'lone-scope': { sections: ['identity'], expected: /^identity .*: pressed twice: the lone tab draws no scope part/ },
  'same-name': { sections: ['identity'], expected: /^identity .*: an ended session pressed again: no two tabs share a name/ },
  'axe-name': { sections: ['a11y'], expected: /^a11y .*: the Logs tool, open, two sessions of one title in two scopes .*: label-content-name-mismatch/ },
  'over-lines': { sections: ['identity'], expected: /^identity .*: an ended session pressed again: its view still shows line \d+ as it was/ },
  // P1b-4a, the toolbar. Each is made in the page right before the check it is named for, and each is for ONE check (the same fault passes with that check removed: ASSERTION_OFF=<expected>): the view's row count reads five more while the
  // toolbar says paused (the view draws lines while paused), the text a copy wrote has no source labels, the count of lines after a Clear is one more than the stream made, a choice of a session (UTC) is lost when it comes back, the count of
  // commits a Pause press cost is one more (a commit that never happened is entered in the profiler's list), and a toolbar that kept its confirmation's clock while hidden changes a node inside the closed window. `toolbar-moved` stands the column 3 px to the right while it is measured, which the comparison with the mock's geometry must see.
  'toolbar-moved': { sections: ['toolbar'], expected: /^toolbar .*: geometry: the toolbar's column/ },
  'pause-leaks': { sections: ['toolbar'], expected: /^toolbar .*: pause: the view drew \d+ lines while paused/ },
  'copy-no-source': { sections: ['toolbar'], expected: /^toolbar .*: copy: a line is not the mock's lineText/ },
  'clear-miscount': { sections: ['toolbar'], expected: /^toolbar .*: clear: the sources made/ },
  'state-lost': { sections: ['toolbar'], expected: /^toolbar .*: session: back on the first session/ },
  // `more-missing` reads the column's buttons without the More button at the panel's least height, which the check of the buttons that stay and the one behind it must see.
  'more-missing': { sections: ['toolbar'], expected: /^toolbar .*: short: at 120 px the column holds/ },
  'pause-commits': { sections: ['hidden'], expected: /^hidden .*: toggling Pause at \d+ lines a second cost/ },
  'toolbar-timer': { sections: ['hidden'], expected: /^hidden .*: the panel closed: \d+ mutations/ },
};
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
/** The controls of P1b-4a: each trips its own assertion and no other, and the run says so (see the end of this file). */
const TOOLBAR_CONTROLS = new Set(['toolbar-moved', 'pause-leaks', 'copy-no-source', 'clear-miscount', 'state-lost', 'more-missing', 'pause-commits', 'toolbar-timer']);
if (CONTROL !== '' && PERTURBATIONS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);
// SECTIONS=kept,memory runs only those sections (a draft run: the exit code says nothing of the others). A name that is no section is an error before a browser starts, and a section that ran in no engine (`memory`
// measures the heap in Chromium only, so SECTIONS=memory ENGINES=webkit ran nothing) fails the run: a draft that proved nothing does not pass.
const SECTION_NAMES = ['fills', 'sources', 'appears', 'hidden', 'kept', 'identity', 'a11y', 'memory', 'toolbar'];
const ONLY = (process.env.SECTIONS ?? '').split(',').filter(Boolean);
for (const name of ONLY) if (!SECTION_NAMES.includes(name)) throw new Error(`SECTIONS names ${name}, which is no section of this probe: ${SECTION_NAMES.join(', ')}`);
/** The sections that really ran, in at least one engine. */
const ran = new Set();
const wants = (section) => (CONTROL === '' ? ONLY.length === 0 || ONLY.includes(section) : PERTURBATIONS[CONTROL].sections.includes(section));
const engineNames = (process.env.ENGINES ?? (CONTROL === '' ? Object.keys(ENGINES).join(',') : 'chromium')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? (CONTROL === '' ? Object.keys(NATIVE_VIEWPORTS).join(',') : '1440x900')).split(',');
const failures = [];
const report = { fills: {}, shift: {}, keep: {}, listeners: {}, sources: {}, appears: {}, hidden: {}, kept: {}, identity: {}, a11y: {}, memory: {}, toolbar: {}, notes: [] };
// ASSERTION_OFF=<regex> drops the failures whose line matches, as if the assertion that says them were not there: a negative control is shown to depend on its assertion by running it with that assertion's source
// (printed with the control's result) here, and it must then be NOT DETECTED with no other failure (rule 28: the same fault passes undetected when the assertion is removed).
const OFF = process.env.ASSERTION_OFF === undefined || process.env.ASSERTION_OFF === '' ? undefined : new RegExp(process.env.ASSERTION_OFF);
// ASSERTION_OFF is for a negative control and for the one assertion that control is named for: with no control, or with a pattern that is not the control's own, it would silence a run that really fails.
if (OFF !== undefined && (CONTROL === '' || OFF.source !== PERTURBATIONS[CONTROL].expected.source)) throw new Error(`ASSERTION_OFF must be the pattern of the active negative control's own assertion (NEGATIVE_CONTROL=${CONTROL === '' ? '<none>' : CONTROL}${CONTROL === '' ? '' : `, its pattern is ${PERTURBATIONS[CONTROL].expected.source}`})`);
const fail = (where, what) => {
  const line = `${where}: ${what}`;
  if (OFF === undefined || !OFF.test(line)) failures.push(line);
};
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

/** Waits for a condition in the page. False when it did not come in time: the check that follows says what is wrong, where a timeout's stack would not. */
const until = (page, condition, arg, timeout = 10000) => page.waitForFunction(condition, arg, { timeout }).then(() => true, () => false);

/**
 * The oldest line the view of a session shows, read in the page: its list scrolled to the top and the first row read two frames later, by its number and its text. `perturb` is a control's one change, made right before the row is
 * read: `number` (the control `kept-lines`: the row's number is not the one the page drew, and stays so) or `text` (the control `over-lines`: the row says another line, and says its own words again right after the read).
 */
const READ_OLDEST = ({ id, perturb }) => new Promise((resolve) => {
  const grid = document.querySelector(`[data-log-session="${id}"] [role=grid]`);
  grid.scrollTop = 0;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const row = grid.querySelector('[role=row][data-n]');
      if (row !== null && perturb === 'number') row.setAttribute('data-n', `${row.getAttribute('data-n')}0`);
      const cell = row !== null && perturb === 'text' ? row.querySelector('[role=gridcell]:last-child') : null;
      const words = cell === null ? [] : [...cell.childNodes];
      if (cell !== null) cell.replaceChildren('another line');
      const line = row === null ? null : { n: row.getAttribute('data-n'), text: row.textContent.replace(/\s+/g, ' ').trim() };
      if (cell !== null) cell.replaceChildren(...words);
      resolve(line);
    });
  });
});

/**
 * The oldest line a session's view shows, read by its number and its text (A21's `kept`, A22's `identity`): the session's tab is chosen by its id and the line is read once the view is drawn. A count of rows would pass for a view that
 * never had a line, or lost its lines and gained as many. `null` when the tab could not be chosen or no row was drawn in time: what that means is the caller's check, with a message of its own.
 */
async function oldestLine(page, id, perturb) {
  const chosen = await page.locator(`[data-shell-part="sessionTab"][data-tab-id="${id}"] [role=tab]`).click({ timeout: 15000 }).then(() => true, () => false);
  const drawn = chosen && (await until(page, (one) => {
    const grid = document.querySelector(`[data-log-session="${one}"] [role=grid]`);
    return grid !== null && grid.getClientRects().length > 0 && grid.querySelector('[role=row][data-n]') !== null;
  }, id, 15000));
  if (!drawn) return null;
  const line = await page.evaluate(READ_OLDEST, { id, perturb });
  // The click gave the tab the focus: it is taken off, so that the card the check opens later is the one a pointer alone opens, as when no tab was chosen first.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  return line;
}

async function fills(browser, engine, viewportName, viewport, origin) {
  const where = `fills ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, url(origin), viewport);
  await ready(page);
  await page.evaluate(() => { window.__logs.open(0); });
  await page.waitForSelector('[data-log-session] [role=grid]');
  await sleep(500);
  const body = await page.evaluate(`${rect('[data-shell-part="panelBody"]:not([hidden])')}`);
  const view = await page.evaluate(`${rect('[data-log-session]')}`);
  const column = await page.evaluate(`${rect('[data-shell-part="panelBody"]:not([hidden]) [data-shell-part="logsTools"]')}`);
  report.fills[`${engine} ${viewportName}`] = { body, column, view };
  // The body is the toolbar's column (the mock's 40 px, `.panel__tools`) and the log view beside it, which fills the rest (P1b-4a): the two together are the body's rectangle.
  if (body === null || view === null || column === null) fail(where, `the log view is ${JSON.stringify(view)}, the toolbar's column ${JSON.stringify(column)}, the panel's body ${JSON.stringify(body)}`);
  else {
    const joined = [column[0], column[1], column[2] + view[2], column[3]];
    if (body.some((value, index) => Math.abs(value - joined[index]) > 1) || Math.abs(view[0] - (column[0] + column[2])) > 1 || Math.abs(view[1] - column[1]) > 1 || Math.abs(view[3] - column[3]) > 1) fail(where, `the toolbar's column ${JSON.stringify(column)} and the log view ${JSON.stringify(view)} are not the panel's body ${JSON.stringify(body)}`);
  }
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
  // The oldest line a session's view shows, read by its number and its text (`oldestLine`). `change` is the one perturbation of the control `kept-lines`: the number of the row is not the one the page drew.
  const firstLine = (name, change = false) => oldestLine(page, ids[name], change ? 'number' : undefined);
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
  same(await tabs(), ['orders-api/app, ended', 'orders-api/migrate, ended', 'orders-api/sync, failed'], 'the tabs after the unload');
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
    // A view that drew no line (or whose tab could not be chosen) is a failure of its own, with a message the control `kept-lines` does not look for: it changes the number of a row, and a page with no row has none to change.
    // The lines are compared when there are two of them.
    if (line === null) fail(where, `the view of ${name} drew no line after the unload (or its tab could not be chosen): it lost the lines it had`);
    else if (linesBefore[name] !== null && JSON.stringify(line) !== JSON.stringify(linesBefore[name])) fail(where, `the oldest line of ${name} was ${JSON.stringify(linesBefore[name])} and is ${JSON.stringify(line)}: the lines its view had are not the ones it has`);
  }

  await page.mouse.move(1, 1);
  await sleep(300);
  const rowsOff = await rows(ids.app);
  await sleep(800);
  if ((await rows(ids.app)) !== rowsOff) fail(where, 'the lines of the session the unload ended went on growing');
  same(await counters(page), { opened: 3, closed: 3, listeners: 2 }, 'after the unload: each stream closed once, the registry let go of all three, the view on screen keeps its two');
  const calls = () => page.evaluate(() => [...window.__fixtureLogs.closeCalls]);
  // The negative control `close-twice`: the count of the calls to the first feed's close is one more, as if the registry had closed it twice; it is put back right after the check. It means something only on a page whose calls are what an
  // unperturbed probe sees, one each: they are read before the raise, and any other baseline is a failure of its own (a message this control's line does not match), the control is not made and the run is no detection.
  const baseCalls = CONTROL === 'close-twice' ? await calls() : undefined;
  const twice = CONTROL === 'close-twice' && JSON.stringify(baseCalls) === '[1,1,1]';
  if (CONTROL === 'close-twice' && !twice) fail(where, `close-twice: the baseline is ${JSON.stringify(baseCalls)} calls to close, wanted [1,1,1] before the control raises the first`);
  if (twice) await page.evaluate(() => { window.__fixtureLogs.closeCalls[0] += 1; });
  if (CONTROL !== 'close-twice' || twice) same(await calls(), [1, 1, 1], 'after the unload: close was asked of each feed once (the calls are counted, repeats too; `closed` counts a feed once)');
  if (twice) await page.evaluate(() => { window.__fixtureLogs.closeCalls[0] -= 1; });
  const cardOf = async (name) => {
    await page.mouse.move(1, 1);
    await sleep(500);
    const box = await page.locator(`[data-shell-part="sessionTab"][data-tab-id="${ids[name]}"] [role=tab]`).boundingBox();
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
  same(await tabs(), ['orders-api/app, ended', 'orders-api/migrate, ended', 'orders-api/sync, failed', 'orders-api/app (2)'], 'the tabs after a new press');
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
// A22: a Logs session is its plugin and its target (P1b-3d), in a real engine on the host fixture, with the fixture's `app` (0), `migrate` (1, ends 1.5 s after it opens), `sync` (2, fails 1.5 s after it opens) and the twin of `app` (6: its
// title, the south yard as its scope). A press of a command whose session is starting or running SHOWS that session (the panel opens, the Logs tool is on screen, the session is its tab, no focus moves) and starts no second stream; a press of
// one whose session has ended or failed opens a NEW session beside it and the old one stays readable until its tab closes; a tab draws its scope only beside a twin. One window, in this order:
//   a  `app` pressed twice: one session, one tab named `orders-api/app` that draws no scope part, one stream (the registry's listener and the view's two), the second press answering the session of the first
//   b  the panel hidden, and then another tool on screen, `app` pressed again: the panel is open, Logs is on screen, the tab is selected, still one stream, and the focus (on the status bar's panel toggle) is the element it was
//   c  the twin of `app`: two sessions, two tabs named `orders-api/app · north-yard` and `orders-api/app · south-yard` that each draw their scope, two streams; the twin and `app` pressed again change nothing; the twin's tab closed (Delete),
//      the tab left is named `orders-api/app` and draws no scope part
//   d  `migrate` pressed again once it has ended: a NEW session, the two tabs named apart (`orders-api/migrate, ended` and `orders-api/migrate (2)`), a new stream, the stream of the ended session not closed, its view still holding its rows
//      and, under its tab chosen again by its id, showing its oldest line (number and text) as it was; a third press shows the live one, however late the page is (the new stream is held live, then ended by the probe)
//   e  `sync` pressed again once it has failed: the same (`orders-api/sync, failed` and `orders-api/sync (2)`)
//   f  every tab closed with the keyboard: every stream closed once, no listener left, no page error
// A session that ends on its own ends 1.5 s after it opens, so what a press of one makes is read in the page, two frames after the press, in the same task (a read from here is a round trip later, which a loaded machine can stretch). The
// session that is over comes to its state by itself, as the checks above need; the stream a second press opens does not (the fixture's `hold`, set around that press only), so that no delay of the page can end it before the third press,
// which a correct registry answers with another session; the probe ends it itself (`endHeld`) when its checks are done.

/**
 * What the strip, the panel and the plugin's counters say at one instant, read in one task so that nothing moves between the numbers: the panel (open, the tool and the session on screen, the toggle's pressed state, the Logs tool tab's
 * selected state, how many sessions it holds), each session tab in the strip's order (its id, its accessible name, the scope parts it holds, the state its lead says, whether it is the selected one and whether its body is on screen),
 * the counters of the fixture's feeds and, of each session, the rows its view holds (-1: it has no view).
 */
const READ_STRIP = () => {
  const state = window.__panel.getSnapshot();
  const shown = window.__panel.selectors.shown(state);
  return {
    open: state.open,
    shown: shown === null ? null : { tool: shown.tool, session: shown.session },
    sessions: Object.keys(state.sessions).length,
    toggle: document.querySelector('[data-shell-part="panelToggle"]')?.getAttribute('aria-pressed') ?? null,
    toolTab: document.querySelector('[data-shell-part="panelTools"] [role=tab][data-tab-id="logs"]')?.getAttribute('aria-selected') ?? null,
    tabs: [...document.querySelectorAll('[data-shell-part="sessionTab"]')].map((one) => {
      const id = one.getAttribute('data-tab-id');
      const tab = one.querySelector('[role=tab]');
      return {
        id,
        name: tab.getAttribute('aria-label'),
        scopes: [...one.querySelectorAll('[data-shell-part="sessionScope"]')].map((part) => part.textContent),
        lead: one.querySelector('[data-shell-part="sessionLead"]')?.getAttribute('data-state') ?? null,
        selected: tab.getAttribute('aria-selected') === 'true',
        onScreen: document.querySelector(`[data-shell-part="panelBody"][data-session-id="${id}"]`)?.hidden === false,
      };
    }),
    counters: { ...window.__fixtureLogs },
    rows: Object.fromEntries(Object.keys(state.sessions).map((id) => [id, Number(document.querySelector(`[data-log-session="${id}"] [role=grid]`)?.getAttribute('aria-rowcount') ?? -1)])),
  };
};

/** What a press is read with, put into the page once: two frames (the registry changes the panel at once and React draws at the next frame) and the read above. */
const INSTALL = `(() => { window.__frames = () => new Promise((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); }); window.__strip = ${READ_STRIP}; })()`;

/** A press of the fixture's command for the target `index`, and the strip two frames later in the same task: a session that ends on its own ends 1.5 s after it opens, and its tab is read before then. */
const PRESS = async (index) => {
  const id = window.__logs.open(index);
  await window.__frames();
  return { id, strip: window.__strip() };
};

/** The same, with the focus: which part of the page had it at the press, and whether the element that had it still does two frames after. */
const PRESS_FOCUSED = async (index) => {
  const held = document.activeElement;
  const id = window.__logs.open(index);
  await window.__frames();
  return { id, focused: held?.getAttribute('data-shell-part') ?? null, kept: document.activeElement === held, strip: window.__strip() };
};

/**
 * The second and the third press of a target whose session is over (`was`), in one task: `before` is what the page said at the press (the rows its view holds, the counters), `after` what it said two frames later, with the new session
 * on the strip, and `again` the same after a third press, which must show the live session. The stream the second press opens is HELD live (the fixture's `hold`): `migrate` and `sync` end or fail by themselves 1.5 s after they open,
 * and a page whose frames are late could end the new one before the third press, which a correct registry answers with another session; the probe ends it itself (`endHeld`) when its checks are done. `change` is the page's one
 * perturbation here, the control `same-name`: the tab of the new session has the over one's name while `after` is read and its own name right after; `changed` says it was made (a page with no tab of the new session, or one whose
 * press showed the session that is over, has no two tabs to give one name).
 */
const PRESS_OVER = async ({ index, was, change }) => {
  const before = window.__strip();
  window.__fixtureLogs.hold(true);
  let second;
  try {
    second = window.__logs.open(index);
  } finally {
    window.__fixtureLogs.hold(false);
  }

  await window.__frames();
  let undo;
  if (change === 'same-name') {
    const tabOf = (id) => document.querySelector(`[data-shell-part="sessionTab"][data-tab-id="${id}"] [role=tab]`);
    const fresh = tabOf(second);
    const ended = tabOf(was);
    if (fresh !== null && ended !== null && fresh !== ended) {
      const own = fresh.getAttribute('aria-label');
      fresh.setAttribute('aria-label', ended.getAttribute('aria-label'));
      undo = () => {
        fresh.setAttribute('aria-label', own);
      };
    }
  }

  const after = window.__strip();
  if (undo !== undefined) undo();
  const third = window.__logs.open(index);
  await window.__frames();
  return { before, second, after, third, again: window.__strip(), changed: undo !== undefined };
};

async function identity(browser, engine, viewportName, viewport, origin) {
  const where = `identity ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, url(origin), viewport);
  await ready(page);
  await page.evaluate(INSTALL);
  const same = (got, wanted, label) => {
    if (JSON.stringify(got) !== JSON.stringify(wanted)) fail(where, `${label}: ${JSON.stringify(got)}, wanted ${JSON.stringify(wanted)}`);
  };
  const names = (strip) => strip.tabs.map((tab) => tab.name);
  const scopes = (strip) => strip.tabs.map((tab) => tab.scopes);
  const fed = (strip) => ({ opened: strip.counters.opened, closed: strip.counters.closed });
  const selected = (strip) => strip.tabs.find((tab) => tab.selected)?.id ?? null;

  // a: `app` pressed twice is one session, with one tab that draws no scope, and one stream.
  const one = await page.evaluate(PRESS, 0);
  const two = await page.evaluate(PRESS, 0);
  same(await until(page, () => document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [data-log-session] [role=grid]') !== null), true, 'pressed twice: the view of the session was drawn');
  await sleep(300);
  same(typeof one.id, 'string', 'pressed: the press answered a session');
  same(two.id, one.id, 'pressed twice: the second press answered the session of the first');
  // The control `lone-scope`: a scope part is put into the label of the tab of the session, found by its id. Its name is an attribute and stays, so only the check of its scope parts can see it. It is taken out right after the read.
  const scoped = CONTROL !== 'lone-scope' || (await page.evaluate((id) => {
    const label = document.querySelector(`[data-shell-part="sessionTab"][data-tab-id="${id}"] [data-shell-part="sessionLabel"]`);
    if (label === null) return false;
    label.insertAdjacentHTML('beforeend', '<span data-shell-part="sessionScope">north-yard</span>');
    window.__control = label.lastElementChild;
    return true;
  }, one.id));
  const lone = await page.evaluate(READ_STRIP);
  if (CONTROL === 'lone-scope') await page.evaluate(() => { window.__control?.remove(); });
  if (!scoped) fail(where, 'the control lone-scope found no tab of the session to put a scope part into: it was not made');
  same(lone.sessions, 1, 'pressed twice: one session in the panel');
  // A strip that has no tab of the session, or another besides it, fails a check of its own; a scope part is looked for in the tab of the session, and a tab that is not there draws none.
  same(lone.tabs.map((tab) => tab.id), [one.id], 'pressed twice: the strip holds the tab of the session and no other');
  same(names(lone), ['orders-api/app'], 'pressed twice: one tab, named');
  const loneTab = lone.tabs.find((tab) => tab.id === one.id);
  if (loneTab !== undefined) same(loneTab.scopes, [], 'pressed twice: the lone tab draws no scope part');
  // The control `second-stream`: one more stream is counted opened, as if the second press had started one. It is taken back right after the read. It means something only on a page that opened ONE stream, as an unperturbed probe sees:
  // the count is read before the raise, and any other baseline is a failure of its own (a message this control's line does not match), the control is not made and the run is no detection (a probe that was already failing).
  const baseline = await counters(page);
  const raised = CONTROL === 'second-stream' && baseline.opened === 1 && (await page.evaluate(() => { window.__fixtureLogs.opened += 1; return true; }));
  if (CONTROL === 'second-stream' && !raised) fail(where, `second-stream: the baseline is ${String(baseline.opened)} streams opened, wanted 1 before the control raises it`);
  const streams = raised ? await counters(page) : baseline;
  if (raised) await page.evaluate(() => { window.__fixtureLogs.opened -= 1; });
  // A page that opened no stream fails a check of its own; how many were opened is checked on a page no control touched, or on the one the control raised (a page the control could not be made on has failed above).
  same(streams.opened > 0, true, 'pressed twice: a stream was opened');
  if (streams.opened > 0 && (CONTROL !== 'second-stream' || raised)) same(streams.opened, 1, 'pressed twice: one stream was opened');
  same([streams.closed, streams.listeners], [0, 3], 'pressed twice: none closed, and the stream is listened to by the registry (1) and the view (2)');

  // b: with the panel hidden, and then with another tool on screen, the press shows the session again; the page's focus (the status bar's panel toggle) stays where it was.
  const toggle = page.locator('[data-shell-part="panelToggle"]');
  const shownOf = (strip, id) => {
    const tab = strip.tabs.find((one) => one.id === id);
    return { open: strip.open, toggle: strip.toggle, tool: strip.shown?.tool ?? null, session: strip.shown?.session === id, toolTab: strip.toolTab, tabSelected: tab?.selected ?? null, onScreen: tab?.onScreen ?? null };
  };
  for (const [what, prepare, tool] of [
    ['panel hidden', () => window.__panel.hide(), null],
    ['another tool on screen', () => window.__panel.show({ tool: 'alpha:streams' }), 'alpha:streams'],
  ]) {
    await page.evaluate(prepare);
    await toggle.focus();
    const was = await page.evaluate(READ_STRIP);
    same(was.shown?.tool ?? null, tool, `${what}: the page is as the press needs it`);
    const pressed = await page.evaluate(PRESS_FOCUSED, 0);
    same(pressed.focused, 'panelToggle', `${what}: the probe put the focus on the status bar's panel toggle before the press`);
    same(pressed.id, one.id, `${what}, pressed again: the press answered the session`);
    same(shownOf(pressed.strip, one.id), { open: true, toggle: 'true', tool: 'logs', session: true, toolTab: 'true', tabSelected: true, onScreen: true }, `${what}, pressed again: the panel is open on the Logs tool, with the session as its tab`);
    same(fed(pressed.strip), { opened: 1, closed: 0 }, `${what}, pressed again: still one stream`);
    same(pressed.kept, true, `${what}, pressed again: the page's focus did not move`);
  }

  // c: the twin of `app` (its title, the south yard as its scope): two sessions, and each tab draws its scope; pressed again, nothing changes; when the twin's tab closes the tab left draws no scope.
  const twin = await page.evaluate(PRESS, 6);
  const south = twin.id;
  same(south === one.id, false, 'twin pressed: a second session');
  same(twin.strip.sessions, 2, 'twin pressed: two sessions in the panel');
  same(names(twin.strip), ['orders-api/app · north-yard', 'orders-api/app · south-yard'], 'twin pressed: two tabs of one title, told apart by the scope each draws (their names)');
  same(scopes(twin.strip), [['north-yard'], ['south-yard']], 'twin pressed: each tab draws one scope part, saying its scope');
  same(fed(twin.strip), { opened: 2, closed: 0 }, 'twin pressed: two streams');
  const south2 = await page.evaluate(PRESS, 6);
  const north2 = await page.evaluate(PRESS, 0);
  same([south2.id, north2.id], [south, one.id], 'twin and app pressed again: each press answered its own session');
  same([south2.strip.sessions, north2.strip.sessions], [2, 2], 'twin and app pressed again: still two sessions');
  same([fed(south2.strip), fed(north2.strip)], [{ opened: 2, closed: 0 }, { opened: 2, closed: 0 }], 'twin and app pressed again: still two streams');
  same(names(north2.strip), ['orders-api/app · north-yard', 'orders-api/app · south-yard'], 'twin and app pressed again: the two tabs as they were');
  same([selected(south2.strip), selected(north2.strip)], [south, one.id], 'twin and app pressed again: each press selected its own tab');
  await page.locator(`[data-shell-part="sessionTab"][data-tab-id="${south}"] [role=tab]`).focus();
  await page.keyboard.press('Delete');
  await until(page, () => document.querySelectorAll('[data-shell-part="sessionTab"]').length === 1);
  const left = await page.evaluate(READ_STRIP);
  same(left.tabs.map((tab) => tab.id), [one.id], 'twin closed: the strip holds the tab of app and no other');
  same(names(left), ['orders-api/app'], 'twin closed: the tab that is left, named');
  const leftTab = left.tabs.find((tab) => tab.id === one.id);
  if (leftTab !== undefined) same(leftTab.scopes, [], 'twin closed: the tab that is left draws no scope part');
  same(fed(left), { opened: 2, closed: 1 }, 'twin closed: its stream closed, the other still open');

  // d, e: a target whose session is over (`migrate` ended, `sync` failed), pressed again: a NEW session beside it, named apart; the stream of the one that is over stays as it was (not closed) and its view keeps its rows and the lines
  // they say: its oldest line is read by its number and its text before the press, and again after it under the same tab, chosen by its id (a view whose 30 lines were replaced by 30 others has the same count of rows). The new
  // session's stream is held live through the third press (`PRESS_OVER`) and ended here, when the checks are done.
  const over = async (index, source, state, change) => {
    const title = `orders-api/${source}`;
    const kind = state === 'ended' ? 'an ended session' : 'a failed session';
    const was = (await page.evaluate(PRESS, index)).id;
    // The session is over and its view holds its lines before the press: a view that drew nothing would keep "at least its rows" and prove nothing.
    const done = await until(page, ({ id, to }) => window.__panel.getSnapshot().sessions[id]?.state === to && Number(document.querySelector(`[data-log-session="${id}"] [role=grid]`)?.getAttribute('aria-rowcount') ?? 0) >= 25, { id: was, to: state });
    same(done, true, `${title} came to ${state} with its lines in time: the checks of ${kind} pressed again need it`);
    const lineBefore = await oldestLine(page, was);
    await page.mouse.move(1, 1);
    if (lineBefore === null) fail(where, `${kind}: its view drew no line before the press (or its tab could not be chosen): the check of its lines proves nothing`);
    const pressed = await page.evaluate(PRESS_OVER, { index, was, change });
    if (change === 'same-name' && !pressed.changed) fail(where, 'the control same-name found no two tabs to give one name (the tab of the new session and the one that is over): it was not made');
    const mine = pressed.after.tabs.filter((tab) => tab.name.startsWith(title));
    same(pressed.second === was, false, `${kind} pressed again: a new session, not the one that is over`);
    same(mine.map((tab) => tab.name), [`${title}, ${state}`, `${title} (2)`], `${kind} pressed again: the two tabs, named`);
    same(names(pressed.after).filter((name, at, all) => all.indexOf(name) !== at), [], `${kind} pressed again: no two tabs share a name`);
    same(pressed.after.tabs.find((tab) => tab.id === was)?.lead, state, `${kind} pressed again: the lead of the tab of the one that is over says ${state}`);
    same(pressed.after.counters.opened - pressed.before.counters.opened, 1, `${kind} pressed again: one new stream`);
    same(pressed.after.counters.closed - pressed.before.counters.closed, 0, `${kind} pressed again: the stream of the one that is over was not closed`);
    same(pressed.after.rows[was] >= pressed.before.rows[was], true, `${kind} pressed again: its view still holds the rows it had (${String(pressed.before.rows[was])} rows, then ${String(pressed.after.rows[was])})`);
    same([pressed.third, selected(pressed.again), pressed.again.counters.opened], [pressed.second, pressed.second, pressed.after.counters.opened], `${kind}, a third press: the live session is shown and no stream is opened`);
    // The lines the old view shows: its oldest again, by its number and its text, under the old tab, which is chosen by its id. The control `over-lines` makes the row say another line while it is read. A view that drew no line is a
    // failure of its own, and the line is compared when there are two of them.
    const lineAfter = await oldestLine(page, was, change === 'over-lines' ? 'text' : undefined);
    await page.mouse.move(1, 1);
    if (lineAfter === null) fail(where, `${kind} pressed again: its view drew no line when its tab was chosen again (or its tab could not be chosen): it lost the lines it had`);
    else if (lineBefore !== null) same(lineAfter, lineBefore, `${kind} pressed again: its view still shows line ${lineBefore.n} as it was`);
    // The new session's stream was held live through the third press: it comes to its state now, by the fixture's own transition, as the one that is over came to its own.
    await page.evaluate(() => { window.__fixtureLogs.endHeld(); });
    return mine.map((tab) => tab.name);
  };
  const ended = await over(1, 'migrate', 'ended', CONTROL === 'same-name' || CONTROL === 'over-lines' ? CONTROL : undefined);
  const failed = await over(2, 'sync', 'failed', undefined);

  // f: every tab closed with the keyboard: every stream closed once (the calls to `close` are counted, repeats too), no listener left, no page error.
  for (let round = 0; round < 12; round += 1) {
    const count = await page.locator('[data-shell-part="sessionTab"] [role=tab]').count();
    if (count === 0) break;
    await page.locator('[data-shell-part="sessionTab"] [role=tab]').first().focus();
    await page.keyboard.press('Delete');
    await until(page, (before) => document.querySelectorAll('[data-shell-part="sessionTab"]').length < before, count);
  }

  await page.getByText('No log sessions').waitFor({ timeout: 10000 });
  await sleep(300);
  const last = await counters(page);
  const calls = await page.evaluate(() => [...window.__fixtureLogs.closeCalls]);
  same(last.opened, 6, 'every tab closed: six streams were opened in all (app, its twin, migrate twice, sync twice)');
  same([last.closed === last.opened, last.listeners], [true, 0], `every tab closed: every stream was closed (${String(last.closed)} of ${String(last.opened)}) and no listener is left`);
  same(calls, Array.from({ length: last.opened }, () => 1), 'every tab closed: close was asked of each feed once');
  report.identity[`${engine} ${viewportName}`] = { lone: names(lone), twins: names(twin.strip), left: names(left), ended, failed, opened: last.opened, closeCalls: calls };
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
// A22, the finding of P1b-3c: axe-core on the real host fixture with the Logs tool open (the real log view under the strip) in three states: one session; two sessions of one title in two scopes, each tab drawing its scope (its name must
// hold the words the tab draws: `label-content-name-mismatch`); and an ended session beside the new one its press opened. A serious or critical finding fails; a moderate one is a note (`region`: the shell's page has no landmark,
// which the panel probe's cases carry too). The control `axe-name` makes the name of each tab that draws a scope its title only, just before axe runs, and puts the names back right after.
async function a11y(browser, engine, viewportName, viewport, origin, axe) {
  const where = `a11y ${engine} ${viewportName}`;
  const cases = [
    {
      label: 'the Logs tool, open, one session (no scope drawn)',
      prepare: async (page) => {
        await page.evaluate(() => { window.__logs.open(0); });
      },
    },
    {
      label: 'the Logs tool, open, two sessions of one title in two scopes (each tab draws its scope)',
      scoped: true,
      prepare: async (page) => {
        await page.evaluate(() => { window.__logs.open(0); window.__logs.open(6); });
        await page.waitForFunction(() => document.querySelectorAll('[data-shell-part="sessionScope"]').length === 2, null, { timeout: 10000 });
      },
    },
    {
      // P1b-4a: the toolbar's buttons that cannot apply (Clear and Copy with no line: aria-disabled and a description) and the toggles in both states, over a session that makes no line.
      label: 'the Logs tool, open, a session with no line (Clear and Copy unavailable with their reasons)',
      prepare: async (page) => {
        await page.evaluate(() => { window.__logs.open(7); });
      },
    },
    {
      label: 'the Logs tool, open, the ended session of migrate beside the new one its press opened',
      prepare: async (page) => {
        const was = await page.evaluate(() => window.__logs.open(1));
        await page.waitForFunction((id) => window.__panel.getSnapshot().sessions[id]?.state === 'ended', was, { timeout: 15000 });
        await page.evaluate(() => { window.__logs.open(1); });
        await page.waitForFunction(() => document.querySelectorAll('[data-shell-part="sessionTab"]').length === 2, null, { timeout: 10000 });
      },
    },
  ];
  for (const { label, scoped = false, prepare } of cases) {
    const { page, context, errors } = await open(browser, url(origin), viewport);
    await ready(page);
    await prepare(page);
    // The real log view is under the strip: the check does not start before it is drawn.
    await page.waitForSelector('[data-shell-part="panelBody"]:not([hidden]) [data-log-session] [role=grid]');
    await sleep(500);
    await page.addScriptTag({ content: axe });
    if (CONTROL === 'axe-name' && scoped) {
      await page.evaluate(() => {
        window.__names = [];
        for (const tab of document.querySelectorAll('[data-shell-part="sessionTab"] [role=tab]')) {
          if (tab.querySelector('[data-shell-part="sessionScope"]') === null) continue;
          window.__names.push([tab, tab.getAttribute('aria-label')]);
          tab.setAttribute('aria-label', window.__panel.getSnapshot().sessions[tab.getAttribute('data-tab-id')].title);
        }
      });
    }

    const result = await page.evaluate(() => axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, first: v.nodes[0]?.html.slice(0, 140) }))));
    if (CONTROL === 'axe-name' && scoped) await page.evaluate(() => { for (const [tab, name] of window.__names) tab.setAttribute('aria-label', name); });
    report.a11y[`${engine} ${viewportName} ${label}`] = result;
    for (const violation of result) {
      const text = `${violation.id} (${violation.impact}, ${String(violation.nodes)}): ${violation.first}`;
      if (violation.impact === 'serious' || violation.impact === 'critical') fail(where, `${label}: ${text}`);
      else report.notes.push(`${where} ${label}: ${text}`);
    }

    for (const error of errors) fail(`errors ${where}`, error);
    await context.close();
  }
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
  // The clipboard is the toolbar section's spy here too: the press of Copy that arms the confirmation's clock below writes tens of thousands of lines, which the page must not hand to the real clipboard.
  const { page, context, errors } = await open(browser, url(origin), viewport, { init: `${COUNT};${COPY_SPY}` });
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
  // P1b-4a: the toolbar's one control that touches the stream is Pause, and at 10,000 lines a second a press costs ONE commit, and so does the press that lets the stream go: the toolbar and the view's strip read the stream's
  // status together. The commits are counted from the press to the microtask after it, in which React flushes the update (a frame of the stream's cannot fall in between: a frame is a task of its own).
  const pauseCost = await page.evaluate(async (perturb) => {
    const button = () => document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [data-log-tool="pause"]');
    const count = () => window.__commits.length;
    // A programmatic click is flushed in the microtask after it (a frame of the stream's cannot fall in between): one press, one microtask, and the commits since.
    const before = count();
    button().click();
    await Promise.resolve();
    if (perturb) window.__commits.push({ phase: 'update', actualDuration: 0 });
    const held = count() - before;
    const lifting = count();
    button().click();
    await Promise.resolve();
    return { held, lifted: count() - lifting, paused: button().getAttribute('aria-pressed') };
  }, CONTROL === 'pause-commits');
  report.toolbar[`${engine} ${viewportName}`] = { ...report.toolbar[`${engine} ${viewportName}`], pauseCommits: pauseCost };
  if (pauseCost.held !== 1 || pauseCost.lifted !== 1 || pauseCost.paused !== 'false') fail(where, `toggling Pause at ${String(RATE)} lines a second cost ${String(pauseCost.held)} commits to hold and ${String(pauseCost.lifted)} to let go (pressed ${String(pauseCost.paused)} at the end), wanted one each`);
  // A copy arms the Copy button's two seconds of confirmation: the timer must not outlive the view's being on screen (the zero windows below see a toolbar that keeps it: the glyph would change inside them).
  await page.evaluate(COPY_SPY);
  await page.locator('[data-shell-part="panelBody"]:not([hidden]) [data-log-tool="copy"]').click();
  await sleep(250);
  // The copy must have happened and armed the confirmation (the check glyph): else the closed window below would see no timer to cancel, and `toolbar-timer` would be detected by its own mutation alone.
  const armed = await page.evaluate(() => ({ writes: window.__copied.length, glyph: document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [data-log-tool="copy"] [data-ov-glyph]')?.getAttribute('data-ov-glyph') ?? null }));
  if (armed.writes !== 1 || armed.glyph !== 'check') fail(where, `Copy did not arm its confirmation before the panel was closed (${String(armed.writes)} clipboard writes, the button draws ${String(armed.glyph)}): the closed window would see no timer to cancel`);
  // The panel closed: nothing is drawn, nothing is asked for, and the feed goes on.
  await page.evaluate(() => window.__panel.hide());
  await sleep(500);
  // The negative control `toolbar-timer`: a toolbar that kept its confirmation's clock while it is hidden changes its glyph inside the closed window.
  if (CONTROL === 'toolbar-timer') await page.evaluate(() => { setTimeout(() => document.querySelector('[data-log-tool="copy"]')?.setAttribute('data-leak', '1'), 1200); });
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


// ---------------------------------------------------------------------------------------------------------------------------
// P1b-4a: the toolbar of a Logs session (Follow, Pause log updates, Show timestamps in UTC, Clear, Copy), in a real engine, on the host fixture. What it checks, per engine and viewport (everything but the waits, which run
// at 1440 x 900 only):
//   geometry   the toolbar's column and its buttons against the mock's own (`mock-logs-toolbar.json`, measured from the mock's Logs tool by mock-logs-toolbar-measure.mjs): the column's rectangle in the body, the first button, the
//              pitch, the size, and the log view's rectangle (the body less the column), each within 1 px
//   words      every button's name, glyph, state (`aria-pressed`) and tooltip; Clear and Copy of a session that has no line (the fixture's `quiet`) are unavailable, focusable, with the reason as their description and as
//              the second line of their tooltip, and do nothing when pressed; a real pointer on a button shows its tooltip
//   keys       real key presses: the Tab from the panel's Hide button lands on Follow, the toolbar is ONE stop, the next Tab leaves it for the find field, ArrowDown and ArrowUp move through it and stop at its ends,
//              Home and End go to them, Enter and Space press
//   stream     Pause holds the stream, the lines keep arriving and are counted (the strip's `Paused, N new lines waiting` is N lines the stream holds: the fixture's own count) and not drawn, and a press again draws them; Follow
//              off and on; Clear forgets everything made so far (the stream's unread lines too) and every line made after it is shown, exactly (made since = shown); Copy writes every line the list draws with
//              its source label (a selection does not narrow it: the keyboard's copy is the selection's), only the lines a level filter lets through, and confirms itself for two seconds (and says how many in the polite region); UTC changes the rows' clock to its
//              Z form and the copy with it
//   session    what a session chose (UTC, a pause, Follow off) is its own and survives another tool being shown and another session being chosen
//   short      a panel too short for every button (120 px, its least, and 200 px): the first buttons stay and the last stand behind a `⋯` More actions button that takes the last slot (the mock's rule and its geometry), the column
//              does not scroll, the kit's menu lists what is behind it in the column's order and presses it (Pause becomes Resume), and the keys of the toolbar are the same with the More button last
// The controls of this section perturb one thing in the page right before the check they are named for (see PERTURBATIONS).
const COPY_SPY = `(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copied.push(text); } } }); })();`;

/** What the toolbar and its view say, read in one task: the strip, the rows, every button's face and state, the polite region. */
const READ_TOOLBAR = () => {
  const body = document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [data-shell-part="logsBody"]');
  const grid = body?.querySelector('[data-log-session] [role=grid]') ?? null;
  const tools = {};
  for (const button of body?.querySelectorAll('[aria-label="Logs tools"] button') ?? []) {
    const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    tools[button.getAttribute('data-log-tool')] = {
      name: button.getAttribute('aria-label'),
      pressed: button.getAttribute('aria-pressed'),
      disabled: button.getAttribute('aria-disabled'),
      tip: button.getAttribute('data-ov-tip'),
      glyph: button.querySelector('[data-ov-glyph]')?.getAttribute('data-ov-glyph') ?? null,
      reason: reason === null ? null : reason.textContent,
      tabindex: button.tabIndex,
    };
  }

  const clocks = [...(grid?.querySelectorAll('[role=row][data-n]') ?? [])].map((row) => row.querySelector('[data-ov-tip]')?.textContent ?? '');
  return {
    rows: Number(grid?.getAttribute('aria-rowcount') ?? 0) - 1,
    strip: body?.querySelector('[aria-label="Session status"]')?.textContent ?? '',
    said: body?.querySelector(':scope > [role=status]')?.textContent ?? '',
    clocks,
    timestamps: body?.querySelector('[data-ov-timestamps]')?.getAttribute('data-ov-timestamps') ?? '',
    tools,
  };
};

/** The mock's Logs toolbar, measured from the mock itself (mock-logs-toolbar-measure.mjs: both engines, both viewports): the column, the buttons, the glyphs and the paint. */
const MOCK_TOOLBAR = JSON.parse(readFileSync(new URL('./mock-logs-toolbar.json', import.meta.url), 'utf8'));
const near = (a, b, within = 1) => a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) <= within);
const PAINT_KEYS = ['backgroundColor', 'color', 'borderTopWidth', 'borderTopColor', 'borderTopLeftRadius'];

const TOOL_LABELS = { follow: 'Follow', pause: 'Pause log updates', timestamps: 'Show timestamps in UTC', clear: 'Clear', copy: 'Copy' };
const TOOL_GLYPHS = { follow: 'arrow-down-to-line', pause: 'pause', timestamps: 'globe', clear: 'eraser', copy: 'copy' };
const TOOL_ORDER = Object.keys(TOOL_LABELS);
const NO_LINES = 'There are no lines yet';
const tool = (id) => `[data-shell-part="panelBody"]:not([hidden]) [data-log-tool="${id}"]`;
const countIn = (text, pattern) => Number((pattern.exec(text)?.[1] ?? '-1').replace(/,/g, ''));

async function toolbar(browser, engine, viewportName, viewport, origin) {
  const where = `toolbar ${engine} ${viewportName}`;
  const waits = viewportName === '1440x900';
  const { page, context, errors } = await open(browser, url(origin), viewport, { init: COPY_SPY });
  await ready(page);
  const read = () => page.evaluate(READ_TOOLBAR);
  // `force`: Playwright counts `aria-disabled` as not enabled and would wait; the press of an unavailable button is what a check of its own makes.
  const press = (id, force = false) => page.locator(tool(id)).click({ force });
  const make = async (index) => {
    const id = await page.evaluate((one) => window.__logs.open(one), index);
    await page.waitForSelector('[data-shell-part="panelBody"]:not([hidden]) [data-log-session] [role=grid]');
    return id;
  };

  // --- the session that has no line: the words of every button, and what cannot apply says why ---
  await make(7);
  await sleep(400);
  const quiet = await read();
  report.toolbar[`${engine} ${viewportName}`] = { quiet: quiet.tools };
  if (JSON.stringify(Object.keys(quiet.tools)) !== JSON.stringify(TOOL_ORDER)) fail(where, `the buttons are ${JSON.stringify(Object.keys(quiet.tools))}, wanted ${JSON.stringify(TOOL_ORDER)}`);
  for (const id of TOOL_ORDER) {
    const one = quiet.tools[id];
    if (one === undefined) continue;
    if (one.name !== TOOL_LABELS[id]) fail(where, `words: the ${id} button is named "${String(one.name)}", wanted "${TOOL_LABELS[id]}"`);
    if (one.glyph !== TOOL_GLYPHS[id]) fail(where, `words: the ${id} button draws "${String(one.glyph)}", wanted "${TOOL_GLYPHS[id]}"`);
  }

  const want = { follow: 'true', pause: 'false', timestamps: 'false', clear: null, copy: null };
  for (const id of TOOL_ORDER) if (quiet.tools[id] !== undefined && quiet.tools[id].pressed !== want[id]) fail(where, `words: the ${id} button's aria-pressed is ${String(quiet.tools[id].pressed)}, wanted ${String(want[id])}`);
  for (const id of ['clear', 'copy']) {
    const one = quiet.tools[id];
    if (one === undefined) continue;
    if (one.disabled !== 'true' || one.reason !== NO_LINES || one.tip !== `${TOOL_LABELS[id]}\n${NO_LINES}`) fail(where, `words: with no line ${id} is ${JSON.stringify({ disabled: one.disabled, reason: one.reason, tip: one.tip })}, wanted unavailable with "${NO_LINES}" as its description and the second line of its tip`);
  }
  for (const id of ['follow', 'pause', 'timestamps']) if (quiet.tools[id]?.disabled !== null) fail(where, `words: ${id} is unavailable with no line (${String(quiet.tools[id]?.disabled)})`);
  // --- the geometry and the paint against the mock's own: the column and the view beside it in the body, each button's place against the column, the glyph in its button, and the paint of a pressed, a resting and an unavailable button ---
  const mock = MOCK_TOOLBAR.data[engine]?.[viewportName]?.rest;
  const mockStates = MOCK_TOOLBAR.data[engine]?.['1440x900']?.states;
  if (mock === undefined || mockStates === undefined) fail(where, `geometry: mock-logs-toolbar.json has no reference for ${engine} ${viewportName}`);
  else {
    const found = await page.evaluate(({ perturb, keys }) => {
      const rect = (el) => {
        const b = el.getBoundingClientRect();
        return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 100) / 100);
      };
      const body = document.querySelector('[data-shell-part="panelBody"]:not([hidden])');
      const column = body.querySelector('[data-shell-part="logsTools"]');
      // The negative control `toolbar-moved`: the column stands 3 px to the right while it is measured (its buttons are measured against it, so only the column's own check sees it); put back right after.
      if (perturb) {
        column.style.position = 'relative';
        column.style.left = '3px';
      }

      const result = {
        body: rect(body),
        column: rect(column),
        view: rect(body.querySelector('[data-log-session]')),
        buttons: [...column.querySelectorAll('button')].map((button) => {
          const style = getComputedStyle(button);
          return { id: button.getAttribute('data-log-tool'), box: rect(button), svg: rect(button.querySelector('svg')), paint: Object.fromEntries(keys.map((key) => [key, style[key]])) };
        }),
      };
      if (perturb) {
        column.style.position = '';
        column.style.left = '';
      }

      return result;
    }, { perturb: CONTROL === 'toolbar-moved', keys: PAINT_KEYS });
    const rel = (box, to) => [box[0] - to[0], box[1] - to[1], box[2], box[3]];
    const columnRel = rel(found.column, found.body);
    const viewRel = rel(found.view, found.body);
    const first = mock.buttons[0];
    report.toolbar[`${engine} ${viewportName}`].geometry = { column: columnRel, view: viewRel, buttons: found.buttons.map((one) => rel(one.box, found.column)) };
    if (!near(columnRel, mock.tools.rel)) fail(where, `geometry: the toolbar's column is ${JSON.stringify(columnRel)} in the body, the mock's ${JSON.stringify(mock.tools.rel)}`);
    if (!near(viewRel, mock.content.rel)) fail(where, `geometry: the log view is ${JSON.stringify(viewRel)} in the body, the mock's content ${JSON.stringify(mock.content.rel)}`);
    found.buttons.forEach((one, index) => {
      const own = rel(one.box, found.column);
      const slot = [first.relTools[0], mock.slots.pad + mock.slots.pitch * index, first.relTools[2], first.relTools[3]];
      const measured = mock.buttons[index];
      // A button the mock draws in the same slot is compared with the mock's own measurement; the others with its slot arithmetic (4 px above, a 32 px pitch: shell-regions.js `TOOL_PITCH`, `TOOL_PAD`).
      const wanted = index < 2 && measured !== undefined ? measured.relTools : slot;
      if (!near(own, wanted)) fail(where, `geometry: the ${one.id} button is ${JSON.stringify(own)} in the column, the mock's ${JSON.stringify(wanted)}`);
      const inside = [one.svg[0] - one.box[0], one.svg[1] - one.box[1], one.svg[2], one.svg[3]];
      const glyph = [first.svg[0] - first.abs[0], first.svg[1] - first.abs[1], first.svg[2], first.svg[3]];
      if (!near(inside, glyph)) fail(where, `geometry: the glyph of ${one.id} is ${JSON.stringify(inside)} in its button, the mock's ${JSON.stringify(glyph)}`);
    });
    const paintOf = (id) => found.buttons.find((one) => one.id === id)?.paint ?? {};
    for (const [id, wanted] of [['follow', mock.buttons[0].style], ['pause', mock.buttons[1].style]]) {
      for (const key of PAINT_KEYS) if (paintOf(id)[key] !== wanted[key]) fail(where, `paint: the ${id} button's ${key} is ${String(paintOf(id)[key])}, the mock's ${String(wanted[key])}`);
    }

    if (paintOf('copy').color !== mockStates.connectingDisabledHover.color) fail(where, `paint: the unavailable Copy's colour is ${String(paintOf('copy').color)}, the mock's ${mockStates.connectingDisabledHover.color}`);
  }

  await press('copy', true);
  await press('clear', true);
  await sleep(200);
  const pressedNothing = await page.evaluate(() => window.__copied.length);
  if (pressedNothing !== 0) fail(where, `words: Copy, unavailable, wrote ${String(pressedNothing)} times to the clipboard`);
  // The tooltip is the kit's one host reading `data-ov-tip` (its own probe, tooltip-probe.mjs, shows a tip open for a trigger; the host fixture mounts no host): what the toolbar owns is the text, and it is read above.

  // --- the keyboard, with real key presses ---
  // The roving group's Tab stop is the button that last had the focus: Follow, here, so that the Tab lands where the check says.
  await page.locator(tool('follow')).focus();
  await page.locator('[data-shell-part="panelHide"]').focus();
  const at = () => page.evaluate(() => document.activeElement?.getAttribute('data-log-tool') ?? `${document.activeElement?.tagName}:${document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.getAttribute('type') ?? ''}`);
  const walk = [];
  await page.keyboard.press('Tab');
  walk.push(await at());
  if (mockStates !== undefined) {
    const focus = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor, outlineOffset: style.outlineOffset };
    });
    for (const key of Object.keys(focus)) if (focus[key] !== mockStates.paintFocus.paint[key]) fail(where, `paint: the keyboard focus's ${key} is ${focus[key]}, the mock's ${String(mockStates.paintFocus.paint[key])}`);
  }

  const stops = await page.evaluate(() => [...document.querySelectorAll('[data-shell-part="panelBody"]:not([hidden]) [aria-label="Logs tools"] button')].filter((b) => b.tabIndex === 0).length);
  await page.keyboard.press('Tab');
  walk.push(await at());
  await page.keyboard.press('Shift+Tab');
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Home']) {
    await page.keyboard.press(key);
    walk.push(await at());
  }
  if (walk[0] !== 'follow') fail(where, `keys: the Tab from Hide panel landed on ${walk[0]}, wanted the toolbar's Follow`);
  if (stops !== 1) fail(where, `keys: ${String(stops)} buttons of the toolbar are Tab stops, wanted one`);
  if (walk[1] !== 'INPUT:Search logs') fail(where, `keys: the Tab after the toolbar landed on ${String(walk[1])}, wanted the find field (the toolbar is one stop)`);
  const wanted = ['pause', 'timestamps', 'clear', 'copy', 'copy', 'clear', 'follow', 'copy', 'follow'];
  if (JSON.stringify(walk.slice(2)) !== JSON.stringify(wanted)) fail(where, `keys: ArrowDown x5, ArrowUp, Home, End, Home landed on ${JSON.stringify(walk.slice(2))}, wanted ${JSON.stringify(wanted)}`);
  // Enter and Space press a button: Space on Follow turns it off, Enter turns Pause on, and again.
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(250);
  const keyed = await read();
  if (keyed.tools.follow?.pressed !== 'false' || keyed.tools.pause?.pressed !== 'true') fail(where, `keys: Space on Follow and Enter on Pause left them ${String(keyed.tools.follow?.pressed)} and ${String(keyed.tools.pause?.pressed)}, wanted false and true`);
  report.toolbar[`${engine} ${viewportName}`].keys = { walk, stops };

  // --- a panel too short for every button: the first ones stay and the last stand behind `⋯` More actions (the mock's rule, shell-regions.js 298-308), the column does not scroll, and the menu lists them and presses them ---
  // The keys left Follow off and Pause on. Follow pressed again follows and lets a paused stream through (the kit's `follow(true)`: the strip's Jump to latest), so the menu's words below are those of a session that follows and is not paused.
  await press('follow');
  await sleep(250);
  const restored = await read();
  if (restored.tools.follow?.pressed !== 'true' || restored.tools.pause?.pressed !== 'false') fail(where, `short: Follow pressed again left Follow ${String(restored.tools.follow?.pressed)} and Pause ${String(restored.tools.pause?.pressed)}, wanted pressed and not pressed`);
  const mockShort = MOCK_TOOLBAR.data[engine]?.[viewportName]?.short;
  const shape = (perturb) => page.evaluate(({ perturb: lose }) => {
    const column = document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [data-shell-part="logsTools"]');
    const origin = column.getBoundingClientRect();
    const bar = column.querySelector('[role=toolbar]');
    const buttons = [...bar.querySelectorAll('button')];
    const more = bar.querySelector('[data-log-tool="more"]');
    const menu = document.querySelector('[role=menu][aria-label="Logs actions"]');
    const names = buttons.map((one) => one.getAttribute('data-log-tool'));
    return {
      names: lose ? names.filter((name) => name !== 'more') : names,
      rects: buttons.map((one) => { const box = one.getBoundingClientRect(); return [box.left - origin.left, box.top - origin.top, box.width, box.height]; }),
      scrollHeight: column.scrollHeight,
      clientHeight: column.clientHeight,
      bar: column.offsetWidth - column.clientWidth,
      more: more === null ? null : { name: more.getAttribute('aria-label'), popup: more.getAttribute('aria-haspopup'), expanded: more.getAttribute('aria-expanded'), tip: more.getAttribute('data-ov-tip'), glyph: more.querySelector('[data-ov-glyph]')?.getAttribute('data-ov-glyph') ?? null, tabindex: more.tabIndex },
      menu: menu === null || menu.getBoundingClientRect().height === 0 ? null : [...menu.querySelectorAll('[role=menuitem]')].map((item) => item.textContent),
      menuInside: menu !== null && bar.contains(menu),
      active: document.activeElement?.getAttribute('data-log-tool') ?? document.activeElement?.tagName ?? '',
    };
  }, { perturb });
  // What the menu says: an item that cannot apply says why in its text (this session, `quiet`, has no line).
  const words = { follow: 'Follow', pause: 'Pause log updates', timestamps: 'Show timestamps in UTC', clear: 'Clear (There are no lines yet)', copy: 'Copy (There are no lines yet)' };
  const order = ['follow', 'pause', 'timestamps', 'clear', 'copy'];
  const shorts = {};
  // [the panel's height, the mock's data for that height]: 120 is the panel's least (a body of 79 px holds two slots), 200 a body of 159 px (four slots)
  for (const [size, mockAt] of [[120, mockShort?.min?.slots], [200, mockShort?.at200?.slots]]) {
    await page.evaluate((height) => window.__panel.resize({ size: height }), size);
    await sleep(300);
    const stay = order.slice(0, Math.floor((size - 41 - 4) / 32) - 1);
    const hidden = order.slice(stay.length);
    const seen = await shape(CONTROL === 'more-missing' && size === 120);
    shorts[size] = { seen, stay };
    if (seen.names.join() !== [...stay, 'more'].join()) fail(where, `short: at ${String(size)} px the column holds ${seen.names.join(', ')}, the mock's rule keeps ${stay.join(', ')} and puts the rest behind More actions`);
    if (mockAt !== undefined && stay.length !== mockAt.shown) fail(where, `short: at ${String(size)} px the mock keeps ${String(mockAt.shown)} buttons, this probe's arithmetic ${String(stay.length)}`);
    stay.forEach((id, index) => {
      if (!near(seen.rects[index] ?? [], [6, 4 + 32 * index, 28, 28], 0.5)) fail(where, `short: at ${String(size)} px ${id} stands at ${JSON.stringify(seen.rects[index])}, the mock's slot is ${JSON.stringify([6, 4 + 32 * index, 28, 28])}`);
    });
    if (mockAt !== undefined && !near(seen.rects[stay.length] ?? [], mockAt.more.relTools, 0.5)) fail(where, `short: at ${String(size)} px the More button stands at ${JSON.stringify(seen.rects[stay.length])}, the mock's at ${JSON.stringify(mockAt.more.relTools)}`);
    if (seen.scrollHeight > seen.clientHeight || seen.bar !== 0) fail(where, `short: at ${String(size)} px the column scrolls or draws a bar (${JSON.stringify({ scrollHeight: seen.scrollHeight, clientHeight: seen.clientHeight, bar: seen.bar })}): the buttons that do not fit are behind More actions, none is clipped`);
    if (seen.more === null || seen.more.name !== 'More actions' || seen.more.popup !== 'menu' || seen.more.tip !== 'More actions' || seen.more.glyph !== 'ellipsis' || seen.more.tabindex !== -1 || (seen.more.expanded ?? 'false') !== 'false') fail(where, `short: at ${String(size)} px the More button is ${JSON.stringify(seen.more)}, the mock's is named More actions with a tooltip of that name, the ellipsis glyph, aria-haspopup (true, which is menu) and one Tab stop in the toolbar: Follow's`);
    if (seen.menu !== null) fail(where, `short: at ${String(size)} px the menu is open before a press`);

    // A real pointer press opens the kit's menu, which lists what is behind the button in the column's order, each saying what pressing it does; it is not inside the toolbar; Escape closes it and gives the focus back to the button.
    await page.locator(tool('more')).click();
    await sleep(250);
    const opened = await shape(false);
    if ((opened.menu ?? []).join('|') !== hidden.map((id) => words[id]).join('|')) fail(where, `short: at ${String(size)} px the menu lists ${JSON.stringify(opened.menu)}, wanted ${JSON.stringify(hidden.map((id) => words[id]))}`);
    if (opened.menuInside) fail(where, `short: at ${String(size)} px the menu is inside the toolbar, so its items would be stops of it`);
    if (opened.more?.expanded !== 'true') fail(where, `short: at ${String(size)} px the More button says aria-expanded ${String(opened.more?.expanded)} while its menu is open`);
    await page.keyboard.press('Escape');
    await sleep(200);
    const closed = await shape(false);
    if (closed.menu !== null || closed.active !== 'more') fail(where, `short: at ${String(size)} px Escape left the menu ${JSON.stringify(closed.menu)} and the focus on ${closed.active}, wanted it closed and the focus back on the More button`);
  }

  // At the least height: an item presses its button (Pause holds the stream, and the item then says Resume), the toolbar keeps its Tab stop and its arrows with the More button last (Up and Down are the toolbar's, not the menu's), and the buttons come back when the panel does.
  await page.evaluate(() => window.__panel.resize({ size: 120 }));
  await sleep(300);
  await page.locator(tool('more')).click();
  await sleep(250);
  await page.getByRole('menuitem', { name: 'Pause log updates' }).click();
  await sleep(300);
  const afterItem = await shape(false);
  if (afterItem.menu !== null || afterItem.active !== 'more') fail(where, `short: a pressed item left the menu ${JSON.stringify(afterItem.menu)} and the focus on ${afterItem.active}, wanted it closed and the focus back on the More button`);
  await page.locator(tool('more')).click();
  await sleep(250);
  const resume = await shape(false);
  if (resume.menu?.[0] !== 'Resume log updates') fail(where, `short: after Pause log updates the menu's first item says ${JSON.stringify(resume.menu?.[0])}, wanted Resume log updates: the item did not pause the stream`);
  await page.getByRole('menuitem', { name: 'Resume log updates' }).click();
  await sleep(300);
  await page.locator(tool('follow')).focus();
  const shortStops = await page.evaluate(() => [...document.querySelectorAll('[data-shell-part="panelBody"]:not([hidden]) [data-shell-part="logsTools"] button')].filter((one) => one.tabIndex === 0).map((one) => one.getAttribute('data-log-tool')));
  await page.keyboard.press('ArrowDown');
  const shortDown = (await shape(false)).active;
  await page.keyboard.press('ArrowDown');
  const shortStop = (await shape(false)).active;
  await page.keyboard.press('ArrowUp');
  const shortUp = await shape(false);
  await page.keyboard.press('End');
  const shortEnd = (await shape(false)).active;
  if (shortStops.join() !== 'follow' || shortDown !== 'more' || shortStop !== 'more' || shortUp.active !== 'follow' || shortUp.menu !== null || shortEnd !== 'more') fail(where, `short: the keys: Tab stops ${shortStops.join()}, ArrowDown reached ${shortDown} and ${shortStop}, ArrowUp reached ${shortUp.active} (menu ${JSON.stringify(shortUp.menu)}), End reached ${shortEnd}; wanted follow, more and more, follow with no menu, more`);
  await page.evaluate(() => window.__panel.resetHeight());
  await sleep(300);
  const grown = await shape(false);
  const regrown = await read();
  if (regrown.tools.pause?.pressed !== 'false') fail(where, `short: after Pause log updates and Resume log updates from the menu the toolbar's Pause is ${String(regrown.tools.pause?.pressed)}, wanted not pressed`);
  if (grown.active !== 'pause') fail(where, `short: the panel grew while the More button had the focus and the focus is on ${grown.active}, wanted the button that took its slot (pause): the arrows would stop reaching the toolbar`);
  if (grown.names.join() !== order.join() || grown.more !== null) fail(where, `short: with the panel's own height again the column holds ${grown.names.join(', ')}, wanted the five buttons and no More button`);
  report.toolbar[`${engine} ${viewportName}`].short = { shorts, keys: { stops: shortStops, down: shortDown, stop: shortStop, up: shortUp.active, end: shortEnd }, back: grown.names };

  // --- the stream: the session `app` (20 lines a second) ---
  await page.evaluate(() => { document.activeElement?.blur(); });
  const first = await make(0);
  await page.waitForFunction(() => Number(document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [data-log-session] [role=grid]')?.getAttribute('aria-rowcount') ?? 0) > 12, null, { timeout: 15000 });
  // The tab of `quiet` is under the new one; the new session is on screen. Pause: the stream holds, and the lines that arrive are counted.
  if (waits) {
    const before = await read();
    await press('pause');
    await sleep(1400);
    const held = await read();
    const pending = await page.evaluate(() => window.__fixtureLogs.stats());
    const said = countIn(held.strip, /Paused, ([\d,]+) new lines? waiting/);
    report.toolbar[`${engine} ${viewportName}`].pause = { rowsBefore: before.rows, rowsPaused: held.rows, strip: held.strip, streamHeld: pending.held };
    // A second reading after a wait, the stream going on at 20 lines a second: a view that draws a line while it is paused has more rows now than right after the press.
    await sleep(800);
    // The negative control `pause-leaks`: the view's row count reads five more than it was while the toolbar says paused (the attribute is put back right after the reading, so no other check sees it).
    if (CONTROL === 'pause-leaks') await page.evaluate(() => { const grid = document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [data-log-session] [role=grid]'); grid.__rows = grid.getAttribute('aria-rowcount'); grid.setAttribute('aria-rowcount', String(Number(grid.__rows) + 5)); });
    const leaked = await read();
    if (CONTROL === 'pause-leaks') await page.evaluate(() => { const grid = document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [data-log-session] [role=grid]'); grid.setAttribute('aria-rowcount', grid.__rows); });
    if (held.tools.pause?.pressed !== 'true') fail(where, `pause: Pause is ${String(held.tools.pause?.pressed)} after a press, wanted pressed`);
    if (leaked.rows !== held.rows) fail(where, `pause: the view drew ${String(leaked.rows - held.rows)} lines while paused (${String(held.rows)} then ${String(leaked.rows)})`);
    if (said < 18 || Math.abs(said - pending.held) > 12) fail(where, `pause: the strip says "${held.strip}" and the stream holds ${String(pending.held)} lines: the lines that arrive while paused are not counted as the stream holds them`);
    await press('pause');
    await sleep(500);
    const resumed = await read();
    report.toolbar[`${engine} ${viewportName}`].pause.rowsResumed = resumed.rows;
    if (resumed.tools.pause?.pressed !== 'false') fail(where, `pause: Pause is ${String(resumed.tools.pause?.pressed)} after a second press, wanted not pressed`);
    if (resumed.rows < held.rows + said) fail(where, `pause: after resuming the view has ${String(resumed.rows)} lines, the ${String(held.rows)} it had and the ${String(said)} that waited are ${String(held.rows + said)}`);
    if (!resumed.strip.includes('Following')) fail(where, `pause: after resuming the strip says "${resumed.strip}", wanted Following`);
    // The same lines, held while paused, are the ones that come: none was lost.
    await sleep(100);
  }

  // Follow: the reader scrolls up (the view stops following), the toggle says so; pressed, it follows the end again. Off at the end: new lines are counted as unseen.
  await page.locator('[data-shell-part="panelBody"]:not([hidden]) [data-log-session] [role=grid]').hover();
  await page.mouse.wheel(0, -400);
  await sleep(350);
  const scrolled = await read();
  if (scrolled.tools.follow?.pressed !== 'false' || !scrolled.strip.includes('Scrolled back')) fail(where, `follow: after the reader scrolled up Follow is ${String(scrolled.tools.follow?.pressed)} and the strip says "${scrolled.strip}", wanted not pressed and Scrolled back`);
  await press('follow');
  await sleep(500);
  const followed = await page.evaluate(() => {
    const grid = document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [data-log-session] [role=grid]');
    return { atEnd: grid.scrollHeight - grid.scrollTop - grid.clientHeight <= 2, pressed: document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [data-log-tool="follow"]').getAttribute('aria-pressed') };
  });
  if (followed.pressed !== 'true' || !followed.atEnd) fail(where, `follow: Follow pressed again: pressed ${String(followed.pressed)}, list at its end ${String(followed.atEnd)}, wanted both`);
  await press('follow');
  await sleep(1100);
  const off = await read();
  if (off.tools.follow?.pressed !== 'false' || countIn(off.strip, /Scrolled back, ([\d,]+) new lines?/) < 8) fail(where, `follow: Follow off at the end: pressed ${String(off.tools.follow?.pressed)}, the strip says "${off.strip}", wanted not pressed and Scrolled back, N new lines`);
  await press('follow');
  await sleep(500);

  // Copy: every line the list draws, with its source; the copy confirms itself for two seconds and says how many.
  await press('copy');
  await sleep(300);
  const copied = await page.evaluate(() => ({ writes: window.__copied.length, text: window.__copied.at(-1) ?? '' }));
  let text = copied.text;
  if (CONTROL === 'copy-no-source') text = text.split('\n').map((line) => line.replace(/ source\/main {2}/, ' ')).join('\n');
  const afterCopy = await read();
  const copiedLines = text === '' ? [] : text.split('\n');
  report.toolbar[`${engine} ${viewportName}`].copy = { writes: copied.writes, lines: copiedLines.length, first: copiedLines[0], said: afterCopy.said, glyph: afterCopy.tools.copy?.glyph };
  if (copied.writes !== 1 || copiedLines.length < 12) fail(where, `copy: ${String(copied.writes)} writes of ${String(copiedLines.length)} lines, wanted one write of every line drawn`);
  if (Math.abs(copiedLines.length - afterCopy.rows) > 40) fail(where, `copy: ${String(copiedLines.length)} lines were written, the list holds ${String(afterCopy.rows)}`);
  if (!copiedLines.every((line) => /^\d\d:\d\d:\d\d\.\d{3} .{5} source\/main {2}\S/.test(line))) fail(where, `copy: a line is not the mock's lineText (the clock, the level, the source label for every line, two spaces, the text): ${JSON.stringify(copiedLines.find((line) => !/^\d\d:\d\d:\d\d\.\d{3} .{5} source\/main {2}\S/.test(line)))}`);
  if (!new RegExp(`^[\\d,]+ lines copied$`).test(afterCopy.said)) fail(where, `copy: the polite region says "${afterCopy.said}", wanted "N lines copied"`);
  if (afterCopy.tools.copy?.glyph !== 'check') fail(where, `copy: the button draws ${String(afterCopy.tools.copy?.glyph)} right after a copy, wanted the check`);
  if (waits) {
    await sleep(2200);
    const reverted = await read();
    if (reverted.tools.copy?.glyph !== 'copy') fail(where, `copy: the button still draws ${String(reverted.tools.copy?.glyph)} 2.5 s after a copy, wanted the copy glyph again`);
  }

  // Copy with a selection: the button still writes every line the list draws (the mock's Copy writes the lines of its view, shell-panel.js 2063-2070); the selected lines are what the keyboard's copy writes. The list stands still while the
  // lines are chosen: Follow is off, so the window does not slide under the pointer as the stream goes on.
  await press('follow');
  await sleep(250);
  // A row, then Shift with the arrow twice: three lines (the keys of the list, with real presses, so no element has to be found again under a window that moves).
  await page.locator('[data-shell-part="panelBody"]:not([hidden]) [data-log-session] [role=row][data-n]').nth(2).click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  const writesBefore = await page.evaluate(() => window.__copied.length);
  await press('copy');
  await sleep(250);
  const selected = await page.evaluate(() => ({ writes: window.__copied.length, text: window.__copied.at(-1) ?? '' }));
  const afterSelected = await read();
  const selectedLines = selected.text.split('\n').length;
  if (selected.writes !== writesBefore + 1) fail(where, `copy: with three lines selected the button wrote ${String(selected.writes - writesBefore)} times, wanted one: the text and the announcement below would be the first copy's`);
  if (selectedLines < 12 || Math.abs(selectedLines - afterSelected.rows) > 40 || afterSelected.said !== `${String(selectedLines).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} lines copied`) fail(where, `copy: with three lines selected ${String(selectedLines)} lines were written, the list holds ${String(afterSelected.rows)} and the region says "${afterSelected.said}", wanted every line the list draws and "N lines copied" with that N: a selection does not narrow the button`);

  // UTC: the rows' clock takes its Z form, the head is the mock's 120 px, and the copy writes the same clock. Back: the viewer's own.
  await press('timestamps');
  await sleep(250);
  const utc = await read();
  if (utc.tools.timestamps?.pressed !== 'true' || utc.timestamps !== 'utc' || utc.clocks.length === 0 || !utc.clocks.every((clock) => /^\d\d:\d\d:\d\d\.\d{3}Z$/.test(clock))) fail(where, `utc: after the press the toggle is ${String(utc.tools.timestamps?.pressed)}, the view says ${utc.timestamps} and the rows read ${JSON.stringify(utc.clocks.slice(0, 2))}, wanted pressed, utc and a clock with its Z`);
  await press('copy');
  await sleep(250);
  const utcCopy = await page.evaluate(() => window.__copied.at(-1) ?? '');
  if (!utcCopy.split('\n').every((line) => /^\d\d:\d\d:\d\d\.\d{3}Z /.test(line))) fail(where, `utc: a copy while the rows show UTC writes ${JSON.stringify(utcCopy.split('\n')[0])}, wanted the clock with its Z`);
  await press('timestamps');
  await sleep(250);
  const local = await read();
  if (local.tools.timestamps?.pressed !== 'false' || local.clocks.some((clock) => clock.endsWith('Z'))) fail(where, `utc: pressed again the toggle is ${String(local.tools.timestamps?.pressed)} and the rows read ${JSON.stringify(local.clocks.slice(0, 2))}, wanted not pressed and the viewer's own clock`);

  // The level filter: Error shows the lines at or above it; Copy writes only those, and with none to show it says why.
  await page.getByRole('radio', { name: 'Error' }).click();
  await sleep(300);
  const filtered = await read();
  if (filtered.rows === 0) {
    if (filtered.tools.copy?.disabled !== 'true' || filtered.tools.copy?.reason !== 'No lines match the filters') fail(where, `filter: with every line hidden Copy is ${JSON.stringify({ disabled: filtered.tools.copy?.disabled, reason: filtered.tools.copy?.reason })}, wanted unavailable with "No lines match the filters"`);
    if (filtered.tools.clear?.disabled !== null) fail(where, `filter: Clear is unavailable while the filter hides lines it still holds`);
  } else {
    await press('copy');
    await sleep(250);
    const only = await page.evaluate(() => window.__copied.at(-1) ?? '');
    if (!only.split('\n').every((line) => / ERROR /.test(line))) fail(where, `filter: with Error shown a copy writes ${JSON.stringify(only.split('\n').find((line) => !/ ERROR /.test(line)))}`);
  }

  await page.getByRole('radio', { name: 'All' }).click();
  await press('follow');
  await sleep(300);

  // Clear: the view forgets everything made so far, the lines the stream holds and the view had not read included (the mock's Clear empties its queue too); every line made after it is shown, exactly: the lines made since = the lines shown.
  const cleared = await page.evaluate(() => {
    const stats = window.__fixtureLogs.stats();
    const counters = { ...window.__fixtureLogs };
    document.querySelector('[data-shell-part="panelBody"]:not([hidden]) [data-log-tool="clear"]').click();
    return { stats, counters };
  });
  await sleep(300);
  const right = await read();
  if (right.rows > 12) fail(where, `clear: ${String(right.rows)} lines right after a clear`);
  await page.evaluate(() => window.__fixtureLogs.stopSources());
  await sleep(700);
  const settled = await page.evaluate(() => ({ stats: window.__fixtureLogs.stats(), counters: { ...window.__fixtureLogs } }));
  const done = await read();
  const shown = CONTROL === 'clear-miscount' ? done.rows + 1 : done.rows;
  const made = settled.stats.emitted - cleared.stats.emitted;
  report.toolbar[`${engine} ${viewportName}`].clear = { stats: cleared.stats, madeSince: made, shown, strip: done.strip, counters: settled.counters };
  if (shown !== made) fail(where, `clear: the sources made ${String(made)} lines after it (the ${String(cleared.stats.held)} the stream held at it are cleared with the rest): the view shows ${String(shown)}, wanted ${String(made)}`);
  if (/dropped/.test(done.strip)) fail(where, `clear: the strip says "${done.strip}": what was cleared is not dropped`);
  if (settled.counters.closed !== cleared.counters.closed || settled.counters.listeners !== cleared.counters.listeners) fail(where, `clear: the stream's counters moved (${JSON.stringify(cleared.counters)}, then ${JSON.stringify(settled.counters)}): Clear is the view's, not the stream's`);

  // --- a session's choices are its own: UTC, Follow off and a pause in `app` survive another tool being shown and another session being chosen, and `pair` is as a new session is ---
  const other = await make(4);
  await sleep(300);
  const fresh = await read();
  if (fresh.tools.timestamps?.pressed !== 'false' || fresh.tools.pause?.pressed !== 'false' || fresh.tools.follow?.pressed !== 'true') fail(where, `session: a new session starts with UTC ${String(fresh.tools.timestamps?.pressed)}, Pause ${String(fresh.tools.pause?.pressed)}, Follow ${String(fresh.tools.follow?.pressed)}, wanted false, false, true`);
  await page.locator(`[data-shell-part="sessionTab"][data-tab-id="${first}"] [role=tab]`).click();
  await sleep(300);
  await press('timestamps');
  await press('pause');
  await press('follow');
  await sleep(300);
  await page.evaluate(() => window.__panel.show({ tool: 'alpha:streams' }));
  await sleep(400);
  await page.evaluate(() => window.__panel.show({ tool: 'logs' }));
  await sleep(400);
  await page.locator(`[data-shell-part="sessionTab"][data-tab-id="${other}"] [role=tab]`).click();
  await sleep(300);
  const pair = await read();
  await page.locator(`[data-shell-part="sessionTab"][data-tab-id="${first}"] [role=tab]`).click();
  await sleep(300);
  if (CONTROL === 'state-lost') await press('timestamps');
  const back = await read();
  report.toolbar[`${engine} ${viewportName}`].session = { appBack: Object.fromEntries(Object.entries(back.tools).map(([id, one]) => [id, one.pressed])), pair: Object.fromEntries(Object.entries(pair.tools).map(([id, one]) => [id, one.pressed])) };
  if (back.tools.timestamps?.pressed !== 'true' || back.timestamps !== 'utc' || back.tools.pause?.pressed !== 'true' || back.tools.follow?.pressed !== 'false') fail(where, `session: back on the first session UTC is ${String(back.tools.timestamps?.pressed)}, Pause ${String(back.tools.pause?.pressed)}, Follow ${String(back.tools.follow?.pressed)}, wanted true, true, false`);
  if (pair.tools.timestamps?.pressed !== 'false' || pair.tools.pause?.pressed !== 'false' || pair.tools.follow?.pressed !== 'true') fail(where, `session: the other session shows UTC ${String(pair.tools.timestamps?.pressed)}, Pause ${String(pair.tools.pause?.pressed)}, Follow ${String(pair.tools.follow?.pressed)}: a choice of the first leaked into it`);

  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

const production = wants('fills') || wants('sources') || wants('kept') || wants('identity') || wants('a11y') || wants('memory') || wants('toolbar') ? await serveFixtures(buildFixtures('production')) : null;
const development = wants('hidden') || wants('appears') ? await serveFixtures(buildFixtures('development')) : null;
const axe = wants('a11y') ? readFileSync(AXE, 'utf8') : '';
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

    if (wants('identity')) {
      await identity(browser, engineName, viewportName, viewport, production.origin);
      ran.add('identity');
    }

    if (wants('a11y')) {
      await a11y(browser, engineName, viewportName, viewport, production.origin, axe);
      ran.add('a11y');
    }

    if (wants('toolbar')) {
      await toolbar(browser, engineName, viewportName, viewport, production.origin);
      ran.add('toolbar');
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
console.log(JSON.stringify({ hidden: report.hidden, shift: report.shift, sources: report.sources, appears: report.appears, identity: report.identity, a11y: report.a11y, memory: report.memory, toolbar: report.toolbar, notes: report.notes }, null, 1));
if (CONTROL !== '') {
  const detected = failures.filter((line) => PERTURBATIONS[CONTROL].expected.test(line));
  console.log(`\nwhat the probe saw with the perturbation "${CONTROL}": ${String(failures.length)} differences\n${failures.map((line) => `  ${line}`).join('\n')}`);
  console.log(detected.length > 0 ? `\nNEGATIVE CONTROL "${CONTROL}": detected (${String(detected.length)} differences, e.g. ${detected[0]})` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${String(failures.length)} other failures)`);
  // The controls of P1b-4a trip their own assertion and no other (rule 28): a failure of another check in the run (a precondition that did not hold, such as Copy arming its confirmation) fails the control.
  const others = failures.filter((line) => !PERTURBATIONS[CONTROL].expected.test(line));
  if (detected.length > 0 && others.length > 0 && TOOLBAR_CONTROLS.has(CONTROL)) {
    console.log(`NEGATIVE CONTROL "${CONTROL}": FAILED, ${String(others.length)} other failures (a control trips only its own assertion): ${others[0]}`);
    process.exit(1);
  }

  process.exit(detected.length > 0 ? 0 : 1);
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}

console.log('\nlogs probe: no failures');
