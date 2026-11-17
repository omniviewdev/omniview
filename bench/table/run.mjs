// The timing matrix of the table bench (docs/ui-next/status/1a.3.md, the rule written before any measurement; docs/ui-next/status/1a.3b.md).
//
//   pnpm --filter @omniviewdev/kit run build                       # the page imports the BUILT kit
//   node bench/table/run.mjs --engine chromium --workload w1 --configs s,a,r,c --rounds 15 --tag chromium-w1
//
// One ROUND runs every config once, in an order that rotates from round to round (s a r c, a r c s, r c s a, ...), so that machine drift
// hits every config alike: the paired trials of the rule. Every trial is a fresh browser context and page. The 1-minute load average is
// read before and after each trial; a trial that started or ended above `--max-load` (default 12) is repeated (at most twice more; the
// record says how often and the report counts them).
//
//   --engine     chromium | webkit
//   --workload   w0 (static scroll) | w1 (the same scroll with the seeded sparse live updates)
//   --configs    comma list of `variant[@overscan/step]`: s spacer, a absolute, r the old table, c control; e.g. `a@6/3,a@8/4,a@10/4`
//   --rounds     trials per config (default 15)
//   --cpu        CPU throttle rate (Chromium only; default 1)
//   --rows       row file: 5025 (default), 1025, 25 or tail-5025
//   --cells      plain (default) or real
//   --warmup-ms, --measure-ms   3000 and 5000: the scroll of the warm-up and of the measurement, 1,200 px/s at 60 events a second
//   --tag        the output directory name under bench/table/results/
//   --dist       the built page (default bench/table/.dist-normal); with --no-build its identity.json says what it was built from
//   --no-build   reuse the page in --dist instead of building it
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  ENGINES, SPARSE, buildPage, calibrate, cdpMetrics, ensureCorpus, environment, here, load1, metricsDelta, openPage, pageIdentity, pointerOverTable, scrollWindow, serve, series, sleep, wheel,
} from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    engine: { type: 'string' },
    workload: { type: 'string', default: 'w1' },
    configs: { type: 'string', default: 's,r,c' },
    rounds: { type: 'string', default: '15' },
    cpu: { type: 'string', default: '1' },
    rows: { type: 'string', default: '5025' },
    cells: { type: 'string', default: 'plain' },
    'warmup-ms': { type: 'string', default: '3000' },
    'measure-ms': { type: 'string', default: '5000' },
    'max-load': { type: 'string', default: '12' },
    tag: { type: 'string' },
    dist: { type: 'string' },
    'no-build': { type: 'boolean', default: false },
  },
});

const engine = args.engine;
if (!(engine in ENGINES)) {
  throw new Error('--engine must be chromium or webkit');
}

const workload = args.workload;
if (workload !== 'w0' && workload !== 'w1') {
  throw new Error('--workload must be w0 or w1');
}

const cpu = Number(args.cpu);
if (cpu !== 1 && engine !== 'chromium') {
  throw new Error('CPU throttling exists only in Chromium (CDP); WebKit has none');
}

const rounds = Number(args.rounds);
const warmupMs = Number(args['warmup-ms']);
const measureMs = Number(args['measure-ms']);
const maxLoad = Number(args['max-load']);
const tag = args.tag ?? `${engine}-${workload}${cpu === 1 ? '' : `-${cpu}x`}`;
const out = path.join(here, 'results', tag);
mkdirSync(out, { recursive: true });

const configs = args.configs.split(',').map((token) => {
  const match = /^([src])(?:@(\d+)\/(\d+))?$/.exec(token);
  if (match === null) {
    throw new Error(`bad config ${token}`);
  }

  return { name: token, variant: match[1], overscan: Number(match[2] ?? 8), step: Number(match[3] ?? 4) };
});

const dist = path.resolve(args.dist ?? path.join(here, '.dist-normal'));
if (!args['no-build']) {
  buildPage({ react: 'normal', dist });
}

const corpus = ensureCorpus();
const kit = pageIdentity(dist);
const server = await serve(dist);

const pageUrl = (config) => {
  const query = new URLSearchParams({ variant: config.variant, rows: args.rows, cells: args.cells, overscan: String(config.overscan), step: String(config.step) });
  return `${server.url}?${query}`;
};

/** Wait (bounded) for the machine to be quieter than `maxLoad` before a trial starts. */
async function quiet() {
  const started = load1();
  let waited = 0;
  while (load1() > maxLoad && waited < 120_000) {
    await sleep(10_000);
    waited += 10_000;
  }

  return { started, waited };
}

async function trial(browser, config, round, order) {
  const before = await quiet();
  const loadStart = load1();
  const { context, page, cdp, info, problems } = await openPage(browser, pageUrl(config), { cpu });
  try {
    const idle = await page.evaluate(() => window.__bench.idle(1000));
    await pointerOverTable(page);
    const calibration = await calibrate(page);
    await pointerOverTable(page);

    // Warm-up: the same workload, unmeasured, from the top; then back to the top with the rows as they were, and a second of quiet.
    if (workload === 'w1') {
      await page.evaluate((spec) => window.__bench.startUpdates(spec), SPARSE);
    }

    const warm = await wheel(page, { durationMs: warmupMs, scale: calibration.scale });
    if (workload === 'w1') {
      await page.evaluate(() => window.__bench.stopUpdates());
    }

    await page.evaluate(() => window.__bench.resetRows());
    await page.evaluate(() => window.__bench.resetScroll());
    await sleep(1000);

    const metricsBefore = await cdpMetrics(cdp);
    const from = await page.evaluate(() => window.__bench.begin());
    const startTop = await page.evaluate(() => window.__bench.scrollTop());
    if (workload === 'w1') {
      await page.evaluate((spec) => window.__bench.startUpdates(spec), SPARSE);
    }

    const drive = await wheel(page, { durationMs: measureMs, scale: calibration.scale });
    // Two more frames' worth, so that the last wheel events have been scrolled and drawn.
    await sleep(120);
    const record = await page.evaluate((index) => window.__bench.end(index), from);
    const ledger = workload === 'w1' ? await page.evaluate(() => window.__bench.stopUpdates()) : null;
    const metricsAfter = await cdpMetrics(cdp);
    const endTop = await page.evaluate(() => window.__bench.scrollTop());
    const shape = await page.evaluate(() => window.__bench.shape());

    const window_ = scrollWindow(record);
    return {
      engine,
      workload,
      cpu,
      config: config.name,
      variant: config.variant,
      overscan: config.overscan,
      step: config.step,
      rows: args.rows,
      cells: args.cells,
      round,
      order,
      load: { before: loadStart, started: before.started, waitedMs: before.waited, after: load1() },
      info,
      idle: { intervals: series(idle.intervals.map((value) => Math.round(value * 10) / 10)), frames: idle.frames },
      calibration,
      warm: { requestedPx: warm.requestedPx, actualHz: warm.actualHz },
      drive: { requestedPx: drive.requestedPx, actualHz: drive.actualHz, lateness: drive.latenessMs, failures: drive.failures },
      scroll: { startTop, endTop, deliveredPx: endTop - startTop },
      frames: {
        window: window_.frames,
        intervals: window_.intervals,
        work: window_.work.map((value) => (Number.isNaN(value) ? null : Math.round(value * 100) / 100)),
        interval: series(window_.intervals),
        workSummary: series(window_.work, 2),
        recorded: record.frames,
      },
      coverage: record.coverage,
      mounted: series(record.mounted, 0),
      longTasks: record.longTasks.length,
      longFrames: record.longFrames.length,
      cdp: metricsDelta(metricsBefore, metricsAfter),
      updates: ledger,
      shape,
      problems,
    };
  } finally {
    await context.close();
  }
}

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
    let attempt = 0;
    const failures = [];
    for (; attempt < 4; attempt += 1) {
      try {
        result = await trial(browser, config, round, order.map((entry) => entry.name));
      } catch (error) {
        // A trial that threw (a page that never showed a row, an engine that stopped answering) is repeated, and the record says so.
        failures.push(String(error?.message ?? error).slice(0, 300));
        continue;
      }

      if (result.load.before <= maxLoad && result.load.after <= maxLoad) {
        break;
      }
    }

    if (result === undefined) {
      throw new Error(`${config.name} round ${round} failed ${failures.length} times: ${failures.join(' | ')}`);
    }

    result.failures = failures;
    result.attempts = attempt + 1;
    result.browserVersion = browserVersion;
    trials.push(result);
    writeFileSync(path.join(out, `trial-r${String(round).padStart(2, '0')}-${config.name.replace(/[@/]/g, '_')}.json`), JSON.stringify(result));
    process.stdout.write(`  r${round} ${config.name.padEnd(8)} p50 ${result.frames.interval.p50} p95 ${result.frames.interval.p95} max ${result.frames.interval.max}  work p95 ${result.frames.workSummary.p95}  holes ${result.coverage.holes}  load ${result.load.before}/${result.load.after}${result.attempts > 1 ? `  (attempt ${result.attempts})` : ''}\n`);
  }

  await browser.close();
}

await server.close();
writeFileSync(
  path.join(out, 'meta.json'),
  `${JSON.stringify({
    tag, started, finished: new Date().toISOString(), command: `node bench/table/run.mjs ${process.argv.slice(2).join(' ')}`,
    args, configs, kit, corpus: corpus.sources, environment: environment({ [engine]: trials[0]?.browserVersion }), trials: trials.length,
  }, null, 2)}\n`,
);
process.stdout.write(`${tag}: done, ${trials.length} trials in ${out}\n`);
