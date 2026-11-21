// The timing matrix of the log bench (docs/ui-next/status/P1b-2.md, the rule written before any measurement; docs/ui-next/baseline/2026-11-19-log.md).
//
//   pnpm --filter @omniviewdev/kit run build                       # the page imports the BUILT kit
//   node bench/log/run.mjs --engine chromium --workload follow --configs kit:1000,control:1000,kit:10000,control:10000,kit:50000,control:50000 --rounds 10 --tag m1-chromium-follow
//   node bench/log/run.mjs --engine chromium --workload scroll --configs kit,control,kit/30 --rounds 10 --tag m1-chromium-scroll
//
// One ROUND runs every config once, in an order that rotates from round to round, so that machine drift hits every config alike: the paired trials
// of the rule. Every trial is a fresh browser context and page. The 1-minute load average is read at the start of every trial and at its end; a trial
// that started or ended above `--max-load` (default 12) is run ONCE more (the record says so, and the report counts it).
//
//   --engine     chromium | webkit
//   --workload   follow: the 100,000-line buffer is full, then the source runs at `rate` lines a second while the list follows the end (3 s warm-up, 10 s measured)
//                scroll: the full buffer, no source, the list scrolled 30 pages down by paced wheel input (60 events a second, 1,200 px/s), then the old viewer's
//                        own workload: 30 one-page jumps, 250 ms apart
//   --configs    comma list of `variant[:rate][/overscan]`: kit | control; rate in lines a second (follow); overscan in rows beyond the viewport (default 10).
//                The kit's overscan is a constant of its built package: another value is patched into a second build of the page (vite.config.ts).
//   --rounds     trials per config (default 10)
//   --height     the stage's height in px (default 596: 21 rows of 24 px in the list)
//   --warmup-ms, --measure-ms   3000 and 10000 (follow)
//   --tag        the output directory name under bench/log/results/
//   --sources    how many sources the feed follows (default 0: one, not listed; L2): 2 makes the kit draw its Source column and the control a plain source cell, with the names a real stream has
//   --toolbar    mount the host's LogSession (the Logs tool's toolbar beside the kit's view, in the flex row the tool gives it) in the kit variant instead of the bare LogView; the control is unchanged. Tag such a run apart (--tag)
//   --dist       the built page (default bench/log/.dist-matrix); a patched overscan is built beside it as <dist>-o<rows>; --no-build reuses them
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  ENGINES, STAGE_HEIGHT, buildPage, calibrate, cdpMetrics, environment, here, load1, metricsDelta, openPage, pageIdentity, pointerOverList, quiet, scrollWindow, serve, series, sleep, wheel,
} from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    engine: { type: 'string' },
    workload: { type: 'string', default: 'follow' },
    configs: { type: 'string' },
    rounds: { type: 'string', default: '10' },
    height: { type: 'string', default: String(STAGE_HEIGHT) },
    'warmup-ms': { type: 'string', default: '3000' },
    'measure-ms': { type: 'string', default: '10000' },
    'max-load': { type: 'string', default: '12' },
    cpu: { type: 'string', default: '1' },
    tag: { type: 'string' },
    sources: { type: 'string', default: '0' },
    toolbar: { type: 'boolean', default: false },
    dist: { type: 'string' },
    'no-build': { type: 'boolean', default: false },
  },
});

const engine = args.engine;
if (!(engine in ENGINES)) {
  throw new Error('--engine must be chromium or webkit');
}

const workload = args.workload;
if (workload !== 'follow' && workload !== 'scroll') {
  throw new Error('--workload must be follow or scroll');
}

const cpu = Number(args.cpu);
if (cpu !== 1 && engine !== 'chromium') {
  throw new Error('CPU throttling exists only in Chromium (CDP); WebKit has none');
}

const rounds = Number(args.rounds);
const warmupMs = Number(args['warmup-ms']);
const measureMs = Number(args['measure-ms']);
const maxLoad = Number(args['max-load']);
const height = Number(args.height);
const sources = Number(args.sources);
const toolbar = args.toolbar;
const tag = args.tag ?? `${engine}-${workload}${cpu === 1 ? '' : `-${cpu}x`}${sources > 0 ? `-${String(sources)}src` : ''}${toolbar ? '-toolbar' : ''}`;
const out = path.join(here, 'results', tag);
mkdirSync(out, { recursive: true });

const configs = (args.configs ?? '').split(',').filter(Boolean).map((token) => {
  const match = /^(kit|control)(?::(\d+))?(?:\/(\d+))?$/.exec(token);
  if (match === null) {
    throw new Error(`bad config ${token}`);
  }

  const rate = Number(match[2] ?? 0);
  if (workload === 'follow' && rate === 0) {
    throw new Error(`config ${token}: the follow workload needs a rate (kit:10000)`);
  }

  return { name: token, variant: match[1], rate, overscan: Number(match[3] ?? 10) };
});
if (configs.length === 0) {
  throw new Error('--configs is required');
}

const baseDist = path.resolve(args.dist ?? path.join(here, '.dist-matrix'));
/** The page of a config: the kit's overscan is a property of the build; the control takes its overscan as a query parameter. */
const distOf = (config) => (config.variant === 'kit' && config.overscan !== 10 ? `${baseDist}-o${config.overscan}` : baseDist);
if (!args['no-build']) {
  buildPage({ react: 'normal', dist: baseDist });
  for (const rows of new Set(configs.filter((config) => config.variant === 'kit' && config.overscan !== 10).map((config) => config.overscan))) {
    buildPage({ react: 'normal', dist: `${baseDist}-o${rows}`, overscan: rows });
  }
}

const servers = new Map();
for (const dist of new Set(configs.map(distOf))) {
  servers.set(dist, await serve(dist));
}

const pageUrl = (config) => {
  const query = new URLSearchParams({ variant: config.variant, rate: String(config.rate), height: String(height), overscan: String(config.overscan), sources: String(sources), ...(toolbar ? { toolbar: '1' } : {}) });
  return `${servers.get(distOf(config)).url}?${query}`;
};

const histogram = (values) => {
  const out = {};
  for (const value of values) {
    out[value] = (out[value] ?? 0) + 1;
  }

  return out;
};

const round1 = (value) => Math.round(value * 10) / 10;
const sum = (values) => values.reduce((total, value) => total + value, 0);

async function followTrial(browser, config) {
  const { context, page, cdp, info, problems } = await openPage(browser, pageUrl(config), { cpu });
  try {
    const idle = await page.evaluate(() => window.__bench.idle(1000));
    // The buffer is at its cap before anything is measured: the steady state of a long session, every new line evicting an old one.
    await page.evaluate(() => {
      window.__bench.fill(100_000);
    });
    const filled = await page.evaluate(() => window.__bench.drained());
    await sleep(1000);
    const geometry = await page.evaluate(() => window.__bench.geometry());
    await page.evaluate(() => {
      window.__bench.watchRoot();
      window.__bench.startStream();
    });
    await sleep(warmupMs);

    const metricsBefore = await cdpMetrics(cdp);
    const statsBefore = await page.evaluate(() => window.__bench.stats());
    const from = await page.evaluate(() => window.__bench.begin());
    await sleep(measureMs);
    const record = await page.evaluate((index) => window.__bench.end(index), from);
    const statsAfter = await page.evaluate(() => window.__bench.stats());
    const metricsAfter = await cdpMetrics(cdp);
    await page.evaluate(() => {
      window.__bench.stopStream();
    });
    // What the view had made of the stream: it must show the newest line and be following, and it must have caught up.
    await sleep(800);
    const final = await page.evaluate(() => window.__bench.finalState());
    const statsEnd = await page.evaluate(() => window.__bench.stats());
    const rootWrites = await page.evaluate(() => window.__bench.rootWrites());
    const shape = await page.evaluate(() => window.__bench.shape());

    const windowMs = sum(record.intervals);
    const emitted = statsAfter.received - statsBefore.received;
    const work = record.work.filter((value) => !Number.isNaN(value));
    return {
      engine, workload, cpu, sources, toolbar, config: config.name, variant: config.variant, rate: config.rate, overscan: config.overscan, height,
      info, idle: { intervals: series(idle.intervals.map(round1)), frames: idle.frames },
      geometry, filled,
      frames: {
        window: record.frames,
        windowMs: round1(windowMs),
        intervals: record.intervals.map(round1),
        work: work.map((value) => Math.round(value * 100) / 100),
        interval: series(record.intervals.map(round1)),
        workSummary: series(work, 2),
        over20: record.intervals.filter((value) => value > 20).length,
        over33: record.intervals.filter((value) => value > 33.4).length,
      },
      rows: { ...series(record.rows, 0), histogram: histogram(record.rows) },
      commits: {
        total: record.commitsTotal,
        perSecond: round1(record.commitsTotal / (windowMs / 1000)),
        frames: record.commitsPerFrame.length,
        maxInAFrame: Math.max(...record.commitsPerFrame),
        perFrame: histogram(record.commitsPerFrame),
      },
      source: {
        requested: config.rate,
        emitted,
        perSecond: Math.round(emitted / (windowMs / 1000)),
        droppedBySource: statsAfter.dropped - statsBefore.dropped,
        heldMax: Math.max(...record.held.filter((value) => !Number.isNaN(value))),
        heldAtEnd: statsAfter.held,
        heldAfterStop: statsEnd.held,
      },
      following: { atEndSamples: record.atEndSamples, atEndTrue: record.atEndTrue, final },
      cdp: metricsDelta(metricsBefore, metricsAfter),
      heapUsedMB: metricsAfter === null ? null : Math.round((metricsAfter.JSHeapUsedSize / 2 ** 20) * 10) / 10,
      longTasks: record.longTasks.length,
      longTaskMaxMs: record.longTasks.length === 0 ? 0 : round1(Math.max(...record.longTasks.map((task) => task.duration))),
      longFrames: record.longFrames.length,
      rootWrites,
      shape,
      problems,
    };
  } finally {
    await context.close();
  }
}

async function scrollTrial(browser, config) {
  const { context, page, cdp, info, problems } = await openPage(browser, pageUrl(config), { cpu });
  try {
    const idle = await page.evaluate(() => window.__bench.idle(1000));
    await page.evaluate(() => {
      window.__bench.fill(100_000);
    });
    const filled = await page.evaluate(() => window.__bench.drained());
    await sleep(1000);
    const geometry = await page.evaluate(() => window.__bench.geometry());
    await page.evaluate(() => {
      window.__bench.sampleScroll = true;
    });
    // Leave the end (follow off) and start from the first line.
    await page.evaluate(() => window.__bench.scrollTo(0));
    await pointerOverList(page);
    const calibration = await calibrate(page);
    await pointerOverList(page);

    const pxPerSec = 1200;
    const pages = 30;
    const durationMs = Math.round(((pages * geometry.viewport) / pxPerSec) * 1000);
    // Warm-up: the same scroll for 3 s, unmeasured; back to the top and a second of quiet.
    await wheel(page, { durationMs: warmupMs, pxPerSec, scale: calibration.scale });
    await page.evaluate(() => window.__bench.scrollTo(0));
    await sleep(1000);

    await page.evaluate(() => {
      window.__bench.watchRoot();
    });
    const metricsBefore = await cdpMetrics(cdp);
    const from = await page.evaluate(() => window.__bench.begin());
    const startTop = await page.evaluate(() => window.__bench.scrollTop());
    const drive = await wheel(page, { durationMs, pxPerSec, scale: calibration.scale });
    // Two more frames' worth, so that the last wheel events have been scrolled and drawn.
    await sleep(120);
    const record = await page.evaluate((index) => window.__bench.end(index), from);
    const metricsAfter = await cdpMetrics(cdp);
    const endTop = await page.evaluate(() => window.__bench.scrollTop());
    const rootWrites = await page.evaluate(() => window.__bench.rootWrites());
    const shape = await page.evaluate(() => window.__bench.shape());

    // The old viewer's own workload: 30 one-page steps down from the top, 250 ms apart, each timed from its scroll event to the frame that shows it.
    await page.evaluate(() => window.__bench.scrollTo(0));
    await sleep(500);
    const jumps = await page.evaluate(() => window.__bench.jumps(30, 250));

    const scroll = scrollWindow(record);
    const work = scroll.work.filter((value) => !Number.isNaN(value));
    return {
      engine, workload, cpu, config: config.name, variant: config.variant, rate: 0, overscan: config.overscan, height,
      info, idle: { intervals: series(idle.intervals.map(round1)), frames: idle.frames }, geometry, filled, calibration,
      drive: { requestedPx: drive.requestedPx, actualHz: drive.actualHz, lateness: drive.latenessMs, failures: drive.failures, pages, pxPerSec, durationMs },
      scroll: { startTop, endTop, deliveredPx: endTop - startTop, deliveredPages: round1((endTop - startTop) / geometry.viewport) },
      frames: {
        window: scroll.frames,
        recorded: record.frames,
        intervals: scroll.intervals,
        work: work.map((value) => Math.round(value * 100) / 100),
        interval: series(scroll.intervals),
        workSummary: series(work, 2),
        over20: scroll.intervals.filter((value) => value > 20).length,
        over33: scroll.intervals.filter((value) => value > 33.4).length,
      },
      rows: { ...series(scroll.rows, 0), histogram: histogram(scroll.rows) },
      commits: { total: record.commitsTotal, frames: record.commitsPerFrame.length, maxInAFrame: Math.max(...record.commitsPerFrame) },
      jumps: { pages: jumps.samples.length, page: jumps.page, samples: jumps.samples.map((value) => Math.round(value * 100) / 100), summary: series(jumps.samples, 2), mounted: series(jumps.mounted, 0) },
      cdp: metricsDelta(metricsBefore, metricsAfter),
      longTasks: record.longTasks.length,
      longFrames: record.longFrames.length,
      rootWrites,
      shape,
      problems,
    };
  } finally {
    await context.close();
  }
}

const run = workload === 'follow' ? followTrial : scrollTrial;
const trials = [];
const started = new Date().toISOString();
process.stdout.write(`${tag}: ${rounds} rounds of ${configs.map((config) => config.name).join(' ')}, load ${load1()}\n`);
for (let round = 0; round < rounds; round += 1) {
  const rotation = round % configs.length;
  const order = [...configs.slice(rotation), ...configs.slice(0, rotation)];
  const browser = await ENGINES[engine].launch();
  const browserVersion = browser.version();
  for (const config of order) {
    let result;
    let attempts = 0;
    const failures = [];
    const loads = [];
    // The trial runs once more when the machine was busier than `--max-load` at its start or its end (the rule: rerun once if high), or when it threw.
    for (; attempts < 2; ) {
      attempts += 1;
      const waited = await quiet(maxLoad);
      const loadStart = load1();
      try {
        result = await run(browser, config);
      } catch (error) {
        failures.push(String(error?.message ?? error).slice(0, 300));
        result = undefined;
        loads.push({ started: waited.started, waitedMs: waited.waited, before: loadStart, after: load1(), threw: true });
        continue;
      }

      const loadEnd = load1();
      loads.push({ started: waited.started, waitedMs: waited.waited, before: loadStart, after: loadEnd });
      result.load = { before: loadStart, started: waited.started, waitedMs: waited.waited, after: loadEnd };
      if (loadStart <= maxLoad && loadEnd <= maxLoad) {
        break;
      }
    }

    if (result === undefined) {
      throw new Error(`${config.name} round ${round} failed ${failures.length} times: ${failures.join(' | ')}`);
    }

    result.round = round;
    result.order = order.map((entry) => entry.name);
    result.attempts = attempts;
    result.attemptLoads = loads;
    result.failures = failures;
    result.highLoad = result.load.before > maxLoad || result.load.after > maxLoad;
    result.browserVersion = browserVersion;
    trials.push(result);
    writeFileSync(path.join(out, `trial-r${String(round).padStart(2, '0')}-${config.name.replace(/[:/]/g, '_')}.json`), JSON.stringify(result));
    const f = result.frames;
    process.stdout.write(`  r${round} ${config.name.padEnd(14)} p50 ${f.interval.p50} p95 ${f.interval.p95} max ${f.interval.max}  work p95 ${f.workSummary.p95} max ${f.workSummary.max}  rows max ${result.rows.max}${result.commits.perSecond === undefined ? '' : `  commits/s ${result.commits.perSecond}`}  load ${result.load.before}/${result.load.after}${attempts > 1 ? `  (attempt ${attempts})` : ''}\n`);
  }

  await browser.close();
}

for (const server of servers.values()) {
  await server.close();
}

const identities = Object.fromEntries([...servers.keys()].map((dist) => [path.basename(dist), pageIdentity(dist)]));
writeFileSync(
  path.join(out, 'meta.json'),
  `${JSON.stringify({
    tag, started, finished: new Date().toISOString(), command: `node bench/log/run.mjs ${process.argv.slice(2).join(' ')}`,
    args, configs, identities, environment: environment({ [engine]: trials[0]?.browserVersion }), trials: trials.length,
  }, null, 2)}\n`,
);
process.stdout.write(`${tag}: done, ${trials.length} trials in ${out}\n`);
