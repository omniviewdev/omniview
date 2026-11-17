// Exact counts of the table in a real engine (plan 3.3 B3, B4, B6, B7; docs/ui-next/optimisations.md MNR-T1, T4, T5, T14): the same
// assertions as packages/kit/src/components/DataTable/DataTable.counts.test.tsx, read from WebKit and Chromium on the real Pod rows with the
// narrow row's real cells (a tile, the name and its tail, the namespace; a status glyph and its word; the age from the kit's clock).
// React's own counts come from the profiling build (react-dom/profiling, a Profiler around the page): it costs time, so this run never
// produces a frame time.
//
//   node bench/table/counts.mjs --engine webkit [--layouts s,a] [--no-build] [--tag counts]
//
//   elements   per mounted row (B4: at most 40), in the whole document at 5,025 rows (B3: at most 3,000), animations at rest (T-29)
//   listeners  `addEventListener` calls through mount, a scroll, a sort and a selection click, and those on the table's own elements, at
//              25, 1,025 and 5,025 rows: equal means none per row (T-07, MNR-T5)
//   commits    React commits and identity-cell calls (one call is one row rendered) for: a patch to a row in view, a patch to a row out of
//              view, a render of the parent with nothing changed, hover over rows, a click on one row's checkbox (T-06, T-09, T-12, MNR-T4)
//   live       10 s of the seeded sparse updates at rest: commits and rows rendered per update event (G-T1, W2)
//   root       attribute writes on <html> and <body> after the page was ready (B7, rule 4)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ENGINES, SPARSE, buildPage, ensureCorpus, environment, here, openPage, pageIdentity, pointerOverTable, serve, sleep, wheel } from './lib.mjs';

const { values: args } = parseArgs({
  options: { engine: { type: 'string' }, layouts: { type: 'string', default: 's' }, tag: { type: 'string' }, dist: { type: 'string' }, 'no-build': { type: 'boolean', default: false }, rows: { type: 'string', default: 'rows' }, seconds: { type: 'string', default: '10' } },
});
const engine = args.engine;
if (!(engine in ENGINES)) {
  throw new Error('--engine must be chromium or webkit');
}

const dist = path.resolve(args.dist ?? path.join(here, '.dist-profiling'));
if (!args['no-build']) {
  buildPage({ react: 'profiling', dist });
}

ensureCorpus();
const kit = pageIdentity(dist);
const server = await serve(dist);
const tag = args.tag ?? `counts-${engine}`;
const out = path.join(here, 'results', tag);
mkdirSync(out, { recursive: true });

const snapshot = (page) => page.evaluate(() => ({ ...window.__bench.profile, cellCalls: window.__cellCalls ?? 0 }));
const delta = (before, after) => ({ commits: after.commits - before.commits, mount: after.mount - before.mount, update: after.update - before.update, rowsRendered: after.cellCalls - before.cellCalls });

async function exercise(browser, variant, rows) {
  const url = `${server.url}?variant=${variant}&rows=${rows}&cells=real&count=1`;
  const { context, page, info, problems } = await openPage(browser, url, { countListeners: true });
  try {
    await sleep(300);
    const result = { variant, rows, ready: info, problems };
    result.shape = await page.evaluate(() => window.__bench.shape());
    result.afterMount = await page.evaluate(() => ({ ...window.__benchCounts }));
    await page.evaluate(() => window.__bench.watchRoot());

    // --- patches, parent render, hover, selection ---
    let before = await snapshot(page);
    await page.evaluate(() => window.__bench.patch('inView'));
    await sleep(300);
    result.patchInView = delta(before, await snapshot(page));

    // With 25 rows the window holds all of them: there is no row out of view to patch.
    if (Number(rows) > result.shape.mountedRows) {
      before = await snapshot(page);
      await page.evaluate(() => window.__bench.patch('outOfView'));
      await sleep(300);
      result.patchOutOfView = delta(before, await snapshot(page));
    } else {
      result.patchOutOfView = null;
    }

    before = await snapshot(page);
    await page.evaluate(() => window.__bench.rerender());
    await sleep(300);
    result.parentRender = delta(before, await snapshot(page));

    before = await snapshot(page);
    const region = page.locator('[data-bench-scroller] tbody tr[data-ov-index], [data-bench-scroller] tbody tr[data-index]');
    for (const position of [2, 4, 6, 8, 10]) {
      const box = await region.nth(position).boundingBox();
      if (box !== null) {
        await page.mouse.move(box.x + 300, box.y + box.height / 2, { steps: 4 });
        await sleep(40);
      }
    }

    result.hover = delta(before, await snapshot(page));

    if (variant !== 'r') {
      before = await snapshot(page);
      await page.locator('[data-ov-select]').nth(3).click();
      await sleep(300);
      result.selectionClick = delta(before, await snapshot(page));
    }

    // --- scroll and sort (the listeners and the root are read after these) ---
    await pointerOverTable(page);
    before = await snapshot(page);
    result.scroll = await wheel(page, { durationMs: 1000, pxPerSec: 1200 });
    await sleep(200);
    result.scrollCounts = delta(before, await snapshot(page));
    if (variant !== 'r') {
      before = await snapshot(page);
      await page.evaluate(() => window.__bench.sort(2));
      result.sortCounts = delta(before, await snapshot(page));
    }

    result.afterInteractions = await page.evaluate(() => ({ ...window.__benchCounts }));
    result.shapeAfter = await page.evaluate(() => window.__bench.shape());
    result.rootWrites = await page.evaluate(() => window.__bench.rootWrites());

    // --- live updates at rest, 10 s ---
    await page.evaluate(() => window.__bench.resetScroll());
    await page.evaluate(() => window.__bench.resetRows());
    await sleep(500);
    before = await snapshot(page);
    await page.evaluate((spec) => window.__bench.startUpdates(spec), SPARSE);
    await sleep(Number(args.seconds) * 1000);
    const ledger = await page.evaluate(() => window.__bench.stopUpdates());
    await sleep(300);
    const live = delta(before, await snapshot(page));
    result.live = { ...live, ledger, commitsPerUpdate: live.commits / ledger.events, rowsRenderedPerUpdate: live.rowsRendered / ledger.events };
    return result;
  } finally {
    await context.close();
  }
}

const layouts = args.layouts.split(',');
const browser = await ENGINES[engine].launch();
const browserVersion = browser.version();
const results = [];
for (const variant of layouts) {
  for (const rows of ['25', '1025', '5025']) {
    const result = await exercise(browser, variant, rows);
    results.push(result);
    process.stdout.write(`${engine} ${variant} ${rows}: elements/row ${JSON.stringify(result.shape.elementsPerRow)}, document ${result.shape.elementsInDocument}, listeners ${result.afterInteractions.adds} (region ${result.afterInteractions.inRegionAdds}), patch in view ${JSON.stringify(result.patchInView)}, out of view ${JSON.stringify(result.patchOutOfView)}, parent ${JSON.stringify(result.parentRender)}, hover ${JSON.stringify(result.hover)}, select ${JSON.stringify(result.selectionClick)}, live ${JSON.stringify({ c: result.live.commitsPerUpdate, r: result.live.rowsRenderedPerUpdate })}, root writes ${result.rootWrites.length}\n`);
  }
}

await browser.close();
await server.close();
writeFileSync(path.join(out, 'counts.json'), `${JSON.stringify({ engine, kit, environment: environment({ [engine]: browserVersion }), results }, null, 2)}\n`);
