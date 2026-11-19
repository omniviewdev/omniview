// The search workload of the log bench: time to search a full 100,000-line buffer, and what a frame costs while it runs (rule of docs/ui-next/status/P1b-2.md:
// "a literal and a simple regex finish within 250 ms in total, and no slice holds a frame longer than 8 ms").
//
//   node bench/log/search.mjs --engine webkit --rounds 10 --tag m1-webkit-search
//
// A trial is a fresh page of the kit's LogView, the buffer filled to its cap (100,000 lines from the seeded source, nothing streaming), a second of rest, then:
//   literal  `connection reset`, as pasted (one input event), the find field's count lane read until it says `N of N`, N being what the page computed by
//            running the view's own rule (case-insensitive, over the text without its escapes) on the same seeded lines
//   regex    `attempt [34]\)` with the regular-expression toggle on, the same way
//   none     `zzzzqq`: a scan that finds nothing, the whole buffer and no match handling (the lane says `No results`)
//   typed    the literal typed at one character every 80 ms: the keystrokes restart the scan each time; the time is from the LAST keystroke
// Time is from the input event to the commit that puts the final count in the lane (a MutationObserver on the lane). The lane reaches its final text when the
// last matching line is found; the scan may go on over the lines after it, which at these densities (about 4% and 2% of the lines) is under 100 lines.
// Frames are every frame between the input event and two frames after the lane says it: rAF intervals and frame work (callbacks, style and layout).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ENGINES, STAGE_HEIGHT, buildPage, environment, here, load1, metricsDelta, cdpMetrics, openPage, pageIdentity, quiet, serve, series, sleep } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    engine: { type: 'string' },
    rounds: { type: 'string', default: '10' },
    height: { type: 'string', default: String(STAGE_HEIGHT) },
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

const rounds = Number(args.rounds);
const maxLoad = Number(args['max-load']);
const height = Number(args.height);
const tag = args.tag ?? `${engine}-search`;
const out = path.join(here, 'results', tag);
mkdirSync(out, { recursive: true });
const dist = path.resolve(args.dist ?? path.join(here, '.dist-matrix'));
if (!args['no-build']) {
  buildPage({ react: 'normal', dist });
}

const server = await serve(dist);
const url = `${server.url}?${new URLSearchParams({ variant: 'kit', rate: '0', height: String(height) })}`;
const round1 = (value) => Math.round(value * 10) / 10;

const QUERIES = {
  literal: { query: 'connection reset', regex: false },
  regex: { query: String.raw`attempt [34]\)`, regex: true },
  none: { query: 'zzzzqq', regex: false },
};

async function frames(record) {
  const work = record.work.filter((value) => !Number.isNaN(value));
  return {
    frames: record.frames,
    interval: series(record.intervals.map(round1)),
    work: series(work, 2),
    workMax: work.length === 0 ? null : Math.round(Math.max(...work) * 100) / 100,
    over20: record.intervals.filter((value) => value > 20).length,
    over33: record.intervals.filter((value) => value > 33.4).length,
    longTasks: record.longTasks.length,
    longTaskMaxMs: record.longTasks.length === 0 ? 0 : round1(Math.max(...record.longTasks.map((task) => task.duration))),
    longFrames: record.longFrames.length,
  };
}

async function trial(browser) {
  const { context, page, cdp, info, problems } = await openPage(browser, url);
  try {
    await page.evaluate(() => {
      window.__bench.fill(100_000);
    });
    const filled = await page.evaluate(() => window.__bench.drained());
    // The page's own count of what each query must find (the reference is dropped before anything is measured).
    const expected = {};
    for (const [name, { query, regex }] of Object.entries(QUERIES)) {
      expected[name] = await page.evaluate(([q, r]) => window.__bench.expectedMatches(q, r, 100_000), [query, regex]);
    }

    await sleep(1500);
    const rest = await page.evaluate(() => window.__bench.idle(1500));
    await page.evaluate(() => {
      window.__bench.watchRoot();
    });

    const result = { rest: await frames(rest), expected };
    for (const [name, { query, regex }] of Object.entries(QUERIES)) {
      await page.evaluate((on) => {
        window.__bench.setRegex(on);
      }, regex);
      await sleep(100);
      const metricsBefore = await cdpMetrics(cdp);
      const found = await page.evaluate(([q, n]) => window.__bench.search(q, n, undefined), [query, expected[name]]);
      const metricsAfter = await cdpMetrics(cdp);
      result[name] = { doneMs: found.doneMs === null ? null : round1(found.doneMs), lane: found.lane, wanted: found.wanted, ...(await frames(found.record)), cdp: metricsDelta(metricsBefore, metricsAfter) };
      await page.evaluate(() => window.__bench.clearSearch());
      await sleep(500);
    }

    // Typed: the literal, one character every 80 ms, with the regular-expression toggle off.
    await page.evaluate(() => {
      window.__bench.setRegex(false);
    });
    await sleep(100);
    const typed = await page.evaluate(([q, n]) => window.__bench.search(q, n, 80), [QUERIES.literal.query, expected.literal]);
    result.typed = { doneMs: typed.doneMs === null ? null : round1(typed.doneMs), lane: typed.lane, wanted: typed.wanted, ...(await frames(typed.record)) };
    await page.evaluate(() => window.__bench.clearSearch());

    result.rootWrites = await page.evaluate(() => window.__bench.rootWrites());
    result.shape = await page.evaluate(() => window.__bench.shape());
    result.filled = filled;
    result.info = info;
    result.problems = problems;
    return result;
  } finally {
    await context.close();
  }
}

const trials = [];
const started = new Date().toISOString();
process.stdout.write(`${tag}: ${rounds} trials, load ${load1()}\n`);
for (let round = 0; round < rounds; round += 1) {
  const browser = await ENGINES[engine].launch();
  const browserVersion = browser.version();
  let result;
  let attempts = 0;
  const failures = [];
  while (attempts < 2) {
    attempts += 1;
    const waited = await quiet(maxLoad);
    const before = load1();
    try {
      result = await trial(browser);
    } catch (error) {
      failures.push(String(error?.message ?? error).slice(0, 300));
      result = undefined;
      continue;
    }

    result.load = { before, started: waited.started, waitedMs: waited.waited, after: load1() };
    if (before <= maxLoad && result.load.after <= maxLoad) {
      break;
    }
  }

  await browser.close();
  if (result === undefined) {
    throw new Error(`round ${round} failed: ${failures.join(' | ')}`);
  }

  result.round = round;
  result.attempts = attempts;
  result.failures = failures;
  result.highLoad = result.load.before > maxLoad || result.load.after > maxLoad;
  result.browserVersion = browserVersion;
  trials.push(result);
  writeFileSync(path.join(out, `trial-r${String(round).padStart(2, '0')}-search.json`), JSON.stringify(result));
  process.stdout.write(`  r${round} literal ${result.literal.doneMs} ms (work max ${result.literal.workMax})  regex ${result.regex.doneMs} ms (work max ${result.regex.workMax})  none ${result.none.doneMs} ms  typed ${result.typed.doneMs} ms  matches ${result.expected.literal}/${result.expected.regex}  load ${result.load.before}/${result.load.after}${attempts > 1 ? `  (attempt ${attempts})` : ''}\n`);
}

await server.close();
writeFileSync(
  path.join(out, 'meta.json'),
  `${JSON.stringify({ tag, started, finished: new Date().toISOString(), command: `node bench/log/search.mjs ${process.argv.slice(2).join(' ')}`, args, queries: QUERIES, identity: pageIdentity(dist), environment: environment({ [engine]: trials[0]?.browserVersion }), trials: trials.length }, null, 2)}\n`,
);
process.stdout.write(`${tag}: done, ${trials.length} trials in ${out}\n`);
