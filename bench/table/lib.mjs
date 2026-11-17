// Shared Node side of the table bench: build the page, serve it, open a fresh page in an engine, drive paced wheel input, read what the
// page recorded. Used by run.mjs (the timing matrix), counts.mjs (exact counts) and fit.mjs (B5).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { summarizeSeries } from '../app/stats.mjs';
import { driveWheel, summarizeDrive, wheelSchedule } from '../app/wheel-driver.mjs';
import { CACHE, prepare } from './prepare.mjs';

export const here = import.meta.dirname;
export const repo = path.resolve(here, '../..');
const pw = createRequire(import.meta.url)('playwright');
export const ENGINES = { chromium: pw.chromium, webkit: pw.webkit };
export const VIEWPORT = { width: 1440, height: 900 };

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const load1 = () => Math.round(os.loadavg()[0] * 100) / 100;

/** Percentiles by nearest rank, rounded to the timer's grain (0.1 ms): a real frame, never interpolated. */
export const series = (values, digits = 1) => summarizeSeries(values, digits);

/**
 * Build the page with Vite. `react` is `normal` (the timing runs) or `profiling` (the count runs). The identity of what was built (the
 * kit's dist, the commit, whether the sources were clean) is written beside the page, so a run made later from the same directory names
 * what it measured even if the kit was rebuilt since.
 */
export function buildPage({ react = 'normal', dist }) {
  const identity = kitIdentity();
  try {
    execFileSync('pnpm', ['exec', 'vite', 'build', '--config', 'bench/table/vite.config.ts', '--logLevel', 'warn'], {
      cwd: repo,
      env: { ...process.env, OV_BENCH_REACT: react, OV_BENCH_DIST: dist },
      stdio: 'pipe',
    });
  } catch (error) {
    throw new Error(`the page did not build:\n${String(error.stderr ?? error.stdout ?? error.message)}`, { cause: error });
  }

  writeFileSync(path.join(dist, 'identity.json'), `${JSON.stringify({ ...identity, react, builtAt: new Date().toISOString() }, null, 2)}\n`);
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
    dirty: git('status', '--porcelain', '--', 'packages/kit/src', 'bench/table', ':!bench/table/results').length > 0,
  };
}

/** Make sure the row files exist. */
export function ensureCorpus() {
  if (!existsSync(path.join(CACHE, 'rows-5025.json'))) {
    prepare();
  }

  return JSON.parse(readFileSync(path.join(CACHE, 'corpus.json'), 'utf8'));
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

/**
 * Serve `dist` at / and the row files at /corpus/. The headers make the page cross-origin isolated, which gives both engines timers finer
 * than the 1 ms Safari otherwise rounds to (WebKit's rAF timestamps are quantized to whole milliseconds without it).
 */
export function serve(dist, { isolate = true } = {}) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const root = url.pathname.startsWith('/corpus/') ? CACHE : dist;
    const relative = url.pathname.startsWith('/corpus/') ? url.pathname.slice('/corpus/'.length) : url.pathname === '/' ? 'index.html' : url.pathname;
    const file = path.join(root, relative);
    try {
      if (!file.startsWith(root)) {
        throw new Error('outside');
      }

      response.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream');
      response.setHeader('cache-control', 'no-store');
      if (isolate) {
        response.setHeader('cross-origin-opener-policy', 'same-origin');
        response.setHeader('cross-origin-embedder-policy', 'require-corp');
      }

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
    memoryGiB: Math.round(os.totalmem() / 2 ** 30),
    loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100),
  };
}

/** Open a fresh context and page in an engine at the viewport, with the init script that counts listeners. */
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
  if (countListeners) {
    await page.addInitScript(() => {
      const counts = { adds: 0, removes: 0, inRegionAdds: 0 };
      window.__benchCounts = counts;
      const add = EventTarget.prototype.addEventListener;
      const remove = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function patched(...args) {
        counts.adds += 1;
        if (this instanceof Node && this.nodeType === 1 && this.closest?.('[data-bench-scroller]')) {
          counts.inRegionAdds += 1;
        }

        return add.apply(this, args);
      };

      EventTarget.prototype.removeEventListener = function patched(...args) {
        counts.removes += 1;
        return remove.apply(this, args);
      };
    });
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

/** The pixels of scrolling one wheel unit gives in this engine: a short known burst, read back. Returns the scale that makes `requested` px arrive. */
export async function calibrate(page) {
  await page.evaluate(() => window.__bench.resetScroll());
  const schedule = wheelSchedule({ hz: 60, segments: [{ durationMs: 500, pxPerSec: 400 }] });
  await driveWheel({ schedule, send: (deltaY) => page.mouse.wheel(0, deltaY) });
  await sleep(400);
  const delivered = await page.evaluate(() => window.__bench.scrollTop());
  await page.evaluate(() => window.__bench.resetScroll());
  const scale = delivered > 0 ? schedule.requestedPx / delivered : 1;
  return { requestedPx: schedule.requestedPx, deliveredPx: delivered, scale: Math.round(scale * 1000) / 1000 };
}

/** Paced wheel input at `pxPerSec` for `durationMs`, 60 events a second, from this process. */
export async function wheel(page, { durationMs, pxPerSec = 1200, hz = 60, scale = 1 }) {
  const schedule = wheelSchedule({ hz, segments: [{ durationMs, pxPerSec }], scale });
  const drive = await driveWheel({ schedule, send: (deltaY) => page.mouse.wheel(0, deltaY) });
  return summarizeDrive(schedule, drive);
}

/** Put the pointer over the middle of the body, where a user's rests. */
export async function pointerOverTable(page) {
  await page.mouse.move(VIEWPORT.width - 560, 25 + 400);
}

/**
 * The frames of the scroll itself, from the first frame whose scroll position moved to the last one that did: the idle frames at the two
 * edges of the recording window are not part of the scroll. Intervals are rounded to 0.1 ms, the grain of the timestamps.
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
    return { frames: 0, intervals: [], work: [], range: null };
  }

  // `intervals[i]` is the delta between frame i+1 and frame i of the recording (see Harness.end).
  const round = (value) => Math.round(value * 10) / 10;
  return {
    frames: last - first + 1,
    intervals: record.intervals.slice(Math.max(0, first - 1), last).map(round),
    work: record.work.slice(first, last + 1),
    range: [first, last],
  };
}

export const SPARSE = { eventsPerSecond: 5, recordsPerEvent: 2, recreateEvery: 10, seed: 1 };
