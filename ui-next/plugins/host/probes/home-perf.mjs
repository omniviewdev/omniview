// What the Home page costs with TWO HUNDRED connections (HM2), measured in the page the way a person meets it: the real Home content (`HomeContent`, ui-next/plugins/host/homePage.tsx) over a fake host (home-fixture.tsx: a connection store whose
// connections the page can change, recents, actions that record the calls, one plugin) inside the real kit's theme, menu host and tooltip host, in WebKit and Chromium at 1440 x 900 (decision A15; no count here depends on the size of the window).
//
//   env -i HOME="$HOME" PATH="$PATH" FONT_DELAY_MS=40 node ui-next/shell/probes/home-perf-probe.mjs      (the wrapper CI runs: scripts/ci/probe-units/home.mjs says why there is one)      CONTROLS=1 lists the negative controls
//   ENGINES=webkit,chromium (default both; with a control, chromium)      PARTS=mount,keystroke,event,menu,idle,geometry      REPORT=<file>   the counts as JSON      FIXTURE_DIST_DEV=<dir>   probe an existing build of the fixture      BUILD_CACHE=<dir>   build once and read it afterwards
//   NEGATIVE_CONTROL=<name>   plant ONE fault (PERTURBATIONS, below) and exit 0 when the assertion the control is named for, and no other, failed      ASSERTION_OFF=<regex>   drops the failures whose line matches: it must be the pattern of the active control's own
//                             assertion (printed with the control's result), and the control must then print NOT DETECTED with no other failure: the same fault passes undetected when its assertion is removed (AGENTS 28)
//
// EVERY ASSERTION HERE IS A COUNT (commits, batches of DOM changes, nodes changed, timers, animation frames, boxes), and none depends on how fast the machine is: the runner is two to four times slower than a laptop and has a heavy tail, and a time
// asserted on it failed three pull requests (docs/ui-next/status/N25.md, section 4). Milliseconds are never asserted; the duration React reports for each commit is printed. The build is React's development build, in which a Profiler calls `onRender`
// (it does not in a production build); the page's own commits are `window.__pageCommits` (a commit that rendered something inside Home), the whole window's `window.__commits`. Each part runs in a page of its own. The waits end when a condition holds and
// are bounded (WAIT) only against a page that never gets there: nothing is judged by how long it took.
//
//   home.mount      the page with 200 connections mounts in ONE commit of the page (and one of the window) and the 200 rows reach the document in ONE batch of DOM changes (one MutationObserver delivery) and nowhere else: nothing in the page changes after it
//   home.keystroke  ONE character typed in the field is at least one commit and at most TWO (the field's own and, if the host defers the narrowing, the list's), and what it changes in the page is the rows that left and the rows that entered, and the field's own value:
//                   no row that stayed changes, none moves, and no other part of the page changes
//   home.event      ONE event for ONE connection (the store says it is another state: the word and the reason of its row) is ONE commit, and it changes no node outside that connection's row: no other row, no part of the page that is not a row
//   home.menu       the row's menu opened with the keyboard (Shift+F10 on a focused row) makes no commit of the page: the page is not drawn again to open a menu
//   home.idle       an idle Home for 3 s: no commit of the page or the window, no timer and no animation frame asked for and none run, no DOM change; in Chromium also no layout and no style recalculation (WebKit has no such counter)
//   home.geometry   with 200 names of more than eighty characters, no row's state word is pushed out of its row: the rows whose state's right edge is past the row's: 0 (and the names really are cut: the premise that the test is of long names)
//
// The numbers go to `report.home["<engine> 1440x900"]`.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedBuild } from '../../../../packages/kit/probes/build-cache.mjs';
import { ENGINES, launch, normalizeFont } from '../../../../packages/kit/probes/probe-lib.mjs';
import { NATIVE_VIEWPORTS, open, serveFixtures, sleep } from '../../../shell/probes/harness.mjs';
import { COUNT, PLUGIN, QUERY, SECOND_INDEX, TARGET_INDEX, keyOf } from './home-world.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const MAX_LOAD = 30;
/** The longest a wait for a condition may take: a bound against a page that never gets there. Nothing is judged by how long a wait took. */
const WAIT = 30_000;
const SETTLE = 500;
const IDLE_MS = 3000;
const VIEWPORT_NAME = '1440x900';
const PART_NAMES = ['mount', 'keystroke', 'event', 'menu', 'idle', 'geometry'];
const A = { mount: 'home.mount', keystroke: 'home.keystroke', event: 'home.event', menu: 'home.menu', idle: 'home.idle', geometry: 'home.geometry' };
/** A pixel of slack for a box that is laid out at a fraction. */
const EPSILON = 0.5;
/** The rows whose state word has to be clear of the name for the geometry part: the premise is that at least this many of the 200 long names really are cut. */
const MIN_CUT = 190;

const uptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
const load1 = (text) => Number(/load averages?:\s*([\d.]+)/.exec(text)?.[1] ?? 0);
const uptimeAtStart = uptime();
// On a machine other agents share, the run waits for it to be quiet (rule 27). On the runner (GITHUB_ACTIONS) nothing here is a time, so nothing waits there.
for (let waited = 0; process.env.GITHUB_ACTIONS !== 'true' && load1(uptime()) > MAX_LOAD; waited += 1) {
  if (waited >= 60) throw new Error(`the one-minute load average stayed above ${String(MAX_LOAD)} for an hour: no measurement was taken (${uptime()})`);
  console.log(`load average ${String(load1(uptime()))} is above ${String(MAX_LOAD)}: waiting a minute`);
  await sleep(60_000);
}

console.log(`uptime: ${uptime()}`);

const names = (key, all) => (process.env[key] === undefined || process.env[key] === '' ? all : process.env[key].split(','));
for (const [key, list, known] of [['ENGINES', names('ENGINES', []), Object.keys(ENGINES)], ['PARTS', names('PARTS', []), PART_NAMES]]) {
  const unknown = list.filter((name) => !known.includes(name));
  if (unknown.length > 0) throw new Error(`${key} names ${unknown.join(', ')}, which is not one of ${known.join(', ')}`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The negative controls (rule 28): each plants ONE fault in the loaded page or in what the probe does to it, and the probe must see it in the assertion the control is named for and in no other; with that assertion removed (ASSERTION_OFF=<its pattern>, which a
// control prints) the same fault must pass undetected. Each runs only the part it perturbs, in Chromium (the engine of the controls) unless ENGINES says more.
//   late-change   a connection changes its state right after the list came in: a second commit of the page, and a row that changes after the first batch
//   second-row    one event that tells the store of TWO connections: one commit that draws two rows, where the event was for one
//   key-commits   three more commits of the page in the keydown's own event of the character typed: more than two commits for a keystroke
//   idle-timer    a timer the page keeps while it is on screen, as a clock in a part would
//   push-out      a rule that gives the name its whole width: with 200 long names, the state word is pushed out of the row
const PERTURBATIONS = {
  'late-change': { parts: ['mount'], expected: /^home\.mount\b/ },
  'second-row': { parts: ['event'], expected: /^home\.event\b/ },
  'key-commits': { parts: ['keystroke'], expected: /^home\.keystroke\b/ },
  'idle-timer': { parts: ['idle'], expected: /^home\.idle\b/ },
  'push-out': { parts: ['geometry'], expected: /^home\.geometry\b/ },
};
if (process.env.CONTROLS === '1') {
  for (const [name, control] of Object.entries(PERTURBATIONS)) console.log(`${name.padEnd(14)} ${control.parts.join(',').padEnd(10)} ${control.expected.source}`);
  process.exit(0);
}

const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
if (CONTROL !== '' && PERTURBATIONS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);
const OFF = process.env.ASSERTION_OFF === undefined || process.env.ASSERTION_OFF === '' ? undefined : new RegExp(process.env.ASSERTION_OFF);
// ASSERTION_OFF is for a negative control and for the one assertion that control is named for: with no control, or with a pattern that is not the control's own, it would silence a run that really fails.
if (OFF !== undefined && (CONTROL === '' || OFF.source !== PERTURBATIONS[CONTROL].expected.source)) throw new Error(`ASSERTION_OFF must be the pattern of the active negative control's own assertion (NEGATIVE_CONTROL=${CONTROL === '' ? '<none>' : CONTROL}${CONTROL === '' ? '' : `, its pattern is ${PERTURBATIONS[CONTROL].expected.source}`})`);
const perturb = CONTROL === '' ? undefined : PERTURBATIONS[CONTROL];
const engineNames = names('ENGINES', CONTROL === '' ? Object.keys(ENGINES) : ['chromium']);
const parts = perturb === undefined ? names('PARTS', PART_NAMES) : perturb.parts;
const wants = (part) => parts.includes(part);

// ---------------------------------------------------------------------------------------------------------------------------
// The failures, by assertion: `fail` records what must hold (never thrown), `count` counts what was looked at, so that a summary can say how many things each assertion saw.
const failures = [];
const seen = new Map();
const fail = (assertion, where, what) => {
  const line = `${assertion} ${where}: ${what}`;
  if (OFF === undefined || !OFF.test(line)) failures.push(line);
};
const count = (assertion) => seen.set(assertion, (seen.get(assertion) ?? 0) + 1);
const round = (value) => Math.round(value * 10) / 10;
const firstLine = (error) => String(error?.message ?? error).split('\n')[0].slice(0, 300);

// ---------------------------------------------------------------------------------------------------------------------------
// Building and serving the fixture: the repository's own Vite configuration, so it is compiled and styled as the channel's build is (the React Compiler, CSS Modules, the cascade layers), in React's development build (the counts of commits).
const BUILD = `
import path from 'node:path';
import { build, loadConfigFromFile, mergeConfig } from 'vite';
const [repo, input, outDir, mode] = process.argv.slice(1);
const loaded = await loadConfigFromFile({ command: 'build', mode }, path.join(repo, 'vite.config.ts'));
if (loaded === null) throw new Error('vite.config.ts not found');
await build(mergeConfig(loaded.config, { configFile: false, logLevel: 'warn', mode, build: { outDir, emptyOutDir: true, minify: false, rollupOptions: { input: [input] } } }));
`;

function buildFixture() {
  const existing = process.env.FIXTURE_DIST_DEV;
  if (existing !== undefined && existing !== '') return existing;
  // React's development build is chosen by NODE_ENV; the `next` flavour is chosen by OMNIVIEW_UI. The build never sees the control the process runs.
  return sharedBuild({ kind: 'home-fixture', mode: 'development', build: (out, env) => execFileSync(process.execPath, ['--input-type=module', '-e', BUILD, repo, path.join(here, 'home-fixture.html'), out, 'development'], { cwd: repo, env: { ...env, OMNIVIEW_UI: 'next', NODE_ENV: 'development' }, stdio: 'pipe' }) });
}

const fixtureUrl = (origin, query = '') => `${origin}/plugins/host/probes/home-fixture.html${query === '' ? '' : `?${query}`}`;

// ---------------------------------------------------------------------------------------------------------------------------
// The page's side. Every function here is stringified into an init script (`script`): it runs in the page before the page's own scripts and uses nothing of this module.

/**
 * The mount, seen from before the page's own scripts run: every delivery of a MutationObserver that brought connection rows into the document is one batch of DOM changes, and every change inside Home after the first of them is `late`, by the row it
 * is in (`page` for a node of Home that is not in a row).
 */
function watchMount() {
  const batches = (window.__batches = []);
  const late = (window.__late = []);
  const ROW = '[data-home-part="connection"]';
  new MutationObserver((records) => {
    let rows = 0;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) rows += node.matches(ROW) ? 1 : node.querySelectorAll(ROW).length;
      }
    }

    if (rows > 0) {
      batches.push(rows);
      return;
    }

    if (batches.length === 0) return;
    for (const record of records) {
      const node = record.target instanceof Element ? record.target : record.target.parentElement;
      if (node !== null && node.closest('[data-home-fixture]') !== null) late.push(node.closest(ROW)?.getAttribute('data-ov-menu-key') ?? 'page');
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
}

/**
 * What a window of time costs, counted from outside the page's own work: every call that starts a frame, a timer or an idle callback, every callback of one that runs, every DOM mutation. Installed before the page's scripts, so that every call is seen.
 */
function countWork() {
  const work = (window.__work = { raf: 0, frames: 0, timeout: 0, timeouts: 0, interval: 0, intervals: 0, idle: 0, idles: 0, mutations: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    work.raf += 1;
    return raf((time) => {
      work.frames += 1;
      callback(time);
    });
  };

  const timeout = window.setTimeout.bind(window);
  window.setTimeout = (handler, delay, ...args) => {
    work.timeout += 1;
    return typeof handler === 'function'
      ? timeout((...inner) => {
        work.timeouts += 1;
        return handler(...inner);
      }, delay, ...args)
      : timeout(handler, delay, ...args);
  };

  const interval = window.setInterval.bind(window);
  window.setInterval = (handler, delay, ...args) => {
    work.interval += 1;
    return typeof handler === 'function'
      ? interval((...inner) => {
        work.intervals += 1;
        return handler(...inner);
      }, delay, ...args)
      : interval(handler, delay, ...args);
  };

  if (typeof window.requestIdleCallback === 'function') {
    const idle = window.requestIdleCallback.bind(window);
    window.requestIdleCallback = (callback, options) => {
      work.idle += 1;
      return idle((deadline) => {
        work.idles += 1;
        callback(deadline);
      }, options);
    };
  }

  new MutationObserver((list) => {
    work.mutations += list.length;
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}

/** The control `idle-timer`: a timer the page keeps while it is on screen. */
function keepATimer() {
  window.setInterval(() => undefined, 250);
}

/** The control `key-commits`: three more commits of the page in the event of every character typed (a lever of the fixture that forces a commit and draws nothing). */
function extraCommits() {
  document.addEventListener(
    'input',
    () => {
      for (let index = 0; index < 3; index += 1) window.__host.bump();
    },
    true,
  );
}

/** The text of an init script that runs `fn` in the page. */
const script = (fn) => `(${fn.toString()})();`;

// ---------------------------------------------------------------------------------------------------------------------------
const ROW = '[data-home-part="connection"]';
const keyAttribute = (index) => JSON.stringify([PLUGIN.id, keyOf(index)]);
const rowSelector = (index) => `${ROW}[data-ov-menu-key=${JSON.stringify(keyAttribute(index))}]`;

/** Waits for a condition in the page and says whether it came in time: false when it did not, and the check that follows says what is wrong, where a timeout's stack would not. */
const until = (page, condition, arg, timeout = 5000) => page.waitForFunction(condition, arg, { timeout }).then(() => true, () => false);

/**
 * Waits until a counter stops moving: `read()` in the page gives the same number for `still` ms. A page whose counter keeps moving for `limit` ms never settles and has no count to take: it throws, which the part reports as a failure of its assertion.
 */
async function quiet(page, read, still = 500, limit = WAIT) {
  let last = await page.evaluate(read);
  let since = Date.now();
  const end = since + limit;
  for (;;) {
    await sleep(100);
    const now = await page.evaluate(read);
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= still) {
      return;
    }

    if (Date.now() > end) throw new Error(`the page did not settle in ${String(limit / 1000)} s: what it counts kept moving (${String(last)})`);
  }
}

const COMMITS = () => window.__commits.length + window.__pageCommits.length;

async function perf({ browser, engine, origin, report }) {
  const viewport = NATIVE_VIEWPORTS[VIEWPORT_NAME];
  const where = `${engine} ${VIEWPORT_NAME}`;
  const result = { mount: null, keystroke: null, event: null, menu: null, idle: null, geometry: null, uptime: uptime() };
  report.home[where] = result;

  /** One part in a page of its own: opened by the harness, then `body(page, context)`. What throws is a failure of the part, the page's errors are failures, and the context is always closed. */
  async function section(name, assertion, query, { init, fonts = false }, body) {
    let opened;
    try {
      opened = await open(browser, fixtureUrl(origin, query), viewport, { init, waitFor: '[data-home-part="side"]' });
      if (fonts) await normalizeFont(opened.page, { rootVar: '--ov-font-ui' });
      await body(opened.page, opened.context);
    } catch (error) {
      fail(assertion, where, `${name}: ${firstLine(error)}`);
    } finally {
      if (opened !== undefined) {
        for (const message of opened.errors) fail(assertion, where, `${name}: page error: ${message}`);
        await opened.context.close();
      }
    }
  }

  const rowsIn = (page, want) => page.waitForFunction((n) => document.querySelectorAll('[data-home-part="connection"]').length >= n, want, { timeout: WAIT });

  // 1. mount: 200 connections, one commit, one batch.
  if (wants('mount')) {
    await section('mount', A.mount, `count=${String(COUNT)}`, { init: script(watchMount) }, async (page) => {
      await rowsIn(page, COUNT);
      // The control `late-change`: a connection changes its state right after the list came in.
      if (perturb !== undefined && CONTROL === 'late-change') {
        await page.evaluate(([key]) => window.__host.change([{ key, state: 'unreachable', reason: 'The server did not answer.' }]), [keyOf(TARGET_INDEX)]);
      }

      await quiet(page, COMMITS, 700);
      const read = await page.evaluate(() => ({
        page: window.__pageCommits.map((commit) => ({ phase: commit.phase, ms: commit.actualDuration })),
        window: window.__commits.length,
        batches: window.__batches.slice(),
        late: [...new Set(window.__late)],
        rows: document.querySelectorAll('[data-home-part="connection"]').length,
      }));
      result.mount = { pageCommits: read.page.map((commit) => commit.phase), windowCommits: read.window, batches: read.batches, rowsChangedAfterThat: read.late, rows: read.rows, commitMs: round(read.page[0]?.ms ?? 0) };
      console.log(`${where}: mounting ${String(read.rows)} connections: ${String(read.page.length)} commit of the page (${read.page.map((commit) => commit.phase).join(', ')}; ${String(result.mount.commitMs)} ms to render, reported), ${String(read.window)} of the window, ${String(read.batches.length)} batch of DOM changes (${read.batches.join(' + ')} rows), ${String(read.late.length)} changes after it`);
      count(A.mount);
      if (read.rows !== COUNT) fail(A.mount, where, `${String(read.rows)} rows are in the document, the host lists ${String(COUNT)}`);
      if (read.batches.length !== 1 || read.batches[0] !== COUNT) fail(A.mount, where, `the rows reached the document in ${String(read.batches.length)} batches of ${read.batches.join(' + ') || 'none'}, wanted one batch of ${String(COUNT)}`);
      if (read.page.length !== 1 || read.page[0].phase !== 'mount') fail(A.mount, where, `the page made ${String(read.page.length)} commits (${read.page.map((commit) => commit.phase).join(', ') || 'none'}), wanted ONE, of the phase mount`);
      if (read.window !== 1) fail(A.mount, where, `the window made ${String(read.window)} commits, wanted one`);
      if (read.late.length > 0) fail(A.mount, where, `${read.late.length} parts changed after the rows were in (${read.late.slice(0, 3).join(', ')}): the list came in once and the page was not still`);
    });
  }

  // 2. keystroke: one character in the field, at most two commits, and only the rows that left or entered change.
  if (wants('keystroke')) {
    const init = perturb !== undefined && CONTROL === 'key-commits' ? script(extraCommits) : undefined;
    await section('keystroke', A.keystroke, `count=${String(COUNT)}`, { init }, async (page) => {
      await rowsIn(page, COUNT);
      await quiet(page, COMMITS, 700);
      await page.focus('input[data-home-part="search"]');
      await quiet(page, COMMITS, 300);
      await page.evaluate(() => {
        const rows = new Map([...document.querySelectorAll('[data-home-part="connection"]')].map((row) => [row.getAttribute('data-ov-menu-key'), row]));
        window.__keyBefore = { ids: [...rows.keys()], page: window.__pageCommits.length, window: window.__commits.length };
        const changed = (window.__keyChanged = []);
        const ROW = '[data-home-part="connection"]';
        // The field is the search field's own box: the input, the glyph and the clear button it shows once it holds text.
        const field = document.querySelector('input[data-home-part="search"]').parentElement;
        const describe = (node) => (node instanceof Element ? `${node.tagName.toLowerCase()}${node.getAttribute('data-home-part') === null ? '' : `[${node.getAttribute('data-home-part')}]`}` : `#${node.nodeName}`);
        new MutationObserver((records) => {
          for (const record of records) {
            const target = record.target instanceof Element ? record.target : record.target.parentElement;
            const inRow = target === null ? null : target.closest(ROW);
            if (record.type === 'childList' && inRow === null && !field.contains(target)) {
              // Rows added to or taken out of their list; anything else added or removed outside a row is another part changing.
              for (const [list, nodes] of [['added', record.addedNodes], ['removed', record.removedNodes]]) {
                for (const node of nodes) changed.push(node instanceof Element && node.matches(ROW) ? { kind: list, id: node.getAttribute('data-ov-menu-key') } : { kind: 'other', what: `${list} ${describe(node)} in ${describe(target)}` });
              }
            } else if (target !== null && field.contains(target)) {
              changed.push({ kind: 'field' });
            } else if (inRow !== null) {
              const what = `${record.type} ${describe(record.target)}${record.attributeName === null ? '' : ` ${record.attributeName}`}`;
              // The row that is the list's one Tab stop (a roving group) says so on its button: when the rows change, the stop is on a row that is there.
              changed.push({ kind: record.type === 'attributes' && record.attributeName === 'tabindex' && record.target === inRow ? 'stop' : 'in-row', id: inRow.getAttribute('data-ov-menu-key'), what });
            } else {
              changed.push({ kind: 'other', what: `${record.type} ${describe(record.target)}${record.attributeName === null ? '' : ` ${record.attributeName}`}` });
            }
          }
        }).observe(document.querySelector('[data-home-fixture]'), { childList: true, subtree: true, attributes: true, characterData: true });
      });
      await page.keyboard.press(QUERY);
      const narrowed = await until(page, () => document.querySelectorAll('[data-home-part="connection"]').length < window.__keyBefore.ids.length, undefined, WAIT);
      await quiet(page, COMMITS, 400);
      const read = await page.evaluate(() => ({
        page: window.__pageCommits.slice(window.__keyBefore.page).map((commit) => commit.actualDuration),
        window: window.__commits.length - window.__keyBefore.window,
        changed: window.__keyChanged.slice(),
        before: window.__keyBefore.ids,
        after: [...document.querySelectorAll('[data-home-part="connection"]')].map((row) => row.getAttribute('data-ov-menu-key')),
        value: document.querySelector('input[data-home-part="search"]')?.value ?? null,
      }));
      const after = new Set(read.after);
      const before = new Set(read.before);
      const left = read.before.filter((id) => !after.has(id));
      const entered = read.after.filter((id) => !before.has(id));
      const removed = new Set(read.changed.filter((change) => change.kind === 'removed').map((change) => change.id));
      const added = new Set(read.changed.filter((change) => change.kind === 'added').map((change) => change.id));
      // A row that stayed and was taken out of the list and put back (moved) is a node that changed.
      const moved = [...removed].filter((id) => after.has(id) && before.has(id));
      const stayedChanged = [...new Set(read.changed.filter((change) => change.kind === 'in-row' && after.has(change.id) && before.has(change.id)).map((change) => change.id))];
      const others = read.changed.filter((change) => change.kind === 'other');
      const stops = [...new Set(read.changed.filter((change) => change.kind === 'stop' && after.has(change.id) && before.has(change.id)).map((change) => change.id))];
      result.keystroke = { pageCommits: read.page.length, windowCommits: read.window, rowsBefore: read.before.length, rowsAfter: read.after.length, left: left.length, entered: entered.length, moved: moved.length, stayedChanged: stayedChanged.length, tabStopMoved: stops.length, other: others.length, nodesChanged: read.changed.length, commitMs: read.page.map(round) };
      console.log(`${where}: one character typed in the field (${JSON.stringify(QUERY)}): ${String(read.page.length)} commits of the page, ${String(read.window)} of the window; ${String(left.length)} rows left, ${String(entered.length)} entered, ${String(moved.length)} moved, ${String(stayedChanged.length)} of the rows that stayed changed (and ${String(stops.length)} took the list's one Tab stop), ${String(others.length)} other parts changed, ${String(read.changed.length)} changes in all`);
      count(A.keystroke);
      if (!narrowed || read.value !== QUERY) fail(A.keystroke, where, `the character was not entered and did not narrow the list (the field holds ${JSON.stringify(read.value)}, ${String(read.after.length)} of ${String(read.before.length)} rows are left): the counts below would be the counts of a page that did nothing`);
      if (read.page.length < 1 || read.page.length > 2) fail(A.keystroke, where, `a character typed in the field cost ${String(read.page.length)} commits of the page, wanted at least one and at most two`);
      if (read.window > 2) fail(A.keystroke, where, `a character typed in the field cost ${String(read.window)} commits of the window, wanted at most two`);
      if (left.length === 0 || read.after.length === 0) fail(A.keystroke, where, `the character left ${String(left.length)} rows out and ${String(read.after.length)} in: a keystroke that narrows to nothing, or to everything, is not the case measured`);
      const gone = new Set(left);
      if ([...removed].some((id) => !gone.has(id) && !moved.includes(id)) || left.some((id) => !removed.has(id))) fail(A.keystroke, where, `the rows taken out of the document are not the rows that left (${String(removed.size)} taken out, ${String(left.length)} left)`);
      if (entered.some((id) => !added.has(id))) fail(A.keystroke, where, `${String(entered.filter((id) => !added.has(id)).length)} rows that entered were not put into the document`);
      if (moved.length > 0) fail(A.keystroke, where, `${String(moved.length)} rows that stayed were taken out and put back (moved): ${moved.slice(0, 2).join(' ')}`);
      if (stayedChanged.length > 0) fail(A.keystroke, where, `${String(stayedChanged.length)} rows that stayed changed inside (${stayedChanged.slice(0, 2).join(' ')}: ${[...new Set(read.changed.filter((change) => change.kind === 'in-row' && stayedChanged.includes(change.id)).map((change) => change.what))].slice(0, 4).join('; ')}): a keystroke changes the rows that left and the rows that entered`);
      if (stops.length > 1) fail(A.keystroke, where, `${String(stops.length)} rows that stayed took the list's Tab stop (${stops.slice(0, 3).join(' ')}), wanted at most one: the list has one`);
      if (others.length > 0) fail(A.keystroke, where, `${String(others.length)} parts of the page that are not rows changed (${[...new Set(others.map((change) => change.what))].slice(0, 3).join('; ')})`);
    });
  }

  // 3. event: one event for one connection, one commit, no node outside its row.
  if (wants('event')) {
    await section('event', A.event, `count=${String(COUNT)}`, {}, async (page) => {
      await rowsIn(page, COUNT);
      await quiet(page, COMMITS, 700);
      const target = rowSelector(TARGET_INDEX);
      const wordOf = (index) => page.evaluate((selector) => document.querySelector(`${selector} [data-ov-role]`)?.textContent ?? null, rowSelector(index));
      const wasWord = await wordOf(TARGET_INDEX);
      await page.evaluate(() => {
        const changed = (window.__changed = []);
        window.__noop = 0;
        const describe = (node) => (node instanceof Element ? `${node.tagName.toLowerCase()}${node.getAttribute('data-home-part') === null ? '' : `[${node.getAttribute('data-home-part')}]`}` : `#${node.nodeName}`);
        new MutationObserver((records) => {
          // An attribute that ends a delivery with the value it began it with has not changed, however often it was written (React writes a field's name and type again when it draws it again): the writes are counted and are not changes.
          const first = new Map();
          for (const record of records) {
            if (record.type !== 'attributes') continue;
            if (!first.has(record.target)) first.set(record.target, new Map());
            if (!first.get(record.target).has(record.attributeName)) first.get(record.target).set(record.attributeName, record.oldValue);
          }

          for (const record of records) {
            if (record.type === 'attributes' && record.target.getAttribute(record.attributeName) === first.get(record.target).get(record.attributeName)) {
              window.__noop += 1;
              continue;
            }

            const node = record.target instanceof Element ? record.target : record.target.parentElement;
            changed.push({ row: node?.closest('[data-home-part="connection"]')?.getAttribute('data-ov-menu-key') ?? null, what: `${record.type} ${describe(record.target)}${record.attributeName === null ? '' : ` ${record.attributeName}`}` });
          }
        }).observe(document.querySelector('[data-home-fixture]'), { childList: true, subtree: true, attributes: true, attributeOldValue: true, characterData: true });
        window.__before = { page: window.__pageCommits.length, window: window.__commits.length };
      });
      // The control `second-row`: the store tells of a second connection in the same event, so that the one commit draws two rows.
      const changes = [{ key: keyOf(TARGET_INDEX), state: 'unreachable', reason: 'The server did not answer.' }];
      if (CONTROL === 'second-row') changes.push({ key: keyOf(SECOND_INDEX), state: 'unreachable', reason: 'The server did not answer.' });
      await page.evaluate((list) => window.__host.change(list), changes);
      // The row says what the store told (a wait for the condition, not for a time), and then the page is still for a while: the commits and the changed nodes are counted once nothing more comes.
      const said = await until(page, ([selector, was]) => (document.querySelector(`${selector} [data-ov-role]`)?.textContent ?? was) !== was, [target, wasWord]);
      await quiet(page, COMMITS, 300);
      const read = await page.evaluate(() => ({ page: window.__pageCommits.length - window.__before.page, window: window.__commits.length - window.__before.window, changed: window.__changed.slice(), noop: window.__noop, commitMs: window.__pageCommits.at(-1)?.actualDuration ?? 0 }));
      const word = await wordOf(TARGET_INDEX);
      const key = keyAttribute(TARGET_INDEX);
      const rows = [...new Set(read.changed.filter((change) => change.row !== null).map((change) => change.row))];
      const outside = read.changed.filter((change) => change.row !== key);
      result.event = { pageCommits: read.page, windowCommits: read.window, rowsChanged: rows.length, nodesChanged: read.changed.length, nodesOutsideTheRow: outside.length, attributesWrittenAsTheyWere: read.noop, word: [wasWord, word], commitMs: round(read.commitMs) };
      console.log(`${where}: one event for one connection (${wasWord} to ${word}): ${String(read.page)} commit of the page, ${String(read.window)} of the window, ${String(read.changed.length)} nodes changed, in ${String(rows.length)} row, ${String(outside.length)} outside it (and ${String(read.noop)} attributes written with the value they had)`);
      count(A.event);
      if (!said || word === wasWord) fail(A.event, where, `the event changed nothing the row says (${JSON.stringify(wasWord)} is still ${JSON.stringify(word)}): the counts below would be the counts of a page that did nothing`);
      if (read.page !== 1 || read.window !== 1) fail(A.event, where, `the event cost ${String(read.page)} commits in the page and ${String(read.window)} in the window, wanted one each`);
      if (outside.length > 0) fail(A.event, where, `${String(outside.length)} nodes changed outside the row of ${key} (the rows that changed: ${rows.join(', ') || 'none'}; ${String(read.changed.filter((change) => change.row === null).length)} are not in a row: ${[...new Set(outside.map((change) => change.what))].slice(0, 4).join('; ')})`);
      if (rows.length !== 1 || rows[0] !== key) fail(A.event, where, `the rows that changed are ${rows.join(', ') || 'none'}, wanted ${key} alone`);
    });
  }

  // 4. menu: the row's menu opened with the keyboard is no commit of the page.
  if (wants('menu')) {
    await section('menu', A.menu, `count=${String(COUNT)}`, {}, async (page) => {
      await rowsIn(page, COUNT);
      await quiet(page, COMMITS, 700);
      await page.focus(rowSelector(TARGET_INDEX));
      await quiet(page, COMMITS, 500);
      await page.evaluate(() => {
        window.__before = { page: window.__pageCommits.length, window: window.__commits.length };
      });
      await page.keyboard.press('Shift+F10');
      const opened = await until(page, () => document.querySelector('[role="menu"]') !== null, undefined, WAIT);
      await quiet(page, COMMITS, 500);
      const read = await page.evaluate(() => ({ page: window.__pageCommits.length - window.__before.page, window: window.__commits.length - window.__before.window, items: [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((item) => item.textContent) }));
      result.menu = { pageCommits: read.page, windowCommits: read.window, items: read.items };
      console.log(`${where}: the row's menu opened with Shift+F10 (${read.items.join(', ')}): ${String(read.page)} commits of the page, ${String(read.window)} of the window`);
      count(A.menu);
      if (!opened) fail(A.menu, where, 'Shift+F10 on a focused row did not open a menu: the count below would be the count of a page that did nothing');
      if (read.page !== 0) fail(A.menu, where, `opening the row's menu cost ${String(read.page)} commits of the page, wanted none`);
    });
  }

  // 5. idle: after the page has settled, nothing runs. The engine's layout and style counters come from the DevTools protocol in Chromium.
  if (wants('idle')) {
    const init = script(countWork) + (CONTROL === 'idle-timer' ? script(keepATimer) : '');
    await section('idle', A.idle, `count=${String(COUNT)}`, { init }, async (page, context) => {
      const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
      if (cdp !== null) await cdp.send('Performance.enable');
      await rowsIn(page, COUNT);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      let settled = true;
      try {
        await quiet(page, () => window.__commits.length + window.__work.timeout + window.__work.raf + window.__work.mutations, 700);
      } catch {
        settled = false;
      }

      await sleep(SETTLE);
      const read = async () => {
        const work = await page.evaluate(() => ({ ...window.__work, commits: window.__commits.length, pageCommits: window.__pageCommits.length }));
        if (cdp === null) return work;
        const { metrics } = await cdp.send('Performance.getMetrics');
        const named = Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
        return { ...work, layouts: named.LayoutCount, styleRecalcs: named.RecalcStyleCount };
      };

      const from = await read();
      await sleep(IDLE_MS);
      const to = await read();
      const spent = Object.fromEntries(Object.keys(from).map((key) => [key, to[key] - from[key]]));
      result.idle = { settled, windowMs: IDLE_MS, ...spent };
      count(A.idle);
      console.log(`${where}: Home idle for ${String(IDLE_MS / 1000)} s: ${Object.entries(spent).map(([key, value]) => `${String(value)} ${key}`).join(', ')}`);
      if (!settled) fail(A.idle, where, `the page did not settle in ${String(WAIT / 1000)} s (its commits, timers, frames and DOM changes kept moving): there is no idle to measure`);
      if (!(await page.evaluate(() => document.querySelector('[data-home-part="connection"]') !== null))) fail(A.idle, where, 'the page is not on screen: an empty window is idle too');
      for (const [key, value] of Object.entries(spent)) if (value !== 0) fail(A.idle, where, `${String(value)} ${key} in ${String(IDLE_MS / 1000)} s after the page settled, wanted none (${JSON.stringify(spent)})`);
      if (cdp === null) report.notes.push(`${where}: WebKit has no layout or style counter: commits, timers, frames and DOM changes only`);
    });
  }

  // 6. geometry: with 200 long names, the state word stays in its row.
  if (wants('geometry')) {
    await section('geometry', A.geometry, `count=${String(COUNT)}&names=long`, { fonts: true }, async (page) => {
      await rowsIn(page, COUNT);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      // The premise, read before anything is planted: the names really are cut, so that the test is of names that do not fit.
      const cut = await page.evaluate(() => [...document.querySelectorAll('[data-home-part="connection"]')].filter((row) => {
        const line = row.querySelector('[data-ov-clip]');
        return line !== null && line.scrollWidth > line.clientWidth;
      }).length);
      // The control `push-out`: a rule that gives the name its whole width, planted right before the boxes are read: the row cannot hold it and the state word.
      if (CONTROL === 'push-out') {
        await page.evaluate(() => {
          const style = document.createElement('style');
          style.textContent = '[data-home-part="connection"] > :nth-child(2) { min-inline-size: max-content !important; flex-shrink: 0 !important; } [data-home-part="connection"] [data-ov-clip] { overflow: visible !important; }';
          document.head.append(style);
        });
      }

      const read = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-home-part="connection"]')];
        const pushed = [];
        const stateless = [];
        for (const row of rows) {
          const box = row.getBoundingClientRect();
          const state = row.querySelector('[data-ov-role]');
          if (state === null) {
            stateless.push(row.getAttribute('data-ov-menu-key'));
            continue;
          }

          const edge = state.getBoundingClientRect();
          if (edge.right > box.right + 0.5) pushed.push({ id: row.getAttribute('data-ov-menu-key'), over: Math.round((edge.right - box.right) * 10) / 10 });
        }

        return { rows: rows.length, pushed, stateless, width: rows[0]?.getBoundingClientRect().width ?? 0 };
      });
      result.geometry = { rows: read.rows, cut, pushedOut: read.pushed.length, withNoState: read.stateless.length, rowWidth: Math.round(read.width) };
      console.log(`${where}: ${String(read.rows)} rows with long names (${String(cut)} of them cut, ${String(Math.round(read.width))} px wide): ${String(read.pushed.length)} rows whose state word is pushed out of the row`);
      count(A.geometry);
      if (read.rows !== COUNT) fail(A.geometry, where, `${String(read.rows)} rows are in the document, the host lists ${String(COUNT)}`);
      if (read.stateless.length > 0) fail(A.geometry, where, `${String(read.stateless.length)} rows have no state word`);
      if (cut < MIN_CUT) fail(A.geometry, where, `only ${String(cut)} of the ${String(read.rows)} long names are cut (wanted ${String(MIN_CUT)}): the names fit, and the test is not of long names`);
      if (read.pushed.length > 0) fail(A.geometry, where, `${String(read.pushed.length)} rows have their state word out of the row (the first: ${read.pushed[0].id} by ${String(read.pushed[0].over)} px), wanted none`);
    });
  }

  result.uptimeAfter = uptime();
}

// ---------------------------------------------------------------------------------------------------------------------------
const report = { home: {}, notes: [], seconds: {} };
const development = await serveFixtures(buildFixture());
const startedAt = Date.now();
for (const engine of engineNames) {
  const browser = await launch(engine);
  const engineStart = Date.now();
  await perf({ browser, engine, origin: development.origin, report });
  console.log(engine, VIEWPORT_NAME, 'done');
  await browser.close();
  report.seconds[engine] = Math.round((Date.now() - engineStart) / 1000);
}

development.server.close();
const uptimeAtEnd = uptime();
console.log(`uptime at the start: ${uptimeAtStart}\nuptime at the end:   ${uptimeAtEnd}\nseconds: ${JSON.stringify(report.seconds)} (${String(Math.round((Date.now() - startedAt) / 1000))} in all)`);
for (const note of report.notes) console.log(`note: ${note}`);
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
  // A control trips its own assertion and no other (rule 28): a failure of another check in the run (a precondition that did not hold) fails the control, and a control that nothing sees is no detection.
  if (detected.length > 0 && others.length === 0) {
    console.log(`\nNEGATIVE CONTROL "${CONTROL}": detected (${String(detected.length)} differences, only in ${perturb.expected.source}, e.g. ${detected[0].slice(0, 200)})`);
    process.exit(0);
  }

  console.log(detected.length > 0 ? `\nNEGATIVE CONTROL "${CONTROL}": FAILED, ${String(others.length)} other failures (a control trips only its own assertion): ${others[0].slice(0, 200)}` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${String(failures.length)} other failures)`);
  process.exit(1);
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}

console.log('\nhome perf probe: no failures');
