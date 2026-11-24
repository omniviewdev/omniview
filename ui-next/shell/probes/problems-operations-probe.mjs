// Probes the host's Problems and Operations tools (PT1) in WebKit and Chromium: the REAL bodies (`ProblemsBody`, `OperationsBody`) over the real models (`createProblems`, `createOperations` over `createActivityFeed`) in the real panel
// and its tool strip with the badges, fed by hand-built conditions and activity records (problems-operations-fixture.tsx; the window's own wiring of the producers is the seam's, scenario `v`). What a jsdom test cannot say is
// said here: what React commits in a browser, what a table lays out, what a long word does to a cell, what a key does.
//
//   node ui-next/shell/probes/problems-operations-probe.mjs      builds the fixtures (OMNIVIEW_UI=next: production, and React's development build for the commit counts), serves them, probes them
//   env -i HOME="$HOME" PATH="$PATH" ENGINES=webkit node ui-next/shell/probes/problems-operations-probe.mjs      then ENGINES=chromium; FONT_DELAY_MS=40 in front serves the fonts as a runner does
//
//   FIXTURE_DIST=<dir> FIXTURE_DIST_DEV=<dir>   probe existing builds      BUILD_CACHE=<dir>   build once into <dir>/shell-fixtures/<mode> and read it afterwards (the shard runner sets it)
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1280x800,800x600   (defaults: both engines, the three viewports)      SECTIONS=commits,hidden,...   (default: all)      REPORT=<file>   the full report as JSON      SHOTS=<dir>   a picture of each tool
//   NEGATIVE_CONTROL=<name>   perturb ONE thing in the page (PERTURBATIONS, below; `CONTROLS=1` lists them) and exit 0 when the assertion the control is named for, and no other, failed (Chromium at 1440 x 900)
//   ASSERTION_OFF=<regex>     drops the failures whose line matches, as if the assertion that says them were not there: it must be the pattern of the active control's own assertion (printed with the control's result), and the
//                             control must then print NOT DETECTED with no other failure: the same fault passes undetected when its assertion is removed (AGENTS 28)
//
// EVERY ASSERTION HERE IS A COUNT or a rectangle: commits, rows rendered, nodes changed, subscribers, mounted rows, stops, calls. No assertion is a time; a wait ends when its condition holds (or when a counter has not moved for a while: a
// wait for something NOT to happen can only get weaker on a busy machine) and is bounded only against a page that never gets there, by the ONE overall wait (WAIT) that every wait of this probe has: a page that is still moving
// when it is over fails `settle`. `uptime` is printed at the start and at the end (AGENTS 27).
//
// What each assertion says (the name starts each line of a failure: `<assertion> <engine> <viewport>: <what>`). The numbers of the mock are the ones its reading can be trusted for (mock-problems-operations.json: the row, the header, the
// footer, the dot and the count of a tab); the defects it was measured with are NOT copied (the Condition column that collapses to 14 px, the Progress cell that runs under Started, the dash drawn for work with no measure): where the mock is
// wrong the probe asserts what a person needs, that no word is cut without an ellipsis and no cell's content is under another.
//
//   commits.arrive   200 conditions (200 tasks) arrive at a table that is on screen and full, as ONE list from the producer: ONE commit of the window and of the body, the table says the new count, and the model holds every row
//   tick.commits     one task of 200 ticks (its progress), or one condition of 200 changes its words (every other condition is said again as a new object, as a producer does): ONE commit, in the body of that tool alone
//   tick.cells       the cells the table rendered, counted by the key of their row (the kit's table calls a column's `cell` to render a row): the ONE row that changed and no other, and every column of it ONCE (as many calls as the probe wrapped columns)
//   tick.dom         the other rows' elements are the very elements they were (none was replaced), and no node changed outside the row that did (not the footer, the header, the tab strip)
//   hidden.cost      a tool that is not on screen (another tool is, or the panel is closed) costs nothing when its feed goes on: no commit and no DOM change for 200 tasks and a tick (and for 200 conditions that no tab counts); for 200
//                    errors the one commit and the one change are the tab's count and none is in the tool's body; the body is never in the document. The model holds every row all the while (the feed went on)
//   hidden.back      the tool that comes back on screen says what arrived while it was hidden
//   subscribers.body a body listens to its model while it is on screen and only then: one subscription more while it is shown, none more after it was hidden, however often it goes and comes
//   unmount.held     when the window goes (its tree unmounted, the window's own attachment released) nothing is held: every subscription to a model and to the feed was stopped
//   unmount.heard    and no listener of a model is told of anything after that: a stop that did not stop is a listener left, which nothing else sees
//   virtual.rows     200 rows are virtualised: the mounted rows are a few, not 200, at the top and at the end (and the table says all 200, `aria-rowcount`)
//   virtual.last     with the keyboard on the table's region, End shows the last row and Home the first
//   geometry.row     a row is the mock's 24 px, and rows are 24 px apart
//   geometry.head    the header row is the mock's 25 px
//   geometry.fill    the lanes tile the panel's body: the header at its top, the first row under the header, the footer at its bottom (it was below it, out of the panel, with 200 rows)
//   geometry.foot    the footer is the mock's 33 px, says `N problems` / `N operations`, its words 12 px in and 9 px down, 16 px high, in the mock's colour, size and weight
//   geometry.tab     a count on a tab is plain muted text 4 px after the label, in the mock's colour and size; a dot is 6 x 6 px, 5 px from the tab's top and end edges, 50% round, in the mock's warning and error colours
//   layout.clip      a word that does not fit its cell is cut WITH an ellipsis (a cell says "..." where it cuts), at 1440 x 900, 1280 x 800 and 800 x 600, in every column of both tools
//   layout.overlap   no cell's content is under another cell (the mock's Progress text ran under Started), and no two cells of a row overlap: the count of overlapping pairs is 0
//   layout.premise   the scene did what it says: words that are longer than their cell were in the table, in EACH column the premise names (the Condition, Source and Target of Problems; the Operation, Source, Target and Progress of
//                    Operations), counted in the cells of the body, a header is none: a column with no long word in it is a column where a clipping defect would not be seen
//   a11y             axe-core on the panel: no violation (the violations axe RETURNS; a scene that could not run axe is a failure of `scene`) with rows, with nothing to list, and with the dot of a failure nobody read (the tab's name carries the count and the dot's words)
//   keys.stops       every control of the body is a Tab stop and nothing else is: the table's region, then each button of each row in the order of the rows (Cancel, Open), a button with no page (aria-disabled) among them; no row is a stop
//   keys.open        Enter and Space on a row's Open button call `open` ONCE with the row's subject; a click on the row and a shift-click each ONCE with the row's subject (the shift is the disposition's); a click on the button ONCE, not twice; a row with no page does nothing
//   keys.cancel      Enter on a row's Cancel calls the host's cancel once, for that task
//   keys.scroll      PageDown on the table's region scrolls it (its rows are reachable by the arrows' own scrolling)
//   scene            every scene did what it set out to do: its page opened, its setup ran, its waits came, axe loaded. What throws in a scene is a failure of THIS and of no other assertion (the line says which one did not get to look): a setup that
//                    failed has seen nothing, and an error recorded under an assertion would be a detection of the control of that assertion that nothing detected, and would go when the assertion is removed (AGENTS 28)
//   settle           the page comes to rest: what a scene waits on (the commits of the window and the size of the document) stops moving, within the overall wait; a body that renders again for ever never does
//   premise          what a section needs before it can say anything (a feed that went on, a table that was drawn, a row that changed)
//
// Exit code 1 when anything differs. The negative controls (AGENTS 28) are in PERTURBATIONS below, with how to run one and the proof that each depends on its assertion.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg, uptime as machineUptime } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { awaitFonts, ENGINES, launch } from '../../../packages/kit/probes/probe-lib.mjs';
import { AXE, buildFixtures, serveFixtures, sleep } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const mock = JSON.parse(readFileSync(path.join(here, 'mock-problems-operations.json'), 'utf8'));
const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 }, '800x600': { width: 800, height: 600 } };
const SECTION_NAMES = ['commits', 'hidden', 'subscribers', 'virtual', 'geometry', 'layout', 'a11y', 'keyboard'];
/** The sections that count commits: they read React's development build (its Profiler calls nothing in a production build). Every other section reads the production build. */
const DEV_SECTIONS = ['commits', 'hidden', 'subscribers'];
/** The sections whose numbers do not depend on the size of the window: they run at the first viewport of the run (the counts of commits are the same at every viewport). */
const FIRST_VIEWPORT_ONLY = ['commits', 'hidden', 'subscribers', 'keyboard'];
const KINDS = ['problems', 'operations'];
const LABEL = { problems: 'Problems', operations: 'Operations' };
const OTHER = { problems: 'operations', operations: 'problems' };
/** The longest a wait for a condition may take: a bound against a page that never gets there. Nothing is judged by how long a wait took. */
const WAIT = 30_000;
/** How many conditions or tasks arrive in one list, and how many rows are on screen before they do (a table that is drawn and full: more rows than its pane holds). */
const BULK = 200;
const SEED = 30;
/** Mounted rows, at most: the rows of the tallest pane the probe draws (400 px) are 16, and the table mounts them with 8 beyond each edge, rounded out to steps of 4. A table that mounts 60 of 200 is not windowed. */
const MAX_MOUNTED = 60;

// ---------------------------------------------------------------------------------------------------------------------------
// The machine, then what is asked for.
// From `node:os`, not the `uptime` command: the CI image has no procps, so no `uptime`.
const uptime = () => `up ${Math.round(machineUptime() / 3600)} h, load average: ${loadavg().map((load) => load.toFixed(2)).join(', ')}`;
const uptimeAtStart = uptime();
console.log(`uptime: ${uptimeAtStart}`);

const names = (key, all) => (process.env[key] === undefined || process.env[key] === '' ? all : process.env[key].split(','));
for (const [key, list, known] of [['ENGINES', names('ENGINES', []), Object.keys(ENGINES)], ['VIEWPORTS', names('VIEWPORTS', []), Object.keys(VIEWPORTS)], ['SECTIONS', names('SECTIONS', []), SECTION_NAMES]]) {
  const unknown = list.filter((name) => !known.includes(name));
  if (unknown.length > 0) throw new Error(`${key} names ${unknown.join(', ')}, which is not one of ${known.join(', ')}`);
}

const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------------------------------------------------------------------
// The failures, by assertion: `fail` records what must hold (never thrown), `count` counts what was looked at, so that a summary can say how many things each assertion saw.
const failures = [];
const seen = new Map();
const OFF = process.env.ASSERTION_OFF === undefined || process.env.ASSERTION_OFF === '' ? undefined : new RegExp(process.env.ASSERTION_OFF);
const fail = (assertion, where, what) => {
  const line = `${assertion} ${where}: ${what}`;
  if (OFF === undefined || !OFF.test(line)) failures.push(line);
};
const count = (assertion) => seen.set(assertion, (seen.get(assertion) ?? 0) + 1);
/** Counts one thing looked at and records its failure, with `what` only made when it failed. */
const check = (assertion, where, ok, what) => {
  count(assertion);
  if (!ok) fail(assertion, where, what());
};
const round = (value) => Math.round(value * 100) / 100;
const firstLine = (error) => String(error?.message ?? error).split('\n')[0].slice(0, 300);
const report = { commits: {}, hidden: {}, subscribers: {}, virtual: {}, geometry: {}, layout: {}, a11y: {}, keyboard: {}, notes: [] };

/** Compares two numbers within `tolerance` px (the numbers of a stylesheet are the same in every engine and on every machine, so the default is half a pixel, not the repository's 1 px for text). */
function near(assertion, where, label, want, got, tolerance = 0.5) {
  count(assertion);
  if (got === undefined || got === null || Number.isNaN(got)) {
    fail(assertion, where, `${label}: the page does not draw it (the mock's is ${want})`);
    return;
  }

  if (Math.abs(want - got) > tolerance) fail(assertion, where, `${label}: mock ${want} ours ${round(got)} (off by ${round(Math.abs(want - got))})`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The mock's numbers: what its reading can be trusted for, and nothing the mock does wrong (its Condition column, its Progress cell and its dash for work with no measure are not here).
const MOCK = (() => {
  const scene = mock.data.webkit['1440x900'];
  const rows = scene['problems-rows'];
  const states = scene['tab-badges'].states;
  const tabOf = (state, key) => states[state].tabs.find((tab) => tab.key === key);
  const dotTab = tabOf('ops-error', 'operations');
  const countTab = tabOf('count-errors', 'problems');
  const paint = (state, name) => mock.styles[states[state].paint[name]];
  const [tx, ty, tw] = dotTab.tab;
  const [dx, dy, dw, dh] = dotTab.dot.rect;
  const [cx, cy, , ch] = countTab.count.rect;
  const [lx, ly, lw] = countTab.label;
  const footer = rows.footer;
  return {
    row: rows.firstRow.rect[3],
    head: rows.headRow[3],
    foot: { height: footer.rect[3], dx: footer.count.rect[0] - footer.rect[0], dy: footer.count.rect[1] - footer.rect[1], textHeight: footer.count.rect[3], paint: mock.styles[rows.paint.footerCount] },
    dot: { width: dw, height: dh, top: round(dy - ty), end: round(tx + tw - dx - dw), error: paint('ops-error', 'dotError'), warning: paint('dot-warnings', 'dotWarning') },
    count: { gap: round(cx - lx - lw), height: ch, top: round(cy - ly), paint: paint('count-errors', 'countPill') },
  };
})();

// ---------------------------------------------------------------------------------------------------------------------------
// The negative controls (AGENTS 28): each perturbs ONE thing in the page, and the probe must see it in the assertion the control is named for and in no other; with that assertion removed (ASSERTION_OFF=<its pattern>, which a run
// prints) the same fault must pass undetected. Run one with
//   env -i HOME="$HOME" PATH="$PATH" NEGATIVE_CONTROL=<name> node ui-next/shell/probes/problems-operations-probe.mjs                                   exit 0: "detected", and nothing else failed
//   env -i HOME="$HOME" PATH="$PATH" NEGATIVE_CONTROL=<name> ASSERTION_OFF='<the pattern printed>' node ui-next/shell/probes/problems-operations-probe.mjs   exit 1: "NOT DETECTED"
// `query` is the fixture's own control (the address's `control=`: a fault of what the page is made of: a producer, a model, a window), `css` a stylesheet added to the page right before it is read and `page` a function run in it
// (`stage` says when: `read`, the default, or `hidden`, before the hidden scenes' events).
const PERTURBATIONS = {
  // What a producer, a body and a model do.
  'per-record': { sections: ['commits'], query: 'per-record', expected: /^commits\.arrive\b/ },
  'all-rows': { sections: ['commits'], query: 'all-rows', expected: /^tick\.cells\b/ },
  'hidden-mounted': { sections: ['hidden'], stage: 'hidden', page: () => { window.__po.keepHidden('problems'); window.__po.keepHidden('operations'); }, expected: /^hidden\.cost\b/ },
  'leaky-model': { sections: ['subscribers'], query: 'leaky-model', expected: /^unmount\.heard\b/ },
  'no-detach': { sections: ['subscribers'], query: 'no-detach', expected: /^unmount\.held\b/ },
  // The table's window and its keys: rows a third of a row high, and a region that cannot scroll.
  'tiny-rows': { sections: ['virtual'], css: ':root { --ov-row-height: 3px !important; --ov-lh-16: 1px !important; --ov-row-pad: 1px !important; }', expected: /^virtual\.rows\b/ },
  'no-scroll': { sections: ['virtual'], css: '[role="region"] { overflow: hidden !important; }', expected: /^virtual\.last\b/ },
  // The boxes: a row 4 px too tall, a footer 4 px above the bottom, a footer's words 4 px in, a dot 4 px down, a count in another colour.
  'tall-rows': { sections: ['geometry'], css: 'tbody > tr > td { block-size: 28px !important; }', expected: /^geometry\.row\b/ },
  'footer-up': { sections: ['geometry'], css: '[data-ov-part="footer"] { transform: translateY(-4px); }', expected: /^geometry\.fill\b/ },
  'footer-words': { sections: ['geometry'], css: '[data-ov-part="footer"] > * { margin-inline-start: 4px !important; }', expected: /^geometry\.foot\b/ },
  'dot-down': { sections: ['geometry'], css: '[data-shell-part="toolBadge"][data-kind="dot"] { transform: translateY(4px); }', expected: /^geometry\.tab\b/ },
  'count-colour': { sections: ['geometry'], css: '[data-shell-part="toolBadge"][data-kind="count"] { color: rgb(1, 2, 3) !important; }', expected: /^geometry\.tab\b/ },
  // The words of a cell: an ellipsis taken away from every cell that draws one, and the cut of the fixed columns taken away (their words run under the next cell).
  'clip-off': { sections: ['layout'], css: 'td, td * { text-overflow: clip !important; }', expected: /^layout\.clip\b/ },
  'spill': { sections: ['layout'], css: 'td:not([data-ov-flexible]) > span, td:not([data-ov-flexible]) [data-ov-clip] { overflow: visible !important; }', expected: /^layout\.overlap\b/ },
  // A control of a row with no name, a button that is not a Tab stop, a row that is opened twice.
  'no-name': { sections: ['a11y'], page: () => document.querySelector('tbody button')?.removeAttribute('aria-label'), expected: /^a11y\b/ },
  'no-stop': { sections: ['keyboard'], page: () => { for (const button of document.querySelectorAll('tbody button')) { button.tabIndex = -1; } }, expected: /^keys\.stops\b/ },
  'open-twice': { sections: ['keyboard'], query: 'open-twice', expected: /^keys\.open\b/ },
  // A table that calls the cells of a row twice (the calls the changed row's cells get), long words in one column only (the premise of the layout), a shift-click that opens another subject than its row's.
  'cells-twice': { sections: ['commits'], query: 'cells-twice', expected: /^tick\.cells\b/ },
  'long-one': { sections: ['layout'], query: 'long-one', expected: /^layout\.premise\b/ },
  'shift-other': { sections: ['keyboard'], query: 'shift-other', expected: /^keys\.open\b/ },
  // What the probe does when the page or a scene does not do what is asked of it: a body that renders again for ever (the page never comes to rest), and a scene that throws (it never got to what its assertion looks at: that is no detection by that assertion).
  'render-loop': { sections: ['commits'], query: 'render-loop', expected: /^settle\b/ },
  'scene-throws': { sections: ['virtual'], page: () => { throw new Error('a fault planted in the page'); }, expected: /^scene\b/ },
};
if (CONTROL !== '' && PERTURBATIONS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);
// ASSERTION_OFF is for a negative control and for the one assertion that control is named for: with no control, or with a pattern that is not the control's own, it would silence a run that really fails.
if (OFF !== undefined && (CONTROL === '' || OFF.source !== PERTURBATIONS[CONTROL].expected.source)) throw new Error(`ASSERTION_OFF must be the pattern of the active negative control's own assertion (NEGATIVE_CONTROL=${CONTROL === '' ? '<none>' : CONTROL}${CONTROL === '' ? '' : `, its pattern is ${PERTURBATIONS[CONTROL].expected.source}`})`);
if (process.env.CONTROLS === '1') {
  for (const [name, control] of Object.entries(PERTURBATIONS)) console.log(`${name.padEnd(16)} ${control.sections.join(',').padEnd(12)} ${control.expected.source}`);
  process.exit(0);
}

const perturb = CONTROL === '' ? undefined : PERTURBATIONS[CONTROL];
const wants = (section) => (CONTROL === '' ? names('SECTIONS', SECTION_NAMES).includes(section) : perturb.sections.includes(section));
const engineNames = names('ENGINES', CONTROL === '' ? Object.keys(ENGINES) : ['chromium']);
const viewportNames = names('VIEWPORTS', CONTROL === '' ? Object.keys(VIEWPORTS) : ['1440x900']);

// ---------------------------------------------------------------------------------------------------------------------------
// The pages.
const url = (origin, query) => {
  const parts = [query, perturb?.query === undefined ? '' : `control=${perturb.query}`].filter(Boolean);
  return `${origin}/shell/probes/problems-operations-fixture.html${parts.length === 0 ? '' : `?${parts.join('&')}`}`;
};

/**
 * A page of the fixture in a fresh context: errors collected (a page error, a console error, a response that is not a 2xx), the fonts waited for. The Go host serves `/wails/*` and a static server does not: the page asks for the host's
 * script and is told 404, which is no error of the tools (the shell probes' `open` leaves it out too); the console says it as "Failed to load resource", which the response handler already says for every other file.
 */
async function openPage(browser, origin, viewport, query) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`page error: ${error.message.slice(0, 200)}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(`console.error: ${message.text().slice(0, 300)}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico') && !response.url().includes('/wails/')) errors.push(`${String(response.status())} ${response.url()}`);
  });
  await page.goto(url(origin, query), { waitUntil: 'load' });
  await page.waitForSelector('[data-shell-part="panel"]', { state: 'attached', timeout: WAIT });
  await awaitFonts(page);
  return { page, context, errors };
}

/** A page that does not come to rest: `quiet` throws it, and `scene` says it is a failure of `settle`. */
class Unsettled extends Error {}

/**
 * One scene in a page of its own: opened, `body(page)` run, the page's errors failures of `page.error`, the context always closed. What throws in a scene (the page did not open, its setup did not run, a wait did not come, axe did
 * not load) is a failure of `scene`, and NEVER of `assertion`, the one the scene is for (the line names it, so that a person sees which one did not get to look): a scene that threw has seen nothing, and an error recorded under that
 * assertion would be a detection by it for the negative control of that assertion (which plants a fault and must be seen BY the assertion), and would be dropped with it by ASSERTION_OFF, so that the control would pass for
 * what it did not look at (AGENTS 28). The one error that is the failure of an assertion is `Unsettled`: the page does not come to rest, which is what `settle` is for.
 */
async function scene({ browser, origin, viewport, where, assertion, name, query, body }) {
  count('scene');
  let opened;
  try {
    opened = await openPage(browser, origin, viewport, query);
    await body(opened.page);
  } catch (error) {
    if (error instanceof Unsettled) fail('settle', where, `${name}: ${firstLine(error)}`);
    else fail('scene', where, `${name}: ${firstLine(error)} (so ${assertion} did not get to look)`);
  } finally {
    if (opened !== undefined) {
      for (const message of opened.errors) fail('page.error', where, `${name}: ${message}`);
      await opened.context.close();
    }
  }
}

/** Runs the control's own perturbation of a page, when it is for this stage. */
async function plant(page, stage) {
  if (perturb === undefined || (perturb.stage ?? 'read') !== stage) return;
  if (perturb.css !== undefined) await page.addStyleTag({ content: perturb.css });
  if (perturb.page !== undefined) await page.evaluate(perturb.page);
}

/**
 * Waits until `read()` (in the page) gives the same value for `still` ms: a wait for something NOT to happen, which can only get weaker on a busy machine. A page that never comes to rest (a body that renders again for ever moves the
 * count at every read) must not hold the probe for ever, so the wait is bounded by the TOTAL time since the call, `limit`, and not by the time since the count last moved: every change starts that again, so a count that moves at every
 * read never reaches it. The limit is WAIT, the one overall wait that every other wait of this probe has against a page that never gets there (a count of changes is not a time, and no assertion here is about how long a wait took). A
 * count that is still moving at the limit throws `Unsettled`, which `scene` says is a failure of `settle`.
 */
async function quiet(page, read, still = 400, limit = WAIT) {
  const began = Date.now();
  let last = await page.evaluate(read);
  let since = began;
  count('settle');
  for (;;) {
    await sleep(100);
    const now = await page.evaluate(read);
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= still) {
      return;
    }

    if (Date.now() - began > limit) throw new Unsettled(`the page did not settle in ${String(limit / 1000)} s: what it counts kept moving (${String(last)})`);
  }
}

/** Waits for a condition in the page and says whether it came in time (false when it did not: the check that follows says what is wrong, where a timeout's stack would not). */
const until = (page, condition, arg, timeout = 8000) => page.waitForFunction(condition, arg, { timeout }).then(() => true, () => false);

/** What has settled: the commits of the window and the size of the document (development build), or the size of the document alone (production). */
const SETTLED = () => (window.__commits?.length ?? 0) * 1_000_000 + document.querySelectorAll('*').length;
const READ_COMMITS = () => ({ root: window.__commits.length, problems: window.__bodyCommits.problems.length, operations: window.__bodyCommits.operations.length });
const regionOf = (kind) => `[role="region"][aria-label="${LABEL[kind]}"]`;

/** `rows` rows seeded in a tool and the table on screen and still. */
async function prepare(page, kind, rows) {
  await page.evaluate(([name, many]) => window.__po.seed(name, many), [kind, rows]);
  await page.waitForSelector(regionOf(kind), { timeout: WAIT });
  await until(page, (many) => document.querySelectorAll('tbody > tr:not([aria-hidden])').length >= Math.min(many, 8), rows);
  await quiet(page, SETTLED, 500);
}

const footerOf = (page) => page.evaluate(() => document.querySelector('[data-shell-part="panelDeck"] [data-ov-part="footer"]')?.textContent ?? null);

// ---------------------------------------------------------------------------------------------------------------------------
// commits (development build): what a list that arrives costs, and what a change of one row costs.
async function commitsSection({ browser, engine, vpName, viewport, dev }) {
  const where = `${engine} ${vpName}`;
  for (const kind of KINDS) {
    const noun = kind;
    await scene({
      browser,
      origin: dev.origin,
      viewport,
      where,
      assertion: 'commits.arrive',
      name: `${kind} arrive`,
      query: `tool=${kind}`,
      body: async (page) => {
        await prepare(page, kind, SEED);
        const before = await page.evaluate(READ_COMMITS);
        const phasesFrom = before.root;
        await page.evaluate(([name, many]) => window.__po.arrive(name, many), [kind, BULK]);
        await until(page, ([name, total]) => window.__po.rows(name).length >= total, [kind, SEED + BULK]);
        await quiet(page, SETTLED, 500);
        const after = await page.evaluate(READ_COMMITS);
        const read = await page.evaluate(([name, from]) => ({ phases: window.__commits.slice(from).map((commit) => commit.phase), rows: window.__po.rows(name).length, footer: document.querySelector('[data-shell-part="panelDeck"] [data-ov-part="footer"]')?.textContent ?? null, mounted: document.querySelectorAll('tbody > tr:not([aria-hidden])').length }), [kind, phasesFrom]);
        const total = SEED + BULK;
        report.commits[`${where} ${kind}`] = { arrive: { root: after.root - before.root, body: after[kind] - before[kind], other: after[OTHER[kind]] - before[OTHER[kind]], phases: read.phases, footer: read.footer, mounted: read.mounted } };
        check('premise', where, read.rows === total && read.footer === `${String(total)} ${noun}`, () => `${kind} arrive: the model holds ${String(read.rows)} rows and the footer says ${JSON.stringify(read.footer)}, wanted ${String(total)} and "${String(total)} ${noun}": the list did not arrive, so the commits below are the commits of nothing`);
        check('commits.arrive', where, after.root - before.root === 1 && after[kind] - before[kind] === 1 && after[OTHER[kind]] === before[OTHER[kind]], () => `${String(BULK)} ${kind} arrived at a table of ${String(SEED)} rows that was on screen: ${String(after.root - before.root)} commits of the window (${read.phases.join(', ') || 'none'}) and ${String(after[kind] - before[kind])} of the body, wanted ONE of each`);
        await tick(page, kind, where);
      },
    });
  }

  // What a table that is not full costs when a list arrives, and what the first draw costs: recorded and not judged (the kit's table measures its own region when it grows, and when it is first drawn).
  if (CONTROL === '') {
    for (const [name, seeded] of [['grow', 3], ['first', 0]]) {
      for (const kind of KINDS) {
        await scene({
          browser,
          origin: dev.origin,
          viewport,
          where,
          assertion: 'premise',
          name: `${kind} ${name}`,
          query: `tool=${kind}`,
          body: async (page) => {
            if (seeded > 0) await prepare(page, kind, seeded);
            const before = await page.evaluate(READ_COMMITS);
            await page.evaluate(([n, many]) => window.__po.arrive(n, many), [kind, BULK]);
            await page.waitForSelector(regionOf(kind), { timeout: WAIT });
            await quiet(page, SETTLED, 700);
            const after = await page.evaluate(READ_COMMITS);
            const phases = await page.evaluate((from) => window.__commits.slice(from).map((commit) => commit.phase), before.root);
            report.commits[`${where} ${kind}`] = { ...report.commits[`${where} ${kind}`], [name]: { root: after.root - before.root, phases } };
          },
        });
      }
    }
  }
}

/** One row of 230 changes, in a page where the list has arrived: the commits, the cells that rendered, the nodes that changed. */
async function tick(page, kind, where) {
  const target = await page.evaluate(([name]) => {
    const rows = window.__po.rows(name);
    const at = rows.findIndex((row, index) => index >= 3 && row.key.startsWith('bulk'));
    return { key: rows[at].key, index: at };
  }, [kind]);
  // The columns of the table that were wrapped to count the calls of their `cell` (the table calls one to render a cell of a row: a row that renders once is one call for each of them).
  const columns = await page.evaluate((label) => window.__po.cells.watch(label), LABEL[kind]);
  const mounted = await page.evaluate(() => {
    let tagged = 0;
    for (const row of document.querySelectorAll('tbody > tr:not([aria-hidden])')) {
      row.__probe = true;
      tagged += 1;
    }

    const changed = (window.__changed = []);
    new MutationObserver((records) => {
      for (const record of records) {
        const node = record.target instanceof Element ? record.target : record.target.parentElement;
        const row = node?.closest('tbody > tr');
        changed.push(row === null || row === undefined ? `outside:${node?.closest('[data-shell-part]')?.getAttribute('data-shell-part') ?? node?.tagName ?? '?'}` : `row:${row.getAttribute('data-ov-index')}`);
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    return tagged;
  });
  const before = await page.evaluate(READ_COMMITS);
  await page.evaluate(([name, key]) => (name === 'operations' ? window.__po.tick(key, 77) : window.__po.change(key, 'Changed label')), [kind, target.key]);
  const said = await until(page, ([name, index]) => (document.querySelector(`tbody > tr[data-ov-index="${String(index)}"]`)?.textContent ?? '').includes(name === 'operations' ? '77 of 200' : 'Changed label'), [kind, target.index]);
  await quiet(page, SETTLED, 500);
  const after = await page.evaluate(READ_COMMITS);
  const read = await page.evaluate(() => ({
    cells: window.__po.cells.take(),
    changed: window.__changed.slice(),
    same: [...document.querySelectorAll('tbody > tr:not([aria-hidden])')].filter((row) => row.__probe === true).length,
    now: document.querySelectorAll('tbody > tr:not([aria-hidden])').length,
  }));
  await page.evaluate(() => window.__po.cells.stop());
  const keys = Object.keys(read.cells);
  const rowsChanged = [...new Set(read.changed.filter((entry) => entry.startsWith('row:')))];
  const outside = read.changed.filter((entry) => entry.startsWith('outside:'));
  report.commits[`${where} ${kind}`] = { ...report.commits[`${where} ${kind}`], tick: { root: after.root - before.root, body: after[kind] - before[kind], columns, cells: read.cells, rowsChanged, outside: outside.length, sameElements: read.same, mounted } };
  check('premise', where, columns > 0 && said && keys.length > 0, () => `${kind} tick: ${columns > 0 ? '' : 'the cells of the table could not be watched; '}${said ? '' : 'the row did not say the change; '}${keys.length === 0 ? 'no cell was rendered' : ''}: the counts below are the counts of a page that did nothing`);
  check('tick.commits', where, after.root - before.root === 1 && after[kind] - before[kind] === 1 && after[OTHER[kind]] === before[OTHER[kind]], () => `${kind}: one of ${String(SEED + BULK)} changed and the window made ${String(after.root - before.root)} commits (${String(after[kind] - before[kind])} in the body), wanted ONE of each`);
  check('tick.cells', where, keys.length === 1 && keys[0] === target.key && read.cells[target.key] === columns, () => `${kind}: one row changed (${target.key}) and the table rendered the cells of ${String(keys.length)} rows (${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', ...' : ''}) and called the cells of the changed row ${String(read.cells[target.key] ?? 0)} times, wanted that one row alone and one call for each of its ${String(columns)} columns`);
  check('tick.dom', where, read.same === mounted && read.now === mounted && rowsChanged.length === 1 && rowsChanged[0] === `row:${String(target.index)}` && outside.length === 0, () => `${kind}: ${String(read.same)} of the ${String(mounted)} mounted rows are the elements they were (${String(read.now)} are mounted now), the rows that changed are ${rowsChanged.join(', ') || 'none'} (wanted row:${String(target.index)} alone) and ${String(outside.length)} nodes changed outside the rows (${[...new Set(outside)].join(', ')})`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// hidden (development build): a tool nobody looks at costs nothing while its feed goes on.
const HIDING = [
  { name: 'another tool on screen', query: () => 'tool=terminal' },
  { name: 'the panel closed', query: (kind) => `tool=${kind}&open=0` },
  { name: 'the other tool on screen', query: (kind) => `tool=${OTHER[kind]}` },
];

async function hiddenSection({ browser, engine, vpName, viewport, dev }) {
  const where = `${engine} ${vpName}`;
  for (const kind of KINDS) {
    for (const hiding of HIDING) {
      const name = `${kind} hidden: ${hiding.name}`;
      await scene({
        browser,
        origin: dev.origin,
        viewport,
        where,
        assertion: 'hidden.cost',
        name,
        query: hiding.query(kind),
        body: async (page) => {
          await quiet(page, SETTLED, 500);
          await plant(page, 'hidden');
          // What each event is, what the tab may say of it (a count of errors is on the tab: ONE commit, in the tab), and what the model must hold after it (the feed went on).
          const events = kind === 'operations'
            ? [
              { what: '200 tasks arrive', run: () => window.__po.arrive('operations', 200), tab: false, held: () => window.__po.rows('operations').length === 200 },
              { what: 'one task ticks', run: () => window.__po.tick('bulk005', 9), tab: false, held: () => window.__po.operations.getSnapshot().rows.find((row) => row.id === 'bulk005')?.progress?.text === '9 of 200 files' },
            ]
            : [
              { what: '200 conditions that no tab counts arrive', run: () => window.__po.problems.set('info', window.__po.conditions(200, { prefix: 'info', severity: 'info' })), tab: false, held: () => window.__po.rows('problems').length === 200 },
              { what: '200 errors arrive', run: () => window.__po.arrive('problems', 200), tab: true, held: () => window.__po.rows('problems').length === 400 },
            ];
          for (const event of events) {
            await page.evaluate(() => {
              window.__hiddenChanges = [];
              window.__hiddenObserver?.disconnect();
              window.__hiddenObserver = new MutationObserver((records) => {
                for (const record of records) {
                  const node = record.target instanceof Element ? record.target : record.target.parentElement;
                  window.__hiddenChanges.push(node?.closest('[data-shell-part]')?.getAttribute('data-shell-part') ?? node?.tagName ?? '?');
                }
              });
              window.__hiddenObserver.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
            });
            const before = await page.evaluate(READ_COMMITS);
            await page.evaluate(event.run);
            await quiet(page, SETTLED, 500);
            const after = await page.evaluate(READ_COMMITS);
            const read = await page.evaluate(([label, held]) => ({
              changes: window.__hiddenChanges.slice(),
              regions: document.querySelectorAll(`[role="region"][aria-label="${label}"]`).length,
              held: new Function(`return (${held})()`)(),
            }), [LABEL[kind], event.held.toString()]);
            const inTab = read.changes.filter((part) => part === 'panelTools').length;
            const elsewhere = read.changes.filter((part) => part !== 'panelTools');
            const wantRoot = event.tab ? 1 : 0;
            report.hidden[`${where} ${name} ${event.what}`] = { root: after.root - before.root, body: after[kind] - before[kind], changes: read.changes.length, inTab, elsewhere: elsewhere.length, regions: read.regions, held: read.held };
            check('premise', where, read.held, () => `${name}: ${event.what}: the model does not hold what the feed said (the feed did not go on, or the model did not listen): the zeros below are the zeros of a quiet feed`);
            check('hidden.cost', where, after.root - before.root === wantRoot && after[kind] === before[kind] && elsewhere.length === 0 && (event.tab ? inTab > 0 : inTab === 0) && read.regions === 0, () => `${name}: ${event.what}: ${String(after.root - before.root)} commits of the window (wanted ${String(wantRoot)}${event.tab ? ', the tab\'s count' : ''}), ${String(after[kind] - before[kind])} in the body, ${String(read.changes.length)} nodes changed (${String(inTab)} in the tab strip, ${String(elsewhere.length)} elsewhere: ${[...new Set(elsewhere)].join(', ') || 'none'}) and ${String(read.regions)} regions of the tool in the document, wanted ${event.tab ? 'only the tab\'s' : 'none'}`);
          }

          // Back on screen, the tool says what arrived while it was hidden.
          await page.evaluate((name) => {
            window.__po.store.activateTool(name);
            window.__po.store.show();
          }, kind);
          await page.waitForSelector(regionOf(kind), { timeout: WAIT });
          const total = await page.evaluate((k) => window.__po.rows(k).length, kind);
          const said = await until(page, ([text]) => document.querySelector('[data-shell-part="panelDeck"] [data-ov-part="footer"]')?.textContent === text, [`${String(total)} ${kind}`]);
          check('hidden.back', where, said, () => `${name}: back on screen the footer does not read "${String(total)} ${kind}"`);
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// subscribers (development build): what a body holds while it is on screen, and what is held when the window goes.
async function subscribersSection({ browser, engine, vpName, viewport, dev }) {
  const where = `${engine} ${vpName}`;
  await scene({
    browser,
    origin: dev.origin,
    viewport,
    where,
    assertion: 'subscribers.body',
    name: 'subscribers',
    query: 'tool=terminal',
    body: async (page) => {
      await quiet(page, SETTLED, 500);
      const live = () => page.evaluate(() => {
        const held = window.__po.subscribers();
        return { problems: held.problems.live, operations: held.operations.live, feed: held.feed.live };
      });
      const base = await live();
      const rounds = [];
      for (const kind of KINDS) {
        for (let round = 1; round <= 3; round += 1) {
          await page.evaluate((name) => window.__po.store.activateTool(name), kind);
          await page.waitForSelector('[data-shell-part="panelDeck"] [data-shell-part="panelBody"]', { timeout: WAIT });
          await quiet(page, SETTLED, 300);
          const shown = await live();
          await page.evaluate(() => window.__po.store.activateTool('terminal'));
          await page.waitForSelector('[data-shell-part="panelDeck"] [data-shell-part="panelBody"]', { state: 'detached', timeout: WAIT });
          await quiet(page, SETTLED, 300);
          const hidden = await live();
          rounds.push({ kind, round, shown, hidden });
          const want = { ...base, [kind]: base[kind] + 1 };
          check('subscribers.body', where, JSON.stringify(shown) === JSON.stringify(want) && JSON.stringify(hidden) === JSON.stringify(base), () => `${kind} shown for the ${String(round)}th time: it holds ${JSON.stringify(shown)}, wanted ${JSON.stringify(want)} (one subscription more than ${JSON.stringify(base)}), and hidden again it holds ${JSON.stringify(hidden)}, wanted ${JSON.stringify(base)}`);
        }
      }

      // The window goes: its tree is unmounted. Nothing is held, and nothing hears what the producers say after it.
      await page.evaluate(() => window.__po.unmount());
      const after = await page.evaluate(() => window.__po.subscribers());
      const commits = await page.evaluate(() => window.__commits.length);
      await page.evaluate(() => {
        window.__po.problems.set('after', window.__po.conditions(50, { prefix: 'after' }));
        window.__po.feed.push([...window.__po.feed.feed.getSnapshot(), ...window.__po.records(50, 'after')]);
      });
      await sleep(300);
      const told = await page.evaluate(() => ({ subscribers: window.__po.subscribers(), commits: window.__commits.length, nodes: document.getElementById('root')?.querySelectorAll('*').length ?? 0 }));
      report.subscribers[where] = { base, rounds, afterUnmount: after, afterEvents: told.subscribers, commitsAfter: told.commits - commits, nodesAfter: told.nodes };
      const held = ['problems', 'operations', 'feed'].filter((name) => after[name].live !== 0 || after[name].added !== after[name].stopped);
      check('unmount.held', where, held.length === 0, () => `the window went and ${held.map((name) => `${name} still holds ${String(after[name].live)} (${String(after[name].added)} subscribed, ${String(after[name].stopped)} stopped)`).join(', ')}`);
      const heard = ['problems', 'operations', 'feed'].filter((name) => told.subscribers[name].heard !== 0);
      check('unmount.heard', where, heard.length === 0 && told.commits === commits && told.nodes === 0, () => `after the window went, ${heard.map((name) => `${name} told ${String(told.subscribers[name].heard)} listeners that had been stopped`).join(', ') || 'no stopped listener was told'}; ${String(told.commits - commits)} commits and ${String(told.nodes)} nodes after it (wanted none)`);
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// virtual: 200 rows are a few elements, and the keyboard reaches the last.
async function virtualSection({ browser, engine, vpName, viewport, production }) {
  const where = `${engine} ${vpName}`;
  for (const kind of KINDS) {
    await scene({
      browser,
      origin: production.origin,
      viewport,
      where,
      assertion: 'virtual.rows',
      name: `${kind} virtual`,
      query: `tool=${kind}`,
      body: async (page) => {
        await page.evaluate(([name, many]) => window.__po.arrive(name, many), [kind, BULK]);
        await page.waitForSelector(regionOf(kind), { timeout: WAIT });
        await quiet(page, SETTLED, 500);
        await plant(page, 'read');
        await quiet(page, SETTLED, 500);
        const rows = await page.evaluate((name) => window.__po.rows(name), kind);
        const read = () => page.evaluate((label) => {
          const region = document.querySelector(`[role="region"][aria-label="${label}"]`);
          const names = [...document.querySelectorAll('tbody > tr:not([aria-hidden])')].map((row) => row.getAttribute('data-ov-index'));
          return { mounted: names.length, first: names[0], last: names.at(-1), rowcount: document.querySelector('table')?.getAttribute('aria-rowcount') ?? null, top: region.scrollTop, height: region.clientHeight, scroll: region.scrollHeight };
        }, LABEL[kind]);
        const top = await read();
        report.virtual[`${where} ${kind}`] = { rows: rows.length, top };
        check('premise', where, rows.length === BULK && top.rowcount === String(BULK + 1), () => `${kind} virtual: the model holds ${String(rows.length)} rows and the table says aria-rowcount ${String(top.rowcount)}, wanted ${String(BULK)} and ${String(BULK + 1)}`);
        check('virtual.rows', where, top.mounted > 0 && top.mounted <= MAX_MOUNTED, () => `${kind}: ${String(top.mounted)} of ${String(BULK)} rows are mounted at the top (wanted 1 to ${String(MAX_MOUNTED)}): the table is not windowed`);

        // The keyboard on the region: End shows the last row, Home the first; the mounted rows stay a few.
        await page.locator(regionOf(kind)).focus();
        const lastName = rows.at(-1).name;
        await page.keyboard.press('End');
        const atEnd = await until(page, ([label, name]) => {
          const region = document.querySelector(`[role="region"][aria-label="${label}"]`);
          return region.scrollTop + region.clientHeight >= region.scrollHeight - 1 && [...document.querySelectorAll('tbody > tr:not([aria-hidden]) > td:first-child')].some((cell) => (cell.textContent ?? '').includes(name));
        }, [LABEL[kind], lastName]);
        await quiet(page, SETTLED, 400);
        const end = await read();
        const visible = await page.evaluate(([label, name]) => {
          const region = document.querySelector(`[role="region"][aria-label="${label}"]`).getBoundingClientRect();
          const cell = [...document.querySelectorAll('tbody > tr:not([aria-hidden]) > td:first-child')].find((candidate) => (candidate.textContent ?? '').includes(name));
          const box = cell?.getBoundingClientRect();
          return box !== undefined && box.top >= region.top - 1 && box.bottom <= region.bottom + 1;
        }, [LABEL[kind], lastName]);
        await page.keyboard.press('Home');
        const firstName = rows[0].name;
        const atTop = await until(page, ([label, name]) => document.querySelector(`[role="region"][aria-label="${label}"]`).scrollTop === 0 && [...document.querySelectorAll('tbody > tr:not([aria-hidden]) > td:first-child')].some((cell) => (cell.textContent ?? '').includes(name)), [LABEL[kind], firstName]);
        const home = await read();
        report.virtual[`${where} ${kind}`] = { ...report.virtual[`${where} ${kind}`], end, home };
        check('virtual.rows', where, end.mounted > 0 && end.mounted <= MAX_MOUNTED, () => `${kind}: ${String(end.mounted)} of ${String(BULK)} rows are mounted at the end (wanted 1 to ${String(MAX_MOUNTED)}): the table is not windowed`);
        check('virtual.last', where, atEnd && visible && atTop && home.top === 0, () => `${kind}: End ${atEnd ? 'put the last row in the document' : 'did not put the last row in the document'}${visible ? ' and in view' : ' and it is not in view'} (scrollTop ${String(end.top)}), Home ${atTop ? 'came back to the first' : 'did not come back to the first'} (scrollTop ${String(home.top)})`);
      },
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// geometry: the rectangles of the mock the reading can be trusted for.
const READ_BODY = () => {
  const round2 = (value) => Math.round(value * 100) / 100;
  const rect = (element) => {
    if (element === null || element === undefined) return null;
    const box = element.getBoundingClientRect();
    return [round2(box.x), round2(box.y), round2(box.width), round2(box.height)];
  };
  const deck = document.querySelector('[data-shell-part="panelDeck"]');
  const table = deck.querySelector('table');
  const footer = deck.querySelector('[data-ov-part="footer"]');
  const walker = footer === null ? null : document.createTreeWalker(footer, NodeFilter.SHOW_TEXT);
  let words = null;
  for (let node = walker?.nextNode(); node; node = walker.nextNode()) {
    if ((node.textContent ?? '').trim() !== '') {
      const range = document.createRange();
      range.selectNodeContents(node);
      words = range;
      break;
    }
  }

  const style = footer === null || words === null ? null : getComputedStyle(words.startContainer.parentElement);
  return {
    panel: rect(document.querySelector('[data-shell-part="panel"]')),
    deck: rect(deck),
    region: rect(table?.parentElement),
    head: rect(table?.querySelector('thead tr')),
    rows: [...(table?.querySelectorAll('tbody > tr:not([aria-hidden])') ?? [])].map(rect),
    footer: rect(footer),
    footerText: footer?.textContent ?? null,
    // The mock's count is the box that holds the words (16 px, the line), not the glyphs' own height: the element the text is in.
    footerWords: words === null ? null : [round2(words.startContainer.parentElement.getBoundingClientRect().x), round2(words.startContainer.parentElement.getBoundingClientRect().y), round2(words.startContainer.parentElement.getBoundingClientRect().width), round2(words.startContainer.parentElement.getBoundingClientRect().height)],
    footerPaint: style === null ? null : { color: style.color, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight },
  };
};

const READ_TABS = () => {
  const round2 = (value) => Math.round(value * 100) / 100;
  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return [round2(box.x), round2(box.y), round2(box.width), round2(box.height)];
  };
  const out = {};
  for (const tab of document.querySelectorAll('[data-shell-part="panelTools"] [role="tab"]')) {
    const badge = tab.querySelector('[data-shell-part="toolBadge"]');
    const label = tab.querySelector('span');
    const style = badge === null ? null : getComputedStyle(badge);
    out[tab.getAttribute('data-tab-id')] = {
      name: tab.getAttribute('aria-label') ?? tab.textContent,
      tab: rect(tab),
      label: label === null ? null : rect(label),
      badge: badge === null ? null : { kind: badge.getAttribute('data-kind'), tone: badge.getAttribute('data-tone'), rect: rect(badge), color: style.color, background: style.backgroundColor, radius: style.borderRadius, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight },
    };
  }

  return out;
};

async function geometrySection({ browser, engine, vpName, viewport, production }) {
  const where = `${engine} ${vpName}`;
  for (const kind of KINDS) {
    await scene({
      browser,
      origin: production.origin,
      viewport,
      where,
      assertion: 'geometry.row',
      name: `${kind} geometry`,
      query: `tool=${kind}`,
      body: async (page) => {
        await page.evaluate(([name, many]) => window.__po.arrive(name, many), [kind, 30]);
        await page.waitForSelector(regionOf(kind), { timeout: WAIT });
        await quiet(page, SETTLED, 500);
        await plant(page, 'read');
        await quiet(page, SETTLED, 300);
        const read = await page.evaluate(READ_BODY);
        report.geometry[`${where} ${kind}`] = read;
        if (SHOTS && engine === 'webkit') await page.screenshot({ path: path.join(SHOTS, `problems-operations-${kind}-${engine}-${vpName}.png`) });
        const rows = read.rows;
        count('geometry.row');
        for (const [index, row] of rows.entries()) near('geometry.row', where, `${kind} row ${String(index)} height`, MOCK.row, row[3]);
        for (let index = 1; index < rows.length; index += 1) near('geometry.row', where, `${kind} rows ${String(index - 1)} and ${String(index)}: the distance between their tops`, MOCK.row, rows[index][1] - rows[index - 1][1]);
        check('geometry.row', where, rows.length >= 8, () => `${kind}: ${String(rows.length)} rows are mounted, wanted at least 8 to measure`);
        near('geometry.head', where, `${kind} header row height`, MOCK.head, read.head?.[3]);
        // The lanes tile the body: the header at its top, the first row under the header, the footer at its bottom and under the table.
        const [, deckTop, , deckHeight] = read.deck;
        near('geometry.fill', where, `${kind} header top against the body's`, deckTop, read.head?.[1]);
        near('geometry.fill', where, `${kind} first row top against the header's bottom`, (read.head?.[1] ?? 0) + (read.head?.[3] ?? 0), rows[0]?.[1]);
        near('geometry.fill', where, `${kind} footer bottom against the body's bottom (the footer is the pane's last lane)`, deckTop + deckHeight, (read.footer?.[1] ?? 0) + (read.footer?.[3] ?? 0), 1);
        near('geometry.fill', where, `${kind} footer top against the table region's bottom`, (read.region?.[1] ?? 0) + (read.region?.[3] ?? 0), read.footer?.[1], 1);
        near('geometry.foot', where, `${kind} footer height`, MOCK.foot.height, read.footer?.[3]);
        check('geometry.foot', where, read.footerText === `30 ${kind}`, () => `${kind} footer says ${JSON.stringify(read.footerText)}, wanted "30 ${kind}"`);
        if (read.footerWords !== null && read.footer !== null) {
          near('geometry.foot', where, `${kind} footer words, from the footer's start`, MOCK.foot.dx, read.footerWords[0] - read.footer[0]);
          near('geometry.foot', where, `${kind} footer words, from the footer's top`, MOCK.foot.dy, read.footerWords[1] - read.footer[1]);
          near('geometry.foot', where, `${kind} footer words height`, MOCK.foot.textHeight, read.footerWords[3]);
        } else {
          fail('geometry.foot', where, `${kind}: the footer has no words`);
        }

        for (const prop of ['color', 'fontSize', 'fontWeight', 'lineHeight']) check('geometry.foot', where, read.footerPaint?.[prop] === MOCK.foot.paint[prop], () => `${kind} footer ${prop}: mock ${String(MOCK.foot.paint[prop])} ours ${String(read.footerPaint?.[prop])}`);
        if (kind === 'problems') await tabs(page, where);
      },
    });
  }
}

/** The tab strip in the states of the mock's `tab-badges`: a count of errors, a dot for warnings, a dot for a failure nobody read. */
async function tabs(page, where) {
  const settle = () => quiet(page, SETTLED, 300);
  await page.evaluate(() => window.__po.clear());
  await page.evaluate(() => window.__po.seed('problems', 2));
  await settle();
  await plant(page, 'read');
  const counted = await page.evaluate(READ_TABS);
  const count0 = counted.problems.badge;
  const label = counted.problems.label;
  check('geometry.tab', where, count0 !== null && count0.kind === 'count' && counted.problems.name === 'Problems 2 errors', () => `the Problems tab with two errors is named ${JSON.stringify(counted.problems.name)} and draws ${JSON.stringify(count0)}, wanted a count, named "Problems 2 errors"`);
  if (count0 !== null) {
    near('geometry.tab', where, 'the count: the distance from the label', MOCK.count.gap, count0.rect[0] - label[0] - label[2]);
    near('geometry.tab', where, 'the count: its height', MOCK.count.height, count0.rect[3]);
    near('geometry.tab', where, 'the count: its top against the label\'s', MOCK.count.top, count0.rect[1] - label[1]);
    for (const prop of ['color', 'fontSize', 'fontWeight', 'lineHeight']) check('geometry.tab', where, count0[prop] === MOCK.count.paint[prop], () => `the count's ${prop}: mock ${String(MOCK.count.paint[prop])} ours ${String(count0[prop])}`);
  }

  await page.evaluate(() => {
    window.__po.clear();
    window.__po.problems.set('warnings', window.__po.conditions(2, { prefix: 'w', severity: 'warning' }));
  });
  await settle();
  const warned = await page.evaluate(READ_TABS);
  const dots = [['the warning dot of Problems', warned.problems, MOCK.dot.warning, 'Problems, 2 warnings']];
  await page.evaluate(() => window.__po.fail('failure'));
  await settle();
  const failed = await page.evaluate(READ_TABS);
  dots.push(['the error dot of Operations', failed.operations, MOCK.dot.error, 'Operations, 1 unread failure']);
  for (const [what, tab, paint, name] of dots) {
    const dot = tab.badge;
    check('geometry.tab', where, dot !== null && dot.kind === 'dot' && tab.name === name, () => `${what}: the tab is named ${JSON.stringify(tab.name)} and draws ${JSON.stringify(dot)}, wanted a dot, named ${JSON.stringify(name)}`);
    if (dot === null) continue;
    near('geometry.tab', where, `${what}: its width`, MOCK.dot.width, dot.rect[2]);
    near('geometry.tab', where, `${what}: its height`, MOCK.dot.height, dot.rect[3]);
    near('geometry.tab', where, `${what}: the distance from the tab's top edge`, MOCK.dot.top, dot.rect[1] - tab.tab[1]);
    near('geometry.tab', where, `${what}: the distance from the tab's end edge`, MOCK.dot.end, tab.tab[0] + tab.tab[2] - dot.rect[0] - dot.rect[2]);
    check('geometry.tab', where, dot.background === paint.backgroundColor && dot.radius === paint.borderRadius, () => `${what}: fill ${dot.background} radius ${dot.radius}, mock ${paint.backgroundColor} ${paint.borderRadius}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// layout: what a long word does to a cell, in every column of both tools, as the table is when its words do not fit.
/**
 * Reads the table in the page: every text of every cell (header included) and every box in a cell, against the cell. A text that is wider than a box that clips it is CUT; it must be cut by a box that draws an ellipsis, which is a
 * block container whose line the text is in (a text inside an atomic inline box, such as the kit's status, is clipped by the cell without one). Content that is outside its own cell, after what clips it has clipped it, is under another
 * cell; and no two cells of a row overlap. The words a person cannot see (a visually hidden sentence) are not words of the table. `long` counts, for each column (`heads` names them), the texts of the BODY's cells that are longer
 * than their cell: the header's own texts are not counted.
 */
const READ_LAYOUT = () => {
  const round2 = (value) => Math.round(value * 100) / 100;
  const EPS = 0.5;
  const out = { rows: 0, texts: 0, long: [], heads: [], cut: 0, cutNoEllipsis: [], spills: [], overlaps: [], widths: [] };
  const boxOf = (element) => element.getBoundingClientRect();
  const innerOf = (element) => {
    const box = boxOf(element);
    return { left: box.left + element.clientLeft, right: box.left + element.clientLeft + element.clientWidth };
  };
  const unseen = (element, stop) => {
    for (let current = element; current && current !== stop; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.clipPath !== 'none' || style.visibility === 'hidden' || style.display === 'none') return true;
    }

    return false;
  };
  const name = (element) => `${element.tagName.toLowerCase()}${element.getAttribute('data-ov-role') === null ? '' : `[${element.getAttribute('data-ov-role')}]`}`;
  const read = (cell, where, column) => {
    const box = boxOf(cell);
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.textContent ?? '').trim() === '' || unseen(node.parentElement, cell.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0) continue;
      out.texts += 1;
      // A word longer than its cell, whatever clips it or does not (the premise: the long words are in the body of each column that draws words). `column` is given for a body cell only: a header is no data of the table.
      if (column !== undefined && (rect.right > box.right + EPS || rect.left < box.left - EPS)) out.long[column] = (out.long[column] ?? 0) + 1;
      let left = rect.left;
      let right = rect.right;
      let cutBy = null;
      for (let current = node.parentElement; current; current = current.parentElement) {
        if (getComputedStyle(current).overflowX !== 'visible') {
          const inner = innerOf(current);
          if (cutBy === null && (rect.right > inner.right + EPS || rect.left < inner.left - EPS)) cutBy = current;
          left = Math.max(left, inner.left);
          right = Math.min(right, inner.right);
        }

        if (current === cell) break;
      }

      if (cutBy !== null) {
        out.cut += 1;
        // The ellipsis is drawn by the block container the text is in: every box between the text and the box that clips it must be an inline box.
        let inline = true;
        for (let current = node.parentElement; current && current !== cutBy; current = current.parentElement) {
          if (getComputedStyle(current).display !== 'inline') inline = false;
        }

        const style = getComputedStyle(cutBy);
        if (style.textOverflow !== 'ellipsis' || !inline) out.cutNoEllipsis.push({ where, text: (node.textContent ?? '').slice(0, 24), cutBy: name(cutBy), textOverflow: style.textOverflow, inline });
      } else if (rect.right > box.right + EPS || rect.left < box.left - EPS) {
        out.spills.push({ where, text: (node.textContent ?? '').slice(0, 24), by: round2(Math.max(rect.right - box.right, box.left - rect.left)) });
      }

      if (right > box.right + EPS || left < box.left - EPS) out.spills.push({ where, text: (node.textContent ?? '').slice(0, 24), by: round2(Math.max(right - box.right, box.left - left)) });
    }

    // The boxes that are not words: glyphs, bars, buttons.
    for (const element of cell.querySelectorAll('*')) {
      const rect = boxOf(element);
      if ((rect.width === 0 && rect.height === 0) || unseen(element, cell.parentElement)) continue;
      let left = rect.left;
      let right = rect.right;
      for (let current = element.parentElement; current; current = current.parentElement) {
        if (getComputedStyle(current).overflowX !== 'visible') {
          const inner = innerOf(current);
          left = Math.max(left, inner.left);
          right = Math.min(right, inner.right);
        }

        if (current === cell) break;
      }

      if (right > box.right + EPS || left < box.left - EPS) out.spills.push({ where, element: name(element), by: round2(Math.max(right - box.right, box.left - left)) });
    }
  };
  const table = document.querySelector('[data-shell-part="panelDeck"] table');
  const heads = [...table.querySelectorAll('thead th')];
  out.heads = heads.map((cell) => (cell.textContent ?? '').trim());
  out.long = heads.map(() => 0);
  heads.forEach((cell, index) => read(cell, `head ${String(index)}`));
  out.widths = heads.map((cell) => round2(boxOf(cell).width));
  for (const [rowIndex, row] of [...table.querySelectorAll('tbody > tr:not([aria-hidden])')].entries()) {
    out.rows += 1;
    const cells = [...row.children];
    cells.forEach((cell, index) => read(cell, `row ${String(rowIndex)} cell ${String(index)}`, index));
    for (let a = 0; a < cells.length; a += 1) {
      for (let b = a + 1; b < cells.length; b += 1) {
        const first = boxOf(cells[a]);
        const second = boxOf(cells[b]);
        const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
        if (width > EPS) out.overlaps.push({ row: rowIndex, a, b, by: round2(width) });
      }
    }
  }

  const region = table.parentElement;
  out.region = { client: region.clientWidth, scroll: region.scrollWidth, left: region.scrollLeft };
  return out;
};

async function layoutSection({ browser, engine, vpName, viewport, production }) {
  const where = `${engine} ${vpName}`;
  for (const kind of KINDS) {
    await scene({
      browser,
      origin: production.origin,
      viewport,
      where,
      assertion: 'layout.clip',
      name: `${kind} layout`,
      query: `tool=${kind}`,
      body: async (page) => {
        await page.evaluate(([name]) => {
          window.__po.layout();
          return window.__po.arrive(name, 20);
        }, [kind]);
        await page.waitForSelector(regionOf(kind), { timeout: WAIT });
        await quiet(page, SETTLED, 500);
        await plant(page, 'read');
        await quiet(page, SETTLED, 300);
        const read = await page.evaluate(READ_LAYOUT);
        report.layout[`${where} ${kind}`] = { rows: read.rows, texts: read.texts, heads: read.heads, long: read.long, cut: read.cut, widths: read.widths, region: read.region, cutNoEllipsis: read.cutNoEllipsis.length, spills: read.spills.length, overlaps: read.overlaps.length };
        // The words that are longer than their cell are in the body of EACH column that draws words (not in the table in all, where they could all be in one column): the Condition, Source and Target of Problems, the Operation, Source,
        // Target and Progress of Operations. A column with none is a column where `layout.clip` and `layout.overlap` have nothing to see.
        const named = kind === 'problems' ? ['Condition', 'Source', 'Target'] : ['Operation', 'Source', 'Target', 'Progress'];
        const longIn = (column) => read.long[read.heads.indexOf(column)] ?? 0;
        const lacking = named.filter((column) => longIn(column) === 0);
        check('layout.premise', where, lacking.length === 0 && read.rows >= 5, () => `${kind}: the cells of the body with a word longer than their cell, by column: ${named.map((column) => `${column} ${String(longIn(column))}`).join(', ')} (in ${String(read.rows)} rows), wanted at least one in each${lacking.length === 0 ? '' : ` (none in ${lacking.join(', ')})`} and 5 rows: the long words are not in each of those columns, so a clipping defect there would not be seen`);
        check('layout.clip', where, read.cutNoEllipsis.length === 0, () => `${kind}: ${String(read.cutNoEllipsis.length)} words are cut with no ellipsis: ${read.cutNoEllipsis.slice(0, 3).map((entry) => `${entry.where} "${entry.text}" cut by ${entry.cutBy} (text-overflow ${entry.textOverflow}${entry.inline ? '' : ', the word is not in the cutter\'s own line'})`).join('; ')}`);
        check('layout.overlap', where, read.spills.length === 0 && read.overlaps.length === 0, () => `${kind}: ${String(read.overlaps.length)} pairs of cells overlap and ${String(read.spills.length)} contents are outside their cell: ${[...read.overlaps.slice(0, 2).map((entry) => `row ${String(entry.row)} cells ${String(entry.a)} and ${String(entry.b)} by ${String(entry.by)} px`), ...read.spills.slice(0, 3).map((entry) => `${entry.where} ${entry.text === undefined ? entry.element : `"${entry.text}"`} by ${String(entry.by)} px`)].join('; ')}`);
      },
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// a11y: axe-core on the panel.
async function a11ySection({ browser, engine, vpName, viewport, production, axe }) {
  const where = `${engine} ${vpName}`;
  const scenes = [
    ['Problems, with rows', 'problems', () => { window.__po.layout(); return window.__po.arrive('problems', 12); }],
    ['Problems, nothing to list', 'problems', () => undefined],
    ['Operations, with rows', 'operations', () => { window.__po.layout(); return window.__po.arrive('operations', 12); }],
    ['Operations, nothing to list', 'operations', () => undefined],
    ['Problems with rows, and the dot of a failure nobody read on the Operations tab', 'problems', () => { window.__po.layout(); window.__po.fail('failure'); return window.__po.arrive('problems', 12); }],
    ['Operations with rows, and the dot of warnings on the Problems tab', 'operations', () => { window.__po.problems.set('warnings', window.__po.conditions(2, { prefix: 'w', severity: 'warning' })); window.__po.layout(); return window.__po.arrive('operations', 12); }],
  ];
  for (const [name, tool, setup] of scenes) {
    await scene({
      browser,
      origin: production.origin,
      viewport,
      where,
      assertion: 'a11y',
      name,
      query: `tool=${tool}`,
      body: async (page) => {
        await page.evaluate(setup);
        if (!name.includes('nothing')) await page.waitForSelector(regionOf(tool), { timeout: WAIT });
        await quiet(page, SETTLED, 500);
        await plant(page, 'read');
        await page.addScriptTag({ content: axe });
        const result = await page.evaluate(() => axe.run(document.querySelector('[data-shell-part="panel"]'), { resultTypes: ['violations'] }).then((run) => run.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length, first: violation.nodes[0]?.html.slice(0, 120) }))));
        report.a11y[`${where} ${name}`] = result;
        check('a11y', where, result.length === 0, () => `${name}: ${result.map((violation) => `${violation.id} (${violation.impact}, ${String(violation.nodes)} nodes: ${violation.first})`).join('; ')}`);
      },
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// keyboard: real key presses and clicks; every control is a Tab stop (AGENTS 19, decision A14), and a press that opens something opens it once.
/** The element that has the focus, as a stop of the body: what it is, what it is called, whether it is in the body of the panel and in the panel. */
const FOCUSED = () => {
  const element = document.activeElement;
  return {
    tag: element?.tagName.toLowerCase() ?? null,
    name: element?.getAttribute('aria-label') ?? (element?.textContent ?? '').trim().slice(0, 40),
    region: element?.getAttribute('role') === 'region',
    row: element?.tagName === 'TR',
    inBody: element?.closest('[data-shell-part="panelDeck"]') !== null && element?.closest('[data-shell-part="panelDeck"]') !== undefined,
    inPanel: element?.closest('[data-shell-part="panel"]') !== null && element?.closest('[data-shell-part="panel"]') !== undefined,
    disabled: element?.getAttribute('aria-disabled') === 'true' || element?.disabled === true,
  };
};

async function keyboardSection({ browser, engine, vpName, viewport, production }) {
  const where = `${engine} ${vpName}`;
  for (const kind of KINDS) {
    await scene({
      browser,
      origin: production.origin,
      viewport,
      where,
      assertion: 'keys.stops',
      name: `${kind} keyboard`,
      query: `tool=${kind}`,
      body: async (page) => {
        await page.evaluate(() => window.__po.layout());
        await page.waitForSelector(regionOf(kind), { timeout: WAIT });
        await quiet(page, SETTLED, 500);
        await plant(page, 'read');
        const rows = await page.evaluate((name) => window.__po.rows(name), kind);
        const buttons = await page.evaluate(() => [...document.querySelectorAll('[data-shell-part="panelDeck"] tbody button')].map((button) => ({ name: button.getAttribute('aria-label'), index: Number(button.closest('tr').getAttribute('data-ov-index')), disabled: button.getAttribute('aria-disabled') === 'true', tab: button.tabIndex })));

        // The Tab stops of the body, from the tool's own tab to the end of the panel. Safari's default (macOS: "Press Tab to highlight each item" off) skips a button that has no `tabindex` attribute, and the kit's buttons carry none
        // (the panel's own tabs and Hide do): WebKit on macOS reaches every control with Option+Tab, and that is the traversal read there; everywhere else Tab reaches each one (the notices and palette probes read it the same way). What does not depend on the engine is read for each button: it is a stop (`tabIndex` 0), whatever key reaches it.
        await page.locator(`[data-shell-part="panelTools"] [role="tab"][data-tab-id="${kind}"]`).focus();
        const stops = [];
        const key = engine === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
        for (let press = 0; press < 120; press += 1) {
          await page.keyboard.press(key);
          const stop = await page.evaluate(FOCUSED);
          if (!stop.inPanel) break;
          if (stop.inBody) stops.push(stop);
        }

        const want = ['region', ...buttons.map((button) => button.name)];
        const got = stops.map((stop) => (stop.region ? 'region' : stop.name));
        report.keyboard[`${where} ${kind}`] = { stops: got.length, buttons: buttons.length };
        check('keys.stops', where, JSON.stringify(got) === JSON.stringify(want) && stops.every((stop) => !stop.row) && buttons.every((button) => button.tab >= 0), () => `${kind}: the Tab stops of the body (${buttons.filter((button) => button.tab < 0).length} of the buttons have a tabindex under 0) are ${JSON.stringify(got.slice(0, 8))}${got.length > 8 ? `... (${String(got.length)})` : ''}, wanted the table's region and the ${String(buttons.length)} buttons of its rows in order: ${JSON.stringify(want.slice(0, 8))}${want.length > 8 ? `... (${String(want.length)})` : ''}`);

        // Enter and Space on a row's Open button; a click on the row and a shift-click; a click on the button. Each opens ONCE, with the row's subject.
        const reset = () => page.evaluate(() => { window.__po.opened.length = 0; window.__po.cancelled.length = 0; });
        const opened = () => page.evaluate(() => window.__po.opened.map((entry) => ({ subject: entry.subject, modifiers: entry.modifiers })));
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        const open = buttons.filter((button) => button.name.startsWith('Open ') && !button.disabled);
        if (open.length < 3) fail('premise', where, `${kind}: ${String(open.length)} Open buttons that work, wanted 3 or more`);
        const press = async (button, key) => {
          await reset();
          await page.locator(`[data-shell-part="panelDeck"] tbody > tr[data-ov-index="${String(button.index)}"] button[aria-label="${button.name}"]`).focus();
          await page.keyboard.press(key);
          return opened();
        };
        const byEnter = await press(open[0], 'Enter');
        check('keys.open', where, byEnter.length === 1 && same(byEnter[0].subject, rows[open[0].index].subject) && byEnter[0].modifiers === '', () => `${kind}: Enter on "${open[0].name}" called open ${String(byEnter.length)} times with ${JSON.stringify(byEnter)}, wanted once with ${JSON.stringify(rows[open[0].index].subject)}`);
        const bySpace = await press(open[1], ' ');
        check('keys.open', where, bySpace.length === 1 && same(bySpace[0].subject, rows[open[1].index].subject), () => `${kind}: Space on "${open[1].name}" called open ${String(bySpace.length)} times with ${JSON.stringify(bySpace)}, wanted once with ${JSON.stringify(rows[open[1].index].subject)}`);
        await reset();
        await page.locator(`[data-shell-part="panelDeck"] tbody > tr[data-ov-index="${String(open[2].index)}"] > td:first-child`).click();
        const byRow = await opened();
        check('keys.open', where, byRow.length === 1 && same(byRow[0].subject, rows[open[2].index].subject) && byRow[0].modifiers === '', () => `${kind}: a click on the row of "${open[2].name}" called open ${String(byRow.length)} times with ${JSON.stringify(byRow)}, wanted once with ${JSON.stringify(rows[open[2].index].subject)}`);
        await reset();
        await page.locator(`[data-shell-part="panelDeck"] tbody > tr[data-ov-index="${String(open[2].index)}"] > td:first-child`).click({ modifiers: ['Shift'] });
        const byShift = await opened();
        check('keys.open', where, byShift.length === 1 && byShift[0].modifiers === 'shift' && same(byShift[0].subject, rows[open[2].index].subject), () => `${kind}: a shift-click on the row of "${open[2].name}" called open ${String(byShift.length)} times with ${JSON.stringify(byShift)}, wanted once with the shift and ${JSON.stringify(rows[open[2].index].subject)}`);
        await reset();
        await page.locator(`[data-shell-part="panelDeck"] tbody > tr[data-ov-index="${String(open[0].index)}"] button[aria-label="${open[0].name}"]`).click();
        const byButton = await opened();
        check('keys.open', where, byButton.length === 1 && same(byButton[0].subject, rows[open[0].index].subject), () => `${kind}: a click on the button "${open[0].name}" called open ${String(byButton.length)} times with ${JSON.stringify(byButton)}, wanted once`);

        // A row with no page of its own (a button that says why it does nothing, or no button) opens nothing.
        const none = rows.findIndex((row) => row.subject === undefined);
        if (none >= 0) {
          const row = page.locator(`[data-shell-part="panelDeck"] tbody > tr[data-ov-index="${String(none)}"]`);
          await reset();
          if ((await row.count()) === 1) {
            const button = row.locator('button[aria-label^="Open "]');
            if ((await button.count()) === 1) {
              await button.focus();
              await page.keyboard.press('Enter');
            }

            await row.locator('td').first().click();
            const nothing = await opened();
            check('keys.open', where, nothing.length === 0, () => `${kind}: a row with no page called open ${String(nothing.length)} times (Enter on its button, a click on the row), wanted none`);
          }
        }

        // Cancel.
        if (kind === 'operations') {
          const cancel = buttons.find((button) => button.name.startsWith('Cancel ') && !button.disabled);
          if (cancel === undefined) {
            fail('premise', where, 'operations: no Cancel button is on screen');
          } else {
            await reset();
            await page.locator(`[data-shell-part="panelDeck"] tbody > tr[data-ov-index="${String(cancel.index)}"] button[aria-label="${cancel.name}"]`).focus();
            await page.keyboard.press('Enter');
            const asked = await page.evaluate(() => window.__po.cancelled.slice());
            check('keys.cancel', where, asked.length === 1 && asked[0] === rows[cancel.index].key, () => `operations: Enter on "${cancel.name}" asked the host to cancel ${JSON.stringify(asked)}, wanted ["${rows[cancel.index].key}"]`);
          }
        }

        // The arrows' own scrolling: the region is a stop and PageDown scrolls it.
        await page.evaluate(([name, many]) => window.__po.arrive(name, many), [kind, BULK]);
        await quiet(page, SETTLED, 500);
        await page.locator(regionOf(kind)).focus();
        const top = await page.evaluate((label) => document.querySelector(`[role="region"][aria-label="${label}"]`).scrollTop, LABEL[kind]);
        await page.keyboard.press('PageDown');
        const moved = await until(page, ([label, from]) => document.querySelector(`[role="region"][aria-label="${label}"]`).scrollTop > from, [LABEL[kind], top]);
        check('keys.scroll', where, moved, () => `${kind}: PageDown on the table's region did not scroll it (scrollTop stayed ${String(top)})`);
      },
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
const production = [...SECTION_NAMES].some((section) => wants(section) && !DEV_SECTIONS.includes(section)) ? await serveFixtures(buildFixtures('production')) : null;
// React's development build is for the counts of commits (its Profiler calls nothing in a production build); every rectangle and every key is read from the production build.
const development = DEV_SECTIONS.some((section) => wants(section)) ? await serveFixtures(buildFixtures('development')) : null;
const axe = wants('a11y') ? readFileSync(AXE, 'utf8') : '';
report.seconds = {};

const startedAt = Date.now();
for (const engine of engineNames) {
  const browser = await launch(engine);
  const engineStart = Date.now();
  for (const vpName of viewportNames) {
    const viewport = VIEWPORTS[vpName];
    const context = { browser, engine, vpName, viewport, production, dev: development, axe };
    const sections = { commits: commitsSection, hidden: hiddenSection, subscribers: subscribersSection, virtual: virtualSection, geometry: geometrySection, layout: layoutSection, a11y: a11ySection, keyboard: keyboardSection };
    for (const [name, run] of Object.entries(sections)) {
      if (!wants(name) || (FIRST_VIEWPORT_ONLY.includes(name) && vpName !== viewportNames[0])) continue;
      const from = Date.now();
      await run(context);
      report.seconds[`${engine} ${name}`] = round((report.seconds[`${engine} ${name}`] ?? 0) + (Date.now() - from) / 1000);
    }

    console.log(engine, vpName, 'done');
  }

  await browser.close();
  report.seconds[engine] = Math.round((Date.now() - engineStart) / 1000);
}

production?.server.close();
development?.server.close();
const uptimeAtEnd = uptime();
console.log(`uptime at the start: ${uptimeAtStart}\nuptime at the end:   ${uptimeAtEnd}\nseconds: ${JSON.stringify(report.seconds)} (${String(Math.round((Date.now() - startedAt) / 1000))} in all)`);
if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify({ ...report, uptimeAtStart, uptimeAtEnd }, null, 2)}\n`);

console.log('\nassertion          result  checks');
for (const name of [...seen.keys()].sort()) {
  const failed = failures.filter((line) => line.startsWith(`${name} `)).length;
  console.log(`${name.padEnd(18)} ${failed === 0 ? 'ok    ' : 'FAIL  '} ${String(seen.get(name)).padStart(5)}${failed === 0 ? '' : `  ${String(failed)} failure(s)`}`);
}

if (CONTROL !== '') {
  const detected = failures.filter((line) => perturb.expected.test(line));
  const others = failures.filter((line) => !perturb.expected.test(line));
  console.log(`\nwhat the probe saw with the perturbation "${CONTROL}": ${String(failures.length)} differences\n${failures.slice(0, 12).map((line) => `  ${line.slice(0, 260)}`).join('\n')}`);
  console.log(`its assertion, to remove with ASSERTION_OFF: ${perturb.expected.source}`);
  // A control trips its own assertion and no other (AGENTS 28): a failure of another check in the run (a precondition that did not hold) fails the control, and a control that nothing sees is no detection.
  if (detected.length > 0 && others.length === 0) {
    console.log(`\nNEGATIVE CONTROL "${CONTROL}": detected (${String(detected.length)} differences, only in ${perturb.expected.source}, e.g. ${detected[0].slice(0, 200)})`);
    process.exit(0);
  }

  console.log(detected.length > 0 ? `\nNEGATIVE CONTROL "${CONTROL}": FAILED, ${String(others.length)} other failures (a control trips only its own assertion): ${others[0].slice(0, 200)}` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${String(failures.length)} other failures${failures.length === 0 ? '' : `, e.g. ${failures[0].slice(0, 200)}`})`);
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}

console.log('\nproblems and operations probe: no failures');
