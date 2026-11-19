// A diagnostic of memory.mjs: the heap after each of several runs of lines through a full buffer, so that growth that stops (warm-up: compiled code, feedback, the engine's own tables)
// can be told from growth that does not (a leak). Chromium only; one trial.
//
//   node bench/log/memory-phases.mjs --phases 5 --lines 1000000 --tag diag-chromium-phases [--no-build]
//
// The heap is read after two forced collections: with nothing held (h0), with 100,000 lines held (h1), and after each phase, the source stopped and the view caught up. `snapshots` takes a heap
// snapshot at h1 and after the last phase and prints the constructors whose count or size grew most: what the growth is made of.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ENGINES, STAGE_HEIGHT, buildPage, environment, heapUsed, here, load1, openPage, pageIdentity, requireWorkload, serve, sleep } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    phases: { type: 'string', default: '4' },
    lines: { type: 'string', default: '1000000' },
    snapshots: { type: 'boolean', default: false },
    height: { type: 'string', default: String(STAGE_HEIGHT) },
    rate: { type: 'string', default: '50000' },
    variant: { type: 'string', default: 'kit' },
    tag: { type: 'string', default: 'diag-chromium-phases' },
    dist: { type: 'string' },
    'no-build': { type: 'boolean', default: false },
  },
});

const phases = Number(args.phases);
const perPhase = Number(args.lines);
const out = path.join(here, 'results', args.tag);
mkdirSync(out, { recursive: true });
const dist = path.resolve(args.dist ?? path.join(here, '.dist-matrix'));
if (!args['no-build']) {
  buildPage({ react: 'normal', dist });
}

const MB = 2 ** 20;
const round1 = (value) => Math.round((value / MB) * 100) / 100;

/** The constructors of a heap snapshot with their counts and self sizes (the snapshot is read from CDP's chunks and parsed once). */
async function constructors(cdp) {
  const chunks = [];
  const onChunk = ({ chunk }) => chunks.push(chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  const snapshot = JSON.parse(chunks.join(''));
  const { node_fields: fields, node_types: types } = snapshot.snapshot.meta;
  const stride = fields.length;
  const nameAt = fields.indexOf('name');
  const typeAt = fields.indexOf('type');
  const sizeAt = fields.indexOf('self_size');
  const kinds = types[0];
  const map = new Map();
  for (let at = 0; at < snapshot.nodes.length; at += stride) {
    const kind = kinds[snapshot.nodes[at + typeAt]];
    const name = snapshot.strings[snapshot.nodes[at + nameAt]];
    const key = kind === 'object' || kind === 'closure' || kind === 'code' || kind === 'hidden' || kind === 'native' ? `${kind}:${name}` : `${kind}:${kind === 'string' || kind === 'concatenated string' || kind === 'sliced string' ? '(strings)' : name.slice(0, 40)}`;
    const entry = map.get(key) ?? { count: 0, size: 0 };
    entry.count += 1;
    entry.size += snapshot.nodes[at + sizeAt];
    map.set(key, entry);
  }

  return map;
}

// Acquired inside the try, so that a failure to launch or to open the page still closes what was opened before it.
let server;
let browser;
let context;
const result = { args, load: load1(), phases: [] };
try {
  server = await serve(dist);
  const url = `${server.url}?${new URLSearchParams({ variant: args.variant, rate: args.rate, height: String(args.height) })}`;
  browser = await ENGINES.chromium.launch();
  const opened = await openPage(browser, url);
  const { page, cdp } = opened;
  context = opened.context;
  result.info = opened.info;
  await sleep(500);
  const h0 = await heapUsed(cdp);
  await page.evaluate(() => {
    window.__bench.fill(100_000);
  });
  await page.evaluate(() => window.__bench.drained());
  await sleep(1000);
  const h1 = await heapUsed(cdp);
  result.h0MB = round1(h0);
  result.h1MB = round1(h1);
  const before = args.snapshots ? await constructors(cdp) : null;
  let previous = h1;
  for (let phase = 1; phase <= phases; phase += 1) {
    const first = await page.evaluate(() => window.__bench.stats());
    const start = first.received;
    await page.evaluate(() => {
      window.__bench.startStream();
    });
    let streamed = 0;
    const startedAt = Date.now();
    while (streamed < perPhase && Date.now() - startedAt < 180_000) {
      await sleep(500);
      streamed = (await page.evaluate(() => window.__bench.stats())).received - start;
    }

    await page.evaluate(() => {
      window.__bench.stopStream();
    });
    await page.evaluate(() => window.__bench.drained());
    // A phase that stopped short of its lines, or in which the feed dropped lines, is not the phase asked for: the run ends here, and no `phases.json` says it was complete.
    const last = await page.evaluate(() => window.__bench.stats());
    requireWorkload(streamed, perPhase, Math.round((Date.now() - startedAt) / 1000), last.dropped - first.dropped);
    await sleep(1000);
    const h = await heapUsed(cdp);
    result.phases.push({ phase, streamed, heapMB: round1(h), growthFromH1MB: round1(h - h1), growthFromPreviousMB: round1(h - previous) });
    process.stdout.write(`phase ${phase}: streamed ${streamed.toLocaleString('en-US')}, heap ${round1(h)} MB, from h1 ${round1(h - h1)} MB, from the phase before ${round1(h - previous)} MB\n`);
    previous = h;
  }

  if (args.snapshots) {
    const after = await constructors(cdp);
    const grown = [...after.entries()]
      .map(([key, entry]) => ({ key, count: entry.count - (before.get(key)?.count ?? 0), size: entry.size - (before.get(key)?.size ?? 0) }))
      .filter((entry) => entry.size > 20_000 || entry.count > 2000)
      .sort((a, b) => b.size - a.size)
      .slice(0, 25);
    result.grown = grown;
    for (const entry of grown) {
      process.stdout.write(`  ${entry.key.padEnd(52)} count ${String(entry.count).padStart(8)}  size ${String(Math.round(entry.size / 1024)).padStart(8)} KB\n`);
    }
  }
} finally {
  await context?.close();
  await browser?.close();
  await server?.close();
}

result.environment = environment({ chromium: browser.version?.() });
result.identity = pageIdentity(dist);
writeFileSync(path.join(out, 'phases.json'), `${JSON.stringify(result, null, 2)}\n`);
