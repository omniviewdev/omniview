// W3 of docs/ui-next/status/1a.3.md: mount to the first row at 25, 1,025 and 5,025 rows; the bulk re-mount of a 60-row window (B1); the sort
// by Name from a click to the next painted frame at 5,025 rows. Configs are interleaved like the matrix's: every page is fresh.
//
//   node bench/table/w3.mjs --engine webkit --configs s,a,r --only b1,mount,sort --rounds 15 [--dist bench/table/.dist-matrix --no-build]
//
//   mount  `mountToFirstRowMs`: from the render call to the macrotask after the first frame that has a mounted row with a height
//   b1     30 jumps after 5 warm-ups, each from the scroll event that moves the window to the end of the frame that shows the new rows;
//          the region is 1,720 px tall so that the window (the rows in view and the overscan) holds about 60 rows; `pages` fresh pages
//   sort   15 sorts by Name (alternating direction), each from the click to the macrotask after the next frame
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ENGINES, buildPage, ensureCorpus, environment, here, load1, pageIdentity, serve, series } from './lib.mjs';

const { values: args } = parseArgs({
  options: { engine: { type: 'string' }, configs: { type: 'string', default: 's,a,r' }, only: { type: 'string', default: 'b1,mount,sort' }, rounds: { type: 'string', default: '15' }, pages: { type: 'string', default: '5' }, tag: { type: 'string' }, dist: { type: 'string' }, 'no-build': { type: 'boolean', default: false } },
});
const engine = args.engine;
if (!(engine in ENGINES)) {
  throw new Error('--engine must be chromium or webkit');
}

const dist = path.resolve(args.dist ?? path.join(here, '.dist-normal'));
if (!args['no-build']) {
  buildPage({ react: 'normal', dist });
}

ensureCorpus();
const kit = pageIdentity(dist);
const server = await serve(dist);
const tag = args.tag ?? `w3-${engine}`;
const out = path.join(here, 'results', tag);
mkdirSync(out, { recursive: true });
const only = new Set(args.only.split(','));
const configs = args.configs.split(',');
const rounds = Number(args.rounds);
const results = { engine, kit, b1: [], mount: [], sort: [] };

async function page(browser, config, query, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const tab = await context.newPage();
  await tab.goto(`${server.url}?variant=${config}&${query}`);
  const info = await tab.evaluate(() => window.__bench.ready);
  return { context, tab, info };
}

const browser = await ENGINES[engine].launch();
const browserVersion = browser.version();

if (only.has('mount')) {
  for (let round = 0; round < rounds; round += 1) {
    for (const rows of ['25', '1025', '5025']) {
      const order = [...configs.slice(round % configs.length), ...configs.slice(0, round % configs.length)];
      for (const config of order) {
        const { context, info } = await page(browser, config, `rows=${rows}&cells=plain`, { width: 1440, height: 900 });
        results.mount.push({ config, rows, round, mountToFirstRowMs: info.mountToFirstRowMs, mountedRows: info.mountedRows, elements: info.elements, load: load1() });
        await context.close();
      }
    }
  }
}

if (only.has('b1')) {
  for (let round = 0; round < Number(args.pages); round += 1) {
    const order = [...configs.slice(round % configs.length), ...configs.slice(0, round % configs.length)];
    for (const config of order) {
      const { context, tab, info } = await page(browser, config, 'rows=5025&cells=plain&height=1720', { width: 1440, height: 1900 });
      const { samples, mountedRows } = await tab.evaluate(() => window.__bench.remount(30, 5));
      results.b1.push({ config, round, samples, mountedRows, windowRows: info.mountedRows, load: load1() });
      await context.close();
    }
  }
}

if (only.has('sort')) {
  for (let round = 0; round < Number(args.pages); round += 1) {
    const order = [...configs.slice(round % configs.length), ...configs.slice(0, round % configs.length)];
    for (const config of order) {
      const { context, tab } = await page(browser, config, 'rows=5025&cells=plain', { width: 1440, height: 900 });
      const samples = await tab.evaluate(() => window.__bench.sort(15));
      results.sort.push({ config, round, samples, load: load1() });
      await context.close();
    }
  }
}

await browser.close();
await server.close();

// ---- summary ----
const summary = {};
for (const config of configs) {
  summary[config] = {
    mount: Object.fromEntries(['25', '1025', '5025'].map((rows) => [rows, series(results.mount.filter((entry) => entry.config === config && entry.rows === rows).map((entry) => entry.mountToFirstRowMs), 1)])),
    b1: series(results.b1.filter((entry) => entry.config === config).flatMap((entry) => entry.samples), 1),
    b1Pages: results.b1.filter((entry) => entry.config === config).map((entry) => ({ p50: series(entry.samples, 1).p50, p95: series(entry.samples, 1).p95 })),
    b1Window: [...new Set(results.b1.filter((entry) => entry.config === config).flatMap((entry) => entry.mountedRows))],
    sort: series(results.sort.filter((entry) => entry.config === config).flatMap((entry) => entry.samples), 1),
  };
}

writeFileSync(path.join(out, 'w3.json'), `${JSON.stringify({ ...results, environment: environment({ [engine]: browserVersion }), summary }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
