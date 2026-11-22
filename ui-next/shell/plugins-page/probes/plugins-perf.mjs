// What the Plugins page costs, measured in the page the way a person meets it (plugins-probe.mjs calls `perf` once for each engine, at the first viewport of the run, in a page of its own for each part). The page is opened with the palette's
// command "Plugins", as a person opens it, on a fixture whose host lists TWO HUNDRED installed plugins (`?count=200`: the six of world.mjs and 194 generated ones; the window loads the interface of the first six only: loading two hundred
// bundles is the window's cost and the rail's, and every number here is the page's).
//
// EVERY ASSERTION HERE IS A COUNT, and no count depends on how fast the machine is: commits, animation frames, batches of DOM changes, nodes changed, timers and callbacks. The runner is two to four times slower than a laptop and has a heavy tail,
// and a time asserted on it failed three pull requests (docs/ui-next/status/N25.md, section 4). Milliseconds are measured and printed, and the one bound on them is a catastrophe's: CATASTROPHE_MS for the median open, 13 times what a laptop reads and
// more than three times what the runner is expected to read (an open that slow is another page, not a slow machine). The section runs at the first viewport of the run: none of these counts depends on the size of the window (the geometry and the
// paint, which do, are compared at both viewports by the rest of the probe). The waits in this file end when a condition holds and are bounded only against a page that never gets there (WAIT): nothing is judged by how long it took.
//
//   mount   (development build, `perf.mount`) the list mounts in ONE commit: the page's Profiler (`window.__pageCommits`: every commit that rendered something inside the Plugins page) sees one commit after the command, of the phase `mount`, and the
//           two hundred rows reach the document in ONE batch of DOM changes (one MutationObserver delivery) and nowhere else. The inventory the window already holds is the first frame's (the page's `seed`), and the read the page makes
//           when it attaches answers the same list, which changes nothing and so commits nothing. `mountStale` is the same with a window whose inventory is older than the host's answer for ONE plugin: the page mounts, and then makes ONE
//           more commit that changes that plugin's row and no other.
//   event   (development build, `perf.event`) a `plugin/state_change` event for ONE plugin of the two hundred (not the one on screen) renders ONE row in ONE commit (the page's profiler and the window's agree) and no node outside that row changes (a
//           MutationObserver over the list and over the detail, by the row each changed node is in); the same event for the plugin on screen changes its row and the detail, and no other row, in one commit. A no-op passes every
//           zero, so the row is checked to have changed (its `data-pl-state` and its chip).
//   open    (`perf.open`) the command to the list, in counts. In the development build: from the keydown of the Enter that runs the command, the FIRST commit of the window has every row in the document (the window's Profiler says how many rows were in
//           the document at the end of each commit: the command, the palette closing, the tab opening and the list mounting are ONE commit). In the production build, 20 runs with the two hundred plugins and 8 with the six of world.mjs, each in a fresh
//           tab (closed with the close chord between them): from the same keydown the list is in the document by the first animation-frame callback after it (at the median; the page asks for a frame all the time, as a page that animates does, so that
//           its frames are paced as a display's are) and by the second at the latest in every run, and its rows reach the document in ONE batch of DOM changes. The milliseconds from the keydown to the second frame after the list (an upper bound of
//           when it is on the screen: no page can see when a frame reached the display) are in the report, p50 and p95, and are printed; the median is held only against CATASTROPHE_MS.
//   idle    (development build, `perf.idle`) after the page has settled, a window of 3 s with the page on screen: no commit of the window or of the page, no timer or animation frame asked for and none of an earlier one run, no DOM change; in Chromium
//           also no layout and no style recalculation (WebKit has no such counter). The method is logs-probe.mjs `hidden`: the page's own calls are counted from outside it (`window.__work`), the commits come from the development build's
//           Profiler, the engine's layout counters from the DevTools protocol.
//
// The numbers go to `report.perf["<engine> <viewport>"]` as
//   { mount, mountStale: { pageCommits, windowCommits, batches, rowsChangedAfterThat, rows, inventoryReads }, event: { other, selected }, openCommits: { toRows, commitsSince, rowsAtTheEndOfEach },
//     open, open6: { plugins, runs, p50, p95, min, max, firstMs: { p50, p95 }, frames: { p50, max }, batches: { max }, measure }, idle: { settled, windowMs, <counts> } }
// in milliseconds, nearest-rank percentiles; `fail(assertion, where, what)` records what must hold and is never thrown.
import { execFileSync } from 'node:child_process';
import { normalizeFont } from '../../../../packages/kit/probes/probe-lib.mjs';
import { open, sleep } from '../../probes/harness.mjs';

/** Opens of the page in the production build: with the two hundred plugins (the stress), with the six of world.mjs (the usual window) and, for a control that makes each open slow or late, the least that shows it. */
const OPENS = 20;
const OPENS_SMALL = 8;
const OPENS_CONTROL = 5;
/** The time between two presses of the command, so that none coalesces with the one before it. */
const GAP = 80;
/** The longest a wait for a condition may take: a bound against a page that never gets there. On the runner each of these waits takes a few seconds at most; nothing is judged by it. */
const WAIT = 30_000;
const SETTLE = 500;
const IDLE_MS = 3000;
const COUNT = 200;
/**
 * The one bound on milliseconds: the median of the opens with two hundred plugins, from the keydown to the second frame after the list is in the document. A laptop reads 24 to 30 ms (WebKit and Chromium, 1440 x 900, load 10 to 20); the runner
 * is expected to read two to four times that. 400 ms is 13 times the laptop's and more than three times the runner's: a page that takes that long is not on a slow machine, it is broken (and a count cannot see a page that is slow in its
 * first commit).
 */
const CATASTROPHE_MS = 400;
/** The plugin the event goes to: in the middle of the list, not the one on screen (the first). */
const TARGET = 'plugin-0100';
/** What the control `slow-open` burns in the keydown that runs the command, in each open: more than the bound, so that any machine reads it. */
const BURN_MS = 1000;

const round = (value) => Math.round(value * 10) / 10;
const nearest = (sorted, percent) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1))];
const ascending = (values) => [...values].sort((a, b) => a - b);

/** Percentiles by nearest rank, in ms to a tenth. */
function summary(values) {
  if (values.length === 0) return { p50: null, p95: null, min: null, max: null, samples: 0 };
  const sorted = ascending(values);
  return { p50: round(nearest(sorted, 50)), p95: round(nearest(sorted, 95)), min: round(sorted[0]), max: round(sorted[sorted.length - 1]), samples: sorted.length };
}

const firstLine = (error) => String(error?.message ?? error).split('\n')[0].slice(0, 300);
const uptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();

// ---------------------------------------------------------------------------------------------------------------------------
// The page's side. Every function here is stringified into an init script (`script`): it runs in the page before the page's own scripts and uses nothing of this module.

/**
 * The clock of the command in the production build: when the Enter that runs it was pressed with the palette open, the frames after it, and the batches of DOM changes that added rows. The page asks for a frame all the time, so that its frames are paced
 * as a display's are. From the keydown on, each frame asks whether the list's rows are in the document (as many as the fixture lists, and the count footer): the first frame that has them is `firstFrame` (1 is the first animation-frame callback after the
 * key), and the frame after it ends the sample.
 */
function openClock() {
  const want = Number(new URLSearchParams(window.location.search).get('count') ?? 6);
  const state = (window.__open = { downAt: null, armed: false, frame: 0, seen: null, batches: 0, samples: [] });
  const rowsIn = () => document.querySelectorAll('[data-pl-part="row"]').length;
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' && !event.repeat && document.querySelector('dialog[open]') !== null) {
        state.downAt = event.timeStamp;
        state.armed = true;
        state.frame = 0;
        state.seen = null;
        state.batches = 0;
      }
    },
    true,
  );
  // One delivery of the observer that brings rows into the document is one batch of DOM changes: a commit that mounts the list is one, and a list that comes in two commits (or in a commit and a later one) is two.
  new MutationObserver((records) => {
    if (!state.armed) return;
    const added = records.some((record) => [...record.addedNodes].some((node) => node instanceof Element && (node.matches('[data-pl-part="row"]') || node.querySelector('[data-pl-part="row"]') !== null)));
    if (added) state.batches += 1;
  }).observe(document, { childList: true, subtree: true });
  const beat = () => {
    const now = performance.now();
    if (state.armed) {
      state.frame += 1;
      if (state.seen === null) {
        const rows = rowsIn();
        if (rows >= want && document.querySelector('[data-pl-part="list-foot"]') !== null) state.seen = { frame: state.frame, at: now, rows };
      } else {
        state.samples.push({ from: state.downAt, firstFrame: state.seen.frame, first: state.seen.at, painted: now, rows: state.seen.rows, batches: state.batches });
        state.armed = false;
      }
    }

    requestAnimationFrame(beat);
  };

  requestAnimationFrame(beat);
}

/** The clock of the command in the development build: how many commits the window had made when the Enter that runs it was pressed with the palette open (`window.__commits`, fixture.tsx). */
function commitClock() {
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' && !event.repeat && document.querySelector('dialog[open]') !== null) window.__atEnter = window.__commits.length;
    },
    true,
  );
}

/**
 * What a window of time costs, counted from outside the page's own work (logs-probe.mjs `COUNT`): every call that starts a frame, a timer or an idle callback, every callback of one that runs, every DOM mutation. `__rawRaf` is the engine's
 * own request, for the probe's sampler.
 */
function countWork() {
  const work = (window.__work = { raf: 0, frames: 0, timeout: 0, timeouts: 0, interval: 0, intervals: 0, idle: 0, idles: 0, mutations: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  window.__rawRaf = raf;
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

/** The text of an init script that runs `fn` in the page. */
export const script = (fn) => `(${fn.toString()})();`;

// ---------------------------------------------------------------------------------------------------------------------------
const chordOf = async (page) => ((await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+k' : 'Control+k');
const closeChord = async (page) => ((await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+w' : 'Control+w');

/** Opens the page as a person does: the palette's chord, the word, and Enter on the one command that answers. */
async function openByPalette(page) {
  await page.keyboard.press(await chordOf(page));
  await page.waitForSelector('dialog[open]', { timeout: WAIT });
  await page.keyboard.type('Plugins', { delay: 15 });
  await page.waitForFunction(() => [...document.querySelectorAll('dialog [role=option]')].some((row) => (row.getAttribute('aria-label') ?? '').startsWith('Command: Plugins')), null, { timeout: WAIT });
  await page.keyboard.press('Enter');
}

/**
 * The window has loaded the interfaces of its plugins (five of the six of world.mjs: `delta` was turned off, and a plugin that is off has none), `gamma` has been told to have crashed, and the host has been read once. The page is not open yet, or is.
 */
const windowReady = (page) =>
  page.waitForFunction(() => {
    const entries = window.__store?.getSnapshot() ?? [];
    return entries.length >= 5 && entries.every((entry) => entry.phase !== 'loading') && entries.some((entry) => entry.id === 'gamma' && entry.phase === 'failed') && window.__world.reads() >= 1;
  }, null, { timeout: WAIT });

/** Waits for a condition in the page and says whether it came in time: false when it did not, and the check that follows says what is wrong, where a timeout's stack would not. */
const until = (page, condition, arg, timeout = 5000) => page.waitForFunction(condition, arg, { timeout }).then(() => true, () => false);

/**
 * Waits until a counter stops moving: `read()` in the page gives the same number for `still` ms. A page whose counter keeps moving for `limit` ms never settles, and has no count to take: it throws, which the part reports as a failure of its
 * assertion.
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

export async function perf({ browser, engine, viewportName, viewport, production, development, report, fail, count, url, only, control = '' }) {
  const where = `${engine} ${viewportName}`;
  const result = { mount: null, mountStale: null, event: null, openCommits: null, open: null, open6: null, idle: null, uptime: uptime() };
  report.perf[where] = result;
  const wants = (part) => only === undefined || only.includes(part);
  const A = { mount: 'perf.mount', event: 'perf.event', open: 'perf.open', idle: 'perf.idle' };
  // The control `late-list` is a fault of the page, made the page's own way (the fixture's `?seed=0`): a page that draws nothing of the inventory the window already holds has its list only when the host answers, a read of 100 ms later.
  const fault = control === 'late-list' ? '&seed=0&readMs=100' : '';

  /** One part in a page of its own: opened by the harness, then `body(page, context)`. What throws is a failure of the part, the page's errors are failures, and the context is always closed. */
  async function section(name, assertion, origin, query, hash, { init, fonts = true }, body) {
    let opened;
    try {
      opened = await open(browser, url(origin, query, hash), viewport, { init, waitFor: '[data-shell-part="window"]' });
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

  // 1. mount: two hundred plugins, one commit. The window reads the inventory again first (the host's `plugin/inventory_changed`, which the window reads the inventory after), so that the page's first frame is seeded with what the host holds now;
  // a seed older than the host's answer is a row that really changes after the first frame, and a second commit by right. The crash of `gamma` is told by `state_change`, which the window does not read the inventory after, so the
  // window's copy still says Running for it: `mountStale` is the page opened on that copy, and it must cost one more commit, which changes the one row that differs and no other.
  if (wants('mount') && development !== null) {
    for (const [key, current] of [['mount', true], ['mountStale', false]]) {
      await section(key, A.mount, development.origin, `count=${COUNT}`, '', {}, async (page) => {
        await windowReady(page);
        if (current) {
          const reads = await page.evaluate(() => window.__world.reads());
          await page.evaluate(() => window.__events.emit('plugin/inventory_changed'));
          await page.waitForFunction((was) => window.__world.reads() > was, reads, { timeout: WAIT });
        }

        await quiet(page, () => window.__commits.length + window.__world.reads(), 700);
        await page.evaluate(() => {
          const batches = (window.__batches = []);
          const late = (window.__late = []);
          new MutationObserver((records) => {
            let rows = 0;
            for (const record of records) {
              for (const node of record.addedNodes) {
                if (node instanceof Element) rows += node.matches('[data-pl-part="row"]') ? 1 : node.querySelectorAll('[data-pl-part="row"]').length;
              }
            }

            if (rows > 0) {
              batches.push({ rows, at: performance.now() });
              return;
            }

            // What changes in the page after the rows came in: the row each changed node is in, or `page` for a node outside the rows.
            if (batches.length > 0) {
              for (const record of records) {
                const node = record.target instanceof Element ? record.target : record.target.parentElement;
                if (node?.closest('[data-pl-page]') !== null && node !== null) late.push(node.closest('[data-pl-id]')?.getAttribute('data-pl-id') ?? 'page');
              }
            }
          }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
          window.__before = { page: window.__pageCommits.length, window: window.__commits.length };
        });
        await openByPalette(page);
        await page.waitForFunction((want) => document.querySelectorAll('[data-pl-part="row"]').length >= want, COUNT, { timeout: WAIT });
        // The control `late-change`: a plugin of the host changes its phase and the window is told to read the inventory again, right after the rows came in: a second commit that a page which mounts in one never makes.
        if (control === 'late-change') {
          await page.evaluate(() => {
            window.__world.set('plugin-0100', { phase: 'Stopped' });
            window.__events.emit('plugin/inventory_changed');
          });
        }

        await quiet(page, () => window.__commits.length + window.__world.reads(), 700);
        const read = await page.evaluate(() => ({
          page: window.__pageCommits.slice(window.__before.page).map((commit) => commit.phase),
          window: window.__commits.slice(window.__before.window).length,
          batches: window.__batches.slice(),
          late: [...new Set(window.__late)],
          rows: document.querySelectorAll('[data-pl-part="row"]').length,
          reads: window.__world.reads(),
        }));
        result[key] = { pageCommits: read.page, windowCommits: read.window, batches: read.batches.map((batch) => batch.rows), rowsChangedAfterThat: read.late, rows: read.rows, inventoryReads: read.reads };
        count(A.mount);
        if (read.rows !== COUNT) fail(A.mount, where, `${key}: ${String(read.rows)} rows are in the document, the host lists ${String(COUNT)}`);
        if (read.batches.length !== 1 || read.batches[0].rows !== COUNT) fail(A.mount, where, `${key}: the rows reached the document in ${String(read.batches.length)} batches of ${read.batches.map((batch) => batch.rows).join(' + ') || 'none'}, wanted one batch of ${String(COUNT)}`);
        if (current) {
          if (read.page.length !== 1 || read.page[0] !== 'mount') fail(A.mount, where, `${key}: the page made ${String(read.page.length)} commits after the command (${read.page.join(', ') || 'none'}), wanted ONE, of the phase mount`);
          if (read.late.length > 0) fail(A.mount, where, `${key}: ${read.late.map(String).join(', ')} changed after the rows were in, with the seed the host's own`);
        } else if (read.page.join(',') !== 'mount,update' || read.late.some((id) => id !== 'gamma')) {
          fail(A.mount, where, `${key}: with a seed older than the host's answer for one plugin the page made ${String(read.page.length)} commits (${read.page.join(', ') || 'none'}) and ${read.late.map(String).join(', ') || 'no row'} changed after the first, wanted mount and one update that changes gamma alone`);
        }
      });
    }
  }

  // 2. event: a state event for one plugin renders one row.
  if (wants('event') && development !== null) {
    await section('event', A.event, development.origin, `count=${COUNT}`, '#/host/plugins', {}, async (page) => {
      await windowReady(page);
      await page.waitForFunction((want) => document.querySelectorAll('[data-pl-part="row"]').length >= want, COUNT, { timeout: WAIT });
      await quiet(page, () => window.__commits.length, 700);
      const drive = async (id, label) => {
        await page.evaluate(() => {
          const changed = (window.__changed = []);
          const watch = (root, area) =>
            new MutationObserver((records) => {
              for (const record of records) {
                const node = record.target instanceof Element ? record.target : record.target.parentElement;
                changed.push({ area, row: node?.closest('[data-pl-id]')?.getAttribute('data-pl-id') ?? null });
              }
            }).observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
          watch(document.querySelector('[data-pl-part="list"]'), 'list');
          watch(document.querySelector('[data-pl-part="detail"]'), 'detail');
          window.__before = { page: window.__pageCommits.length, window: window.__commits.length };
        });
        // The control `second-row`: the host tells the window of a second plugin in the same task, so that the one commit renders two rows.
        await page.evaluate(([plugin, second]) => {
          window.__world.phase(plugin, 'Stopped');
          if (second) window.__world.phase('plugin-0101', 'Stopped');
        }, [id, control === 'second-row']);
        // The row says what the host told (a wait for the condition, not for a time), and then the page is still for a while: the commits and the changed nodes are counted once nothing more comes.
        await until(page, (plugin) => document.querySelector(`[data-pl-part="row"][data-pl-id="${plugin}"]`)?.getAttribute('data-pl-state') === 'stopped', id);
        await quiet(page, () => window.__commits.length, 300);
        const read = await page.evaluate((plugin) => ({
          page: window.__pageCommits.length - window.__before.page,
          window: window.__commits.length - window.__before.window,
          changed: window.__changed.slice(),
          state: document.querySelector(`[data-pl-part="row"][data-pl-id="${plugin}"]`)?.getAttribute('data-pl-state') ?? null,
          chip: document.querySelector(`[data-pl-part="row"][data-pl-id="${plugin}"] [data-pl-part="state-chip"]`)?.textContent ?? null,
        }), id);
        const rows = [...new Set(read.changed.filter((change) => change.area === 'list').map((change) => change.row))];
        const detail = read.changed.filter((change) => change.area === 'detail').length;
        const outside = read.changed.filter((change) => change.area === 'list' && change.row !== id);
        count(A.event);
        if (read.state !== 'stopped' || read.chip !== 'Stopped') fail(A.event, where, `${label}: the event changed nothing the row says (state ${JSON.stringify(read.state)}, chip ${JSON.stringify(read.chip)}): the counts below would be the counts of a page that did nothing`);
        if (read.page !== 1 || read.window !== 1) fail(A.event, where, `${label}: the event cost ${String(read.page)} commits in the page and ${String(read.window)} in the window, wanted one each`);
        if (outside.length > 0) fail(A.event, where, `${label}: ${String(outside.length)} changes to the list outside the row of ${id} (rows: ${rows.map(String).join(', ')})`);
        if (rows.length !== 1 || rows[0] !== id) fail(A.event, where, `${label}: the rows that changed are ${rows.map(String).join(', ') || 'none'}, wanted ${id} alone`);
        return { commitsInPage: read.page, commitsInWindow: read.window, rowsChanged: rows, nodesChangedInList: read.changed.filter((change) => change.area === 'list').length, nodesChangedInDetail: detail };
      };

      const other = await drive(TARGET, `the event for ${TARGET}`);
      result.event = { other, selected: null };
      // The plugin on screen: its row and the detail, in one commit, and no other row.
      const selected = await page.evaluate(() => document.querySelector('[data-pl-part="row"][aria-current="true"]')?.getAttribute('data-pl-id') ?? null);
      count(A.event);
      if (selected === null) {
        fail(A.event, where, 'no row is the selected one');
        return;
      }

      const ours = await drive(selected, `the event for the plugin on screen (${selected})`);
      result.event.selected = ours;
      if (ours.nodesChangedInDetail === 0) fail(A.event, where, `the event for the plugin on screen (${selected}) changed nothing in the detail`);
    });
  }

  // 3. open: the command to the list, in counts. The short runs of the two controls that make the open late or slow (`late-list`, `slow-open`) are enough to see their fault.
  if (wants('open')) {
    // 3a. In the development build: the first commit after the command has the whole list.
    if (development !== null && control !== 'slow-open') {
      await section('commits', A.open, development.origin, `count=${String(COUNT)}${fault}`, '', { init: script(commitClock) }, async (page) => {
        await windowReady(page);
        await quiet(page, () => window.__commits.length + window.__world.reads(), 700);
        await openByPalette(page);
        await page.waitForFunction((want) => document.querySelectorAll('[data-pl-part="row"]').length >= want, COUNT, { timeout: WAIT });
        await quiet(page, () => window.__commits.length, 700);
        const read = await page.evaluate((want) => {
          const at = window.__atEnter;
          if (at === undefined) return null;
          const since = window.__commits.slice(at);
          const first = since.findIndex((commit) => commit.rows >= want);
          return { toRows: first < 0 ? null : first + 1, commitsSince: since.length, rowsAtTheEndOfEach: since.map((commit) => commit.rows) };
        }, COUNT);
        result.openCommits = read;
        count(A.open);
        if (read === null) fail(A.open, where, 'commits: the Enter that runs the command was not seen with the palette open: there is nothing to count');
        else if (read.toRows !== 1) fail(A.open, where, `commits: the list was in the document after ${String(read.toRows)} commits from the command (the rows in the document at the end of each commit since it: ${read.rowsAtTheEndOfEach.join(', ')}), wanted ONE`);
      });
    }

    // 3b. In the production build: the list in the document by the first animation frame, in one batch.
    const short = control === 'slow-open' || control === 'late-list';
    const burn = control === 'slow-open' ? `window.addEventListener('keydown', (event) => { if (event.key === 'Enter') for (const end = performance.now() + ${String(BURN_MS)}; performance.now() < end;); }, true);` : '';
    for (const [key, plugins, runs] of short ? [['open', COUNT, OPENS_CONTROL]] : [['open', COUNT, OPENS], ['open6', 6, OPENS_SMALL]]) {
      await section(key, A.open, production.origin, `count=${String(plugins)}${fault}`, '', { init: script(openClock) + burn }, async (page) => {
        await windowReady(page);
        await sleep(SETTLE);
        for (let index = 0; index < runs; index += 1) {
          await openByPalette(page);
          await page.waitForFunction((n) => window.__open.samples.length >= n, index + 1, { timeout: WAIT });
          await sleep(GAP);
          await page.keyboard.press(await closeChord(page));
          await page.waitForFunction(() => document.querySelector('[data-pl-page]') === null, null, { timeout: WAIT });
          await sleep(GAP);
        }

        const samples = await page.evaluate(() => window.__open.samples);
        const usable = samples.filter(({ from, painted }) => Number.isFinite(from) && from > 0 && painted > from);
        count(A.open);
        if (usable.length !== samples.length) fail(A.open, where, `${key}: ${String(samples.length - usable.length)} of ${String(samples.length)} samples have no usable keydown time stamp (${JSON.stringify(samples.slice(0, 2))}): event.timeStamp is not on performance.now()'s clock here`);
        const ms = summary(usable.map(({ from, painted }) => painted - from));
        const firstMs = summary(usable.map(({ from, first }) => first - from));
        const frames = ascending(samples.map((sample) => sample.firstFrame));
        const batches = ascending(samples.map((sample) => sample.batches));
        result[key] = {
          plugins,
          runs: samples.length,
          ...ms,
          firstMs: { p50: firstMs.p50, p95: firstMs.p95 },
          frames: { p50: nearest(frames, 50), max: frames.at(-1) },
          batches: { max: batches.at(-1) },
          measure: 'keydown event.timeStamp of the Enter that runs the command to the second requestAnimationFrame callback after the frame in which the list rows are first in the document (an upper bound of the first paint), reported and not judged but against a catastrophe; `frames` is the animation-frame callback after the key at which the rows were in the document (1: the first), `batches` the deliveries of a MutationObserver that brought rows into the document',
        };
        console.log(
          `${where}: opening the page, ${String(plugins)} plugins, ${String(samples.length)} runs: the list in the document at animation frame ${String(result[key].frames.p50)} at the median (the latest ${String(result[key].frames.max)}), in ${String(result[key].batches.max)} batch of DOM changes at most; ${String(ms.p50)} ms at the median and ${String(ms.p95)} at p95 (reported; held only against ${String(CATASTROPHE_MS)} ms)`,
        );
        // The counts: by the first animation-frame callback at the median, never after the second, every run in one batch with every row.
        if (result[key].frames.p50 !== 1) fail(A.open, where, `${key}: the list was in the document at animation frame ${String(result[key].frames.p50)} after the command at the median, wanted the first (frames of the ${String(frames.length)} runs: ${frames.join(' ')})`);
        const late = samples.filter((sample) => sample.firstFrame > 2);
        if (late.length > 0) fail(A.open, where, `${key}: ${String(late.length)} of ${String(samples.length)} runs had the list in the document only at animation frame ${late.map((sample) => String(sample.firstFrame)).join(', ')}, wanted the second at the latest`);
        const split = samples.filter((sample) => sample.batches !== 1 || sample.rows !== plugins);
        if (split.length > 0) fail(A.open, where, `${key}: ${String(split.length)} of ${String(samples.length)} runs brought the rows into the document in ${split.map((sample) => `${String(sample.batches)} batches (${String(sample.rows)} rows)`).join(', ')}, wanted one batch of ${String(plugins)}`);
        // The one bound on milliseconds, a catastrophe's.
        if (key === 'open' && (ms.p50 === null || ms.p50 >= CATASTROPHE_MS)) fail(A.open, where, `${key}: opening the page (${String(plugins)} plugins) took ${String(ms.p50)} ms at the median to the list painted, over the ${String(CATASTROPHE_MS)} ms a catastrophe is (p95 ${String(ms.p95)} ms)`);
      });
    }
  }

  // 4. idle: after the page has settled, nothing runs. The engine's layout and style counters come from the DevTools protocol in Chromium.
  if (wants('idle') && development !== null) {
    // The control `idle-timer`: a timer the page keeps while it is on screen, as a clock in a part would.
    const tick = () => window.setInterval(() => undefined, 250);
    await section('idle', A.idle, development.origin, `count=${COUNT}`, '#/host/plugins', { init: script(countWork) + (control === 'idle-timer' ? script(tick) : ''), fonts: false }, async (page, context) => {
      const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null;
      if (cdp !== null) await cdp.send('Performance.enable');
      await windowReady(page);
      await page.waitForFunction((want) => document.querySelectorAll('[data-pl-part="row"]').length >= want, COUNT, { timeout: WAIT });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      // The plugin that was starting finishes starting (the host tells the window, as it does): a settled page has no plugin in progress, and so no spinner, the one thing in it that moves by itself (an animation the engine may or may not
      // keep off the main thread is not what an idle page is judged on).
      await page.evaluate(() => window.__world.phase('epsilon', 'Running'));
      const finished = await until(page, () => document.querySelector('[data-pl-part="row"][data-pl-id="epsilon"]')?.getAttribute('data-pl-state') === 'running');
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
      if (!settled) fail(A.idle, where, `the page did not settle in ${String(WAIT / 1000)} s (its commits, timers, frames and DOM changes kept moving): there is no idle to measure`);
      if (!finished) fail(A.idle, where, 'the plugin that was starting did not finish starting when the host said so: the page is not settled');
      if (!(await page.evaluate(() => document.querySelector('[data-pl-part="row"]') !== null))) fail(A.idle, where, 'the page is not on screen: an empty window is idle too');
      for (const [key, value] of Object.entries(spent)) if (value !== 0) fail(A.idle, where, `${String(value)} ${key} in ${String(IDLE_MS / 1000)} s after the page settled, wanted none (${JSON.stringify(spent)})`);
      if (cdp === null) report.notes.push(`${where}: WebKit has no layout or style counter: commits, timers, frames and DOM changes only`);
    });
  }

  result.uptimeAfter = uptime();
}
