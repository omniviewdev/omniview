// The memory workload of the log bench (Chromium only: the JS heap is read through CDP after two forced collections; WebKit gives a page no way to read it
// from outside). Rule of docs/ui-next/status/P1b-2.md: "the heap after 100,000 lines held is within 2 x the old viewer's measured 24 MB per 100,000 lines of
// the stream's buffer (P1b-1), flat after another 1,000,000 lines go by".
//
//   node bench/log/memory.mjs --rounds 10 --tag m1-chromium-memory
//
// A trial is a fresh page of the kit's LogView with the seeded source at 50,000 lines a second:
//   h0  the heap with nothing in the buffer
//   h1  after 100,000 lines are held (the cap), the source's own copies collected: what the view keeps
//   h2  after a further 1,000,000 lines have gone through the view at 50,000 lines a second (20 s), the buffer full the whole time and every line evicting one
// "Flat" is read as: h2 - h1 at most 10% of h1 - h0 (written before the first run).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ENGINES, STAGE_HEIGHT, buildPage, cdpMetrics, environment, heapUsed, here, load1, openPage, pageIdentity, quiet, requireWorkload, serve, sleep } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    rounds: { type: 'string', default: '10' },
    lines: { type: 'string', default: '1000000' },
    height: { type: 'string', default: String(STAGE_HEIGHT) },
    'max-load': { type: 'string', default: '12' },
    tag: { type: 'string' },
    dist: { type: 'string' },
    'no-build': { type: 'boolean', default: false },
  },
});

const rounds = Number(args.rounds);
const more = Number(args.lines);
const maxLoad = Number(args['max-load']);
const tag = args.tag ?? 'chromium-memory';
const out = path.join(here, 'results', tag);
mkdirSync(out, { recursive: true });
const dist = path.resolve(args.dist ?? path.join(here, '.dist-matrix'));
if (!args['no-build']) {
  buildPage({ react: 'normal', dist });
}

const server = await serve(dist);
const url = `${server.url}?${new URLSearchParams({ variant: 'kit', rate: '50000', height: String(args.height) })}`;
const MB = 2 ** 20;
const round1 = (value) => Math.round((value / MB) * 10) / 10;

async function trial(browser) {
  const { context, page, cdp, info, problems } = await openPage(browser, url);
  try {
    await sleep(500);
    const h0 = await heapUsed(cdp);
    await page.evaluate(() => {
      window.__bench.fill(100_000);
    });
    await page.evaluate(() => window.__bench.drained());
    await sleep(1000);
    const h1 = await heapUsed(cdp);
    const metrics1 = await cdpMetrics(cdp);
    const first = await page.evaluate(() => window.__bench.stats());
    const before = first.received;
    await page.evaluate(() => {
      window.__bench.startStream();
    });
    let streamed = 0;
    const startedAt = Date.now();
    while (streamed < more && Date.now() - startedAt < 120_000) {
      await sleep(500);
      streamed = (await page.evaluate(() => window.__bench.stats())).received - before;
    }

    await page.evaluate(() => {
      window.__bench.stopStream();
    });
    await page.evaluate(() => window.__bench.drained());
    const last = await page.evaluate(() => window.__bench.stats());
    requireWorkload(streamed, more, Math.round((Date.now() - startedAt) / 1000), last.dropped - first.dropped);
    await sleep(1000);
    const h2 = await heapUsed(cdp);
    const metrics2 = await cdpMetrics(cdp);
    const final = await page.evaluate(() => window.__bench.finalState());
    const stats = await page.evaluate(() => window.__bench.stats());
    return {
      info,
      h0MB: round1(h0), h1MB: round1(h1), h2MB: round1(h2),
      heldMB: round1(h1 - h0),
      growthMB: round1(h2 - h1),
      growthOfHeld: Math.round(((h2 - h1) / (h1 - h0)) * 1000) / 1000,
      bytesPerLine: Math.round((h1 - h0) / 100_000),
      streamed, streamSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
      received: stats.received,
      nodes: [metrics1?.Nodes, metrics2?.Nodes],
      listeners: [metrics1?.JSEventListeners, metrics2?.JSEventListeners],
      final,
      problems,
    };
  } finally {
    await context.close();
  }
}

const trials = [];
const started = new Date().toISOString();
process.stdout.write(`${tag}: ${rounds} trials of 100,000 held and ${more.toLocaleString('en-US')} more, load ${load1()}\n`);
for (let round = 0; round < rounds; round += 1) {
  const browser = await ENGINES.chromium.launch();
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
  writeFileSync(path.join(out, `trial-r${String(round).padStart(2, '0')}-memory.json`), JSON.stringify(result));
  process.stdout.write(`  r${round} h0 ${result.h0MB} h1 ${result.h1MB} h2 ${result.h2MB} MB  held ${result.heldMB} MB (${result.bytesPerLine} B/line)  growth ${result.growthMB} MB (${result.growthOfHeld * 100}% of held)  streamed ${result.streamed} in ${result.streamSeconds}s  newest line shown ${result.final.lastRowShowsNewestLine}  load ${result.load.before}/${result.load.after}${attempts > 1 ? `  (attempt ${attempts})` : ''}\n`);
}

await server.close();
writeFileSync(
  path.join(out, 'meta.json'),
  `${JSON.stringify({ tag, started, finished: new Date().toISOString(), command: `node bench/log/memory.mjs ${process.argv.slice(2).join(' ')}`, args, identity: pageIdentity(dist), environment: environment({ chromium: trials[0]?.browserVersion }), trials: trials.length }, null, 2)}\n`,
);
process.stdout.write(`${tag}: done, ${trials.length} trials in ${out}\n`);
