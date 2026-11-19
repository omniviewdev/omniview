// Exact counts of the log view in a real engine (docs/ui-next/optimisations.md HLT-1, HLT-2, HLT-3, MNR-L1, L2, L3, L6): the same assertions as the kit's
// jsdom tests (LogView.test.tsx), read from WebKit and Chromium with the built package.
//
//   node bench/log/counts.mjs --engine webkit [--no-build] [--tag counts-webkit]
//
//   listeners  `addEventListener` calls through mount, a fill, a scroll and a search, and those on a node of the stage, with 60, 1,000 and 100,000 lines:
//              equal means no listener per row (T-07, MNR-L1); and what `removeEventListener` took back when the view was unmounted
//   rows       the rows mounted with 60, 1,000 and 100,000 lines, at the end of the log and a quarter of the way down it (bounded by the window, not the buffer)
//   elements   per mounted row, and in the document
//   root       attribute writes on <html> and <body> after the page was ready, and custom properties written to either (rule 4)
//   commits    the DevTools hook's count against the Profiler's, for 3 s of 10,000 lines a second (the profiling build): the hook is what every other run reads
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { countsFailures, ownWrites } from './counts-checks.mjs';
import { ENGINES, STAGE_HEIGHT, buildPage, environment, here, openPage, pageIdentity, serve, sleep } from './lib.mjs';

const { values: args } = parseArgs({
  options: { engine: { type: 'string' }, tag: { type: 'string' }, dist: { type: 'string' }, 'no-build': { type: 'boolean', default: false }, height: { type: 'string', default: String(STAGE_HEIGHT) } },
});
const engine = args.engine;
if (!(engine in ENGINES)) {
  throw new Error('--engine must be chromium or webkit');
}

const dist = path.resolve(args.dist ?? path.join(here, '.dist-counts'));
const profilingDist = `${dist}-profiling`;
if (!args['no-build']) {
  buildPage({ react: 'normal', dist });
  buildPage({ react: 'profiling', dist: profilingDist });
}

const server = await serve(dist);
const profilingServer = await serve(profilingDist);
const tag = args.tag ?? `counts-${engine}`;
const out = path.join(here, 'results', tag);
mkdirSync(out, { recursive: true });
const browser = await ENGINES[engine].launch();
const browserVersion = browser.version();

async function exercise(lines) {
  const url = `${server.url}?${new URLSearchParams({ variant: 'kit', rate: '0', height: args.height })}`;
  const { context, page, info, problems } = await openPage(browser, url, { countListeners: true });
  try {
    // What the mount wrote at the root: the harness has watched since before the first mount. Kept whole; judged without the ThemeProvider's own attributes.
    const mountRootWrites = await page.evaluate(() => [...window.__bench.rootWrites()]);
    await page.evaluate(() => {
      window.__bench.watchRoot();
    });
    const result = { lines, problems, mountRootWrites };
    result.afterMount = await page.evaluate(() => ({ ...window.__benchCounts }));
    await page.evaluate((count) => {
      window.__bench.fill(count);
    }, lines);
    await page.evaluate(() => window.__bench.drained());
    await sleep(300);
    result.geometry = await page.evaluate(() => window.__bench.geometry());
    result.rowsAtEnd = await page.evaluate(() => window.__bench.rowsMounted());
    result.shape = await page.evaluate(() => window.__bench.shape());
    // A quarter of the way down, if there is a way down.
    await page.evaluate((top) => window.__bench.scrollTo(top), Math.round(((lines * 24) / 4) | 0));
    await sleep(300);
    result.rowsQuarter = await page.evaluate(() => window.__bench.rowsMounted());
    result.scrollTop = await page.evaluate(() => window.__bench.scrollTop());
    // A search over what is there ("connection reset": about 4% of the lines).
    const expected = await page.evaluate((count) => window.__bench.expectedMatches('connection reset', false, count), lines);
    result.search = await page.evaluate(([q, n]) => window.__bench.search(q, n, undefined).then((found) => ({ doneMs: found.doneMs, lane: found.lane })), ['connection reset', expected]);
    await page.evaluate(() => window.__bench.clearSearch());
    result.afterInteractions = await page.evaluate(() => ({ ...window.__benchCounts }));
    await page.evaluate(() => {
      window.__bench.unmount?.();
    });
    await sleep(100);
    result.afterUnmount = await page.evaluate(() => ({ ...window.__benchCounts }));
    // What was written at the root is read after the unmount, so that the cleanup is in scope (B9); the listener counts keep the snapshot before it, for what the unmount took back. The ThemeProvider takes
    // its own data attributes off <html> when it unmounts, as it set them at mount: that is the provider's, not the view's (`ownWrites`), at either end.
    result.rootWrites = [...ownWrites(mountRootWrites), ...ownWrites(await page.evaluate(() => window.__bench.rootWrites()))];
    result.info = info;
    return result;
  } finally {
    await context.close();
  }
}

const results = [];
for (const lines of [60, 1000, 100_000]) {
  const result = await exercise(lines);
  results.push(result);
  process.stdout.write(
    `${engine} ${lines.toLocaleString('en-US')} lines: rows at the end ${result.rowsAtEnd}, a quarter down ${result.rowsQuarter}, elements/row ${JSON.stringify(result.shape.elementsPerRow)}, document ${result.shape.elementsInDocument}, listeners added ${result.afterInteractions.adds} (stage ${result.afterInteractions.inStageAdds}), removed on unmount ${result.afterUnmount.removes - result.afterInteractions.removes} (stage ${result.afterUnmount.inStageRemoves - result.afterInteractions.inStageRemoves}), root writes ${result.rootWrites.length}, custom properties at the root ${result.afterUnmount.rootCustomWrites}\n`,
  );
}

// The hook against the Profiler, on the profiling build.
const profilingUrl = `${profilingServer.url}?${new URLSearchParams({ variant: 'kit', rate: '10000', height: args.height, profile: '1' })}`;
const profiled = await openPage(browser, profilingUrl);
let commits;
try {
  await profiled.page.evaluate(() => {
    window.__bench.fill(100_000);
  });
  await profiled.page.evaluate(() => window.__bench.drained());
  const before = await profiled.page.evaluate(() => ({ hook: window.__bench.commits(), profiler: window.__benchProfileCommits ?? 0 }));
  await profiled.page.evaluate(() => {
    window.__bench.startStream();
  });
  await sleep(3000);
  await profiled.page.evaluate(() => {
    window.__bench.stopStream();
  });
  await sleep(500);
  const after = await profiled.page.evaluate(() => ({ hook: window.__bench.commits(), profiler: window.__benchProfileCommits ?? 0 }));
  commits = { hook: after.hook - before.hook, profiler: after.profiler - before.profiler, hookTotal: after.hook, profilerTotal: after.profiler };
  process.stdout.write(`${engine} commits over 3 s at 10,000 lines/s: hook ${commits.hook}, Profiler ${commits.profiler} (totals since load ${commits.hookTotal} and ${commits.profilerTotal})\n`);
} finally {
  await profiled.context.close();
}

await browser.close();
await server.close();
await profilingServer.close();
writeFileSync(path.join(out, 'counts.json'), `${JSON.stringify({ engine, identity: pageIdentity(dist), profilingIdentity: pageIdentity(profilingDist), environment: environment({ [engine]: browserVersion }), results, commits }, null, 2)}\n`);

// The file is written first, for the diagnosis; then the run fails when a required check does not hold (the root writes, the hook's count against the Profiler's).
const failures = countsFailures({ results, commits });
for (const failure of failures) {
  process.stderr.write(`counts check failed: ${failure}\n`);
}

if (failures.length > 0) {
  process.exitCode = 1;
}
