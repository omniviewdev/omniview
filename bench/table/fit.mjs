// B5 in a real engine (page/fit.ts and the table itself): plan time for 5,025 rows by 12 columns, the sampled widths against a full-DOM
// oracle on the real Pod rows and the long-tailed set, and the column widths of the real table while a scripted scroll sweeps all of it.
//
//   node bench/table/fit.mjs --engine webkit [--layouts s,a] [--dist bench/table/.dist-matrix --no-build] [--tag fit]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ENGINES, buildPage, ensureCorpus, environment, here, openPage, pageIdentity, pointerOverTable, serve, sleep, wheel } from './lib.mjs';

const { values: args } = parseArgs({ options: { engine: { type: 'string' }, layouts: { type: 'string', default: 's,a' }, tag: { type: 'string' }, dist: { type: 'string' }, 'no-build': { type: 'boolean', default: false } } });
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
const out = path.join(here, 'results', args.tag ?? `fit-${engine}`);
mkdirSync(out, { recursive: true });
const browser = await ENGINES[engine].launch();
const browserVersion = browser.version();

const results = { engine, kit, fit: [], table: [] };
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${server.url}fit.html`);
  await page.waitForFunction(() => window.__fit !== undefined);
  for (const dataset of ['5025', 'tail-5025', '1025', '25']) {
    results.fit.push(await page.evaluate((name) => window.__fit.run(name), dataset));
  }

  await context.close();
}

// The real table: the widths of the first row's cells after a jump to each of 200 positions through the whole range, and after a wheel scroll.
for (const variant of args.layouts.split(',')) {
  for (const rows of ['5025', 'tail-5025']) {
    const { context, page } = await openPage(browser, `${server.url}?variant=${variant}&rows=${rows}&cells=real`);
    const first = await page.evaluate(() => window.__bench.cellWidths());
    const readings = await page.evaluate(() => window.__bench.sweepWidths(200));
    await pointerOverTable(page);
    await wheel(page, { durationMs: 3000 });
    await sleep(200);
    const afterWheel = await page.evaluate(() => window.__bench.cellWidths());
    const key = (widths) => widths.join(',');
    const changes = readings.filter((reading, index) => index > 0 && key(reading) !== key(readings[index - 1])).length;
    results.table.push({ variant, rows, firstReading: first, changesDuringSweep: changes, positions: readings.length, widthsAfterSweep: readings.at(-1), widthsAfterWheel: afterWheel, changedByWheel: key(afterWheel) !== key(readings.at(-1) ?? []) });
    await context.close();
  }
}

await browser.close();
await server.close();
writeFileSync(path.join(out, 'fit.json'), `${JSON.stringify({ ...results, environment: environment({ [engine]: browserVersion }) }, null, 2)}\n`);
for (const entry of results.fit) {
  const worst = Math.max(...entry.sampleVsOracle.map((column) => Math.abs(column.textDiff)));
  const worstPlan = Math.max(...entry.plans.flatMap((plan) => plan.diff.map(Math.abs)));
  process.stdout.write(`${engine} ${entry.dataset}: plan cold p50 ${entry.planMs.cold.p50.toFixed(2)} p95 ${entry.planMs.cold.p95.toFixed(2)} warm p50 ${entry.planMs.warm.p50.toFixed(2)} ms; sampled vs oracle worst ${worst}px, plan width worst ${worstPlan}px; growth changes ${entry.growth.changes}\n`);
}

for (const entry of results.table) {
  process.stdout.write(`${engine} table ${entry.variant} ${entry.rows}: width changes over ${entry.positions} positions ${entry.changesDuringSweep}, by wheel ${entry.changedByWheel}\n`);
}
