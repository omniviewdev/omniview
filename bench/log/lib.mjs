// Shared Node side of the log bench: build the page, serve it, open a fresh page in an engine with the counters installed, drive paced wheel input,
// read what the page recorded. Used by run.mjs (the timing matrix), search.mjs, memory.mjs and counts.mjs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { summarizeSeries } from '../app/stats.mjs';
import { driveWheel, summarizeDrive, wheelSchedule } from '../app/wheel-driver.mjs';

export const here = import.meta.dirname;
export const repo = path.resolve(here, '../..');
const pw = createRequire(import.meta.url)('playwright');
export const ENGINES = { chromium: pw.chromium, webkit: pw.webkit };
export const VIEWPORT = { width: 1440, height: 900 };
/** The stage the page draws the list in: its height in px (the list gets it less the filter row and the strip, and its header: 21 rows of 24 px at 596). */
export const STAGE_HEIGHT = 596;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const load1 = () => Math.round(os.loadavg()[0] * 100) / 100;

/** Percentiles by nearest rank, rounded to the timer's grain: a real frame, never interpolated. */
export const series = (values, digits = 1) => summarizeSeries(values, digits);

/**
 * Build the page with Vite. `react` is `normal` (the timing runs) or `profiling` (the cross-check of the commit counter). `overscan`, when given,
 * is patched into the page's copy of the built kit (vite.config.ts). The identity of what was built (the kit's dist, the commit, whether the sources
 * were clean) is written beside the page, so a run made later from the same directory names what it measured.
 */
export function buildPage({ react = 'normal', dist, overscan }) {
  const identity = kitIdentity();
  try {
    execFileSync('pnpm', ['exec', 'vite', 'build', '--config', 'bench/log/vite.config.ts', '--logLevel', 'warn'], {
      cwd: repo,
      env: { ...process.env, OV_BENCH_REACT: react, OV_BENCH_DIST: dist, ...(overscan === undefined ? {} : { OV_BENCH_OVERSCAN: String(overscan) }) },
      stdio: 'pipe',
    });
  } catch (error) {
    throw new Error(`the page did not build:\n${String(error.stderr ?? error.stdout ?? error.message)}`, { cause: error });
  }

  writeFileSync(path.join(dist, 'identity.json'), `${JSON.stringify({ ...identity, react, overscan: overscan ?? null, builtAt: new Date().toISOString() }, null, 2)}\n`);
}

/** What a built page was made of: `identity.json` of its directory. */
export function pageIdentity(dist) {
  return JSON.parse(readFileSync(path.join(dist, 'identity.json'), 'utf8'));
}

/** The kit the page is built against: the file the page imports, hashed, and the commit of the working tree. */
export function kitIdentity() {
  const file = path.join(repo, 'packages/kit/dist/index.js');
  if (!existsSync(file)) {
    throw new Error('packages/kit/dist is missing: run `pnpm --filter @omniviewdev/kit run build` first');
  }

  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  return {
    kitDistSha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    kitDistBytes: statSync(file).size,
    commit: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    dirty: git('status', '--porcelain', '--', 'packages/kit/src', 'bench/log', ':!bench/log/results').length > 0,
  };
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

/**
 * Serve `dist` at /. The headers make the page cross-origin isolated, which gives both engines timers finer than the 1 ms Safari otherwise rounds to
 * (WebKit's rAF timestamps are quantized to whole milliseconds without it).
 */
export function serve(dist) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname;
    const file = path.join(dist, relative);
    try {
      if (!file.startsWith(dist)) {
        throw new Error('outside');
      }

      response.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream');
      response.setHeader('cache-control', 'no-store');
      response.setHeader('cross-origin-opener-policy', 'same-origin');
      response.setHeader('cross-origin-embedder-policy', 'require-corp');
      response.end(readFileSync(file));
    } catch {
      response.statusCode = 404;
      response.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

/** The versions and the machine, for the file a run leaves. */
export function environment(browsers) {
  return {
    node: process.version,
    playwright: createRequire(import.meta.url)('playwright/package.json').version,
    browsers,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model,
    memoryGiB: Math.round(os.totalmem() / 2 ** 30),
    loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100),
  };
}

/**
 * The DevTools hook React injects into when it loads (production builds included): it counts every commit, by time. The same hook is what the React
 * DevTools use, so the number is React's own and costs one array push a commit.
 */
function installCommitHook() {
  const commits = [];
  window.__benchCommits = commits;
  const noop = () => undefined;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: () => 1,
    onCommitFiberRoot: () => {
      commits.push(performance.now());
    },
    onPostCommitFiberRoot: noop,
    onCommitFiberUnmount: noop,
    onScheduleFiberRoot: noop,
    checkDCE: noop,
  };
}

/** Counts `addEventListener` and `removeEventListener` calls (all, and those on a node inside the stage), and every custom property written to a style. */
function installListenerCount() {
  const counts = { adds: 0, removes: 0, inStageAdds: 0, inStageRemoves: 0, rootCustomWrites: 0, otherCustomWrites: 0 };
  window.__benchCounts = counts;
  const inStage = (target) => target instanceof Node && target.nodeType === 1 && target.closest?.('#stage') !== null && target.closest?.('#stage') !== undefined;
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function patched(...args) {
    counts.adds += 1;
    if (inStage(this)) {
      counts.inStageAdds += 1;
    }

    return add.apply(this, args);
  };

  EventTarget.prototype.removeEventListener = function patched(...args) {
    counts.removes += 1;
    if (inStage(this)) {
      counts.inStageRemoves += 1;
    }

    return remove.apply(this, args);
  };

  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function patched(name, ...rest) {
    if (String(name).startsWith('--')) {
      if (this === document.documentElement?.style || this === document.body?.style) {
        counts.rootCustomWrites += 1;
      } else {
        counts.otherCustomWrites += 1;
      }
    }

    return setProperty.call(this, name, ...rest);
  };
}

/** Open a fresh context and page in an engine at the viewport, with the commit counter installed (and, optionally, the listener counter). */
export async function openPage(browser, url, { cpu = 1, countListeners = false } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${String(error.message).slice(0, 300)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(`console: ${message.text().slice(0, 300)}`);
    }
  });
  page.on('requestfailed', (request) => problems.push(`requestfailed: ${request.url()}`));
  await page.addInitScript(installCommitHook);
  if (countListeners) {
    await page.addInitScript(installListenerCount);
  }

  let cdp;
  if (browser.browserType().name() === 'chromium') {
    cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    if (cpu !== 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    }
  }

  await page.goto(url);
  const info = await page.evaluate(() => window.__bench.ready);
  return { context, page, cdp, info, problems };
}

/** CDP `Performance.getMetrics` as a name -> value map (Chromium only). */
export async function cdpMetrics(cdp) {
  if (cdp === undefined) {
    return null;
  }

  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
}

const WANTED = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration', 'ThreadTime', 'Nodes', 'JSEventListeners', 'JSHeapUsedSize'];

/** What the engine did between two readings: durations in ms, counts as they are. */
export function metricsDelta(before, after) {
  if (before === null || after === null) {
    return null;
  }

  const out = {};
  for (const name of WANTED) {
    if (before[name] === undefined || after[name] === undefined) {
      continue;
    }

    const delta = after[name] - before[name];
    out[name] = name.endsWith('Duration') || name === 'ThreadTime' ? Math.round(delta * 1000 * 10) / 10 : delta;
  }

  return out;
}

/** The JS heap in bytes after two forced collections (Chromium only; WebKit has no way to read it from outside). */
export async function heapUsed(cdp) {
  if (cdp === undefined) {
    return null;
  }

  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  await sleep(100);
  return (await cdpMetrics(cdp)).JSHeapUsedSize;
}

/** Where a reader's pointer rests: the point of the default stage, (750, 214), which both variants' lists hold; kept inside the list when the list is smaller (`--height`). */
export function pointerTarget(list) {
  const inside = (value, low, high) => Math.min(Math.max(value, low + 1), high - 1);
  return { x: inside(50 + 700, list.left, list.right), y: inside(25 + 39 + 150, list.top, list.bottom) };
}

/** Put the pointer over the list, where a reader's rests. */
export async function pointerOverList(page) {
  const list = await page.evaluate(() => {
    const box = window.__bench.probe?.scroller()?.getBoundingClientRect();
    return box === undefined ? null : { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  });
  if (list === null) {
    throw new Error('there is no list to put the pointer over');
  }

  const { x, y } = pointerTarget(list);
  await page.mouse.move(x, y);
}

/** The pixels of scrolling one wheel unit gives in this engine: a short known burst, read back. Returns the scale that makes `requested` px arrive. */
export async function calibrate(page) {
  await page.evaluate(() => window.__bench.scrollTo(0));
  const schedule = wheelSchedule({ hz: 60, segments: [{ durationMs: 500, pxPerSec: 400 }] });
  await driveWheel({ schedule, send: (deltaY) => page.mouse.wheel(0, deltaY) });
  await sleep(400);
  const delivered = await page.evaluate(() => window.__bench.scrollTop());
  await page.evaluate(() => window.__bench.scrollTo(0));
  if (!(delivered > 0)) {
    throw new Error(`the calibration burst delivered no scroll pixels (${schedule.requestedPx} px requested): the pointer is not over the list, or the list does not scroll`);
  }

  const scale = schedule.requestedPx / delivered;
  return { requestedPx: schedule.requestedPx, deliveredPx: delivered, scale: Math.round(scale * 1000) / 1000 };
}

/** Paced wheel input at `pxPerSec` for `durationMs`, 60 events a second, from this process. */
export async function wheel(page, { durationMs, pxPerSec, hz = 60, scale = 1 }) {
  const schedule = wheelSchedule({ hz, segments: [{ durationMs, pxPerSec }], scale });
  const drive = await driveWheel({ schedule, send: (deltaY) => page.mouse.wheel(0, deltaY) });
  return summarizeDrive(schedule, drive);
}

/**
 * The frames of the scroll itself, from the first frame whose scroll position moved to the last one that did: the idle frames at the two edges of the
 * recording window are not part of the scroll. Intervals are rounded to 0.1 ms, the grain of the timestamps.
 */
export function scrollWindow(record) {
  const tops = record.scrollTops;
  let first = -1;
  let last = -1;
  for (let index = 1; index < tops.length; index += 1) {
    if (tops[index] !== tops[index - 1] && !Number.isNaN(tops[index]) && !Number.isNaN(tops[index - 1])) {
      if (first < 0) {
        first = index;
      }

      last = index;
    }
  }

  if (first < 0) {
    return { frames: 0, intervals: [], work: [], rows: [], range: null };
  }

  const round = (value) => Math.round(value * 10) / 10;
  return {
    frames: last - first + 1,
    intervals: record.intervals.slice(Math.max(0, first - 1), last).map(round),
    work: record.work.slice(first, last + 1),
    rows: record.rows.slice(first, last + 1),
    range: [first, last],
  };
}

/** Wait (bounded) for the machine to be quieter than `maxLoad` before a trial starts. */
export async function quiet(maxLoad, limitMs = 120_000) {
  const started = load1();
  let waited = 0;
  while (load1() > maxLoad && waited < limitMs) {
    await sleep(10_000);
    waited += 10_000;
  }

  return { started, waited };
}

/**
 * A memory trial's stream is the workload: one that ended (the time limit, a stalled source) short of the lines asked for says nothing about the heap after them, and neither does one in
 * which the feed dropped lines. The source counts a line it skips when a tick comes late (the feed holds at most its bound, and makes only the lines it can hold) as received, so a delay
 * long enough satisfies the count with lines that never went through the view: `dropped` is what the feed dropped over the trial.
 */
export function requireWorkload(streamed, requested, seconds, dropped = 0) {
  if (streamed < requested) {
    throw new Error(`the source streamed ${streamed.toLocaleString('en-US')} of the ${requested.toLocaleString('en-US')} lines in ${seconds} s: the workload is incomplete`);
  }

  if (dropped > 0) {
    throw new Error(`the feed dropped ${dropped.toLocaleString('en-US')} of the lines counted as streamed: they never went through the view, so the workload is not the one requested`);
  }
}
