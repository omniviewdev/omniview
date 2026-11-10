import assert from 'node:assert/strict';
import test from 'node:test';

import { LEGACY_SCENARIOS, parseOptions, protocolDeviations, SCROLL_SCENARIOS } from './options.mjs';
import { buildCells, cellKey, metricRefreshFor, wheelPlan, workloadParams } from './workloads.mjs';

const context = { harnessRoot: '/h/omniview', cwd: '/w', env: {}, now: new Date('2026-11-09T10:00:00Z') };
const parse = (...argv) => parseOptions(argv, context);

test('the default command line is the legacy whole-app profile, unchanged', () => {
  const options = parse();
  assert.deepEqual(options.legacy, [...LEGACY_SCENARIOS]);
  assert.deepEqual(options.scroll, []);
  assert.equal(options.react, 'profiling');
  assert.equal(options.runs, 5);
  assert.deepEqual(options.cpuThrottles, [1]);
  assert.equal(options.out, '/h/omniview/bench/app/results/latest.json');
  assert.equal(options.dist, '/h/omniview/bench/app/dist');
  assert.equal(options.markdown, null);
});

test('scroll scenarios must say which React build they measure', () => {
  assert.throws(() => parse('--only', 'scroll'), /--react normal\|profiling is required/);
  assert.throws(() => parse('--only', 'pods-paced', '--react', 'minified'), /--react must be normal or profiling/);
  assert.deepEqual(parse('--only', 'scroll', '--react', 'normal').scroll, [...SCROLL_SCENARIOS]);
});

test('a reused build may omit --react: its manifest says what it is', () => {
  assert.doesNotThrow(() => parse('--only', 'scroll', '--no-build'));
});

test('the legacy scenarios take a single CPU throttle; scroll cells may take several', () => {
  assert.throws(() => parse('--cpu-throttle', '1,4'), /legacy scenarios take one/);
  assert.deepEqual(parse('--only', 'scroll', '--react', 'normal', '--cpu-throttle', '1,4').cpuThrottles, [1, 4]);
  assert.throws(() => parse('--cpu-throttle', '0.5'), /--cpu-throttle/);
});

test('a scroll run writes under .local and its own markdown, never over the legacy receipt', () => {
  const options = parse('--only', 'scroll', '--react', 'normal', '--label', 'baseline');
  assert.equal(options.out, '/h/omniview/.local/bench-app/results/baseline-normal-20261109T100000Z.json');
  assert.equal(options.markdown, '/h/omniview/.local/bench-app/results/baseline-normal-20261109T100000Z.md');
  assert.match(options.dist, /^\/h\/omniview\/\.local\/bench-app\/builds\/baseline-[0-9a-f]{8}-normal\/dist$/);
});

test('another app root gets its own build directory, never the harness default', () => {
  const options = parse('--react', 'normal', '--build-only', '--app-root', '/b/base/omniview');
  assert.equal(options.appRoot, '/b/base/omniview');
  assert.match(options.dist, /\/\.local\/bench-app\/builds\/base-[0-9a-f]{8}-normal\/dist$/);
  assert.equal(options.buildOnly, true);
});

test('build-only and serve-only need a React build and exclude each other', () => {
  assert.throws(() => parse('--build-only'), /--react/);
  assert.throws(() => parse('--build-only', '--serve-only', '--react', 'normal'), /mutually exclusive/);
  assert.throws(() => parse('--build-only', '--no-build', '--react', 'normal'), /contradict/);
});

test('the smoke preset shortens the protocol and is reported as a deviation', () => {
  const smoke = parse('--only', 'pods-paced', '--react', 'normal', '--smoke');
  assert.equal(smoke.warmupSeconds, 2);
  assert.equal(smoke.trialSeconds, 3);
  assert.equal(smoke.trials, 1);
  const deviations = protocolDeviations(smoke, { reactBuild: 'normal', refreshHz: 60 });
  assert.ok(deviations.some((line) => /2 s warmup/.test(line)));
  assert.ok(deviations.some((line) => /3 s trials/.test(line)));
  // An explicit value still wins over the preset.
  assert.equal(parse('--only', 'pods-paced', '--react', 'normal', '--smoke', '--trial-seconds', '5').trialSeconds, 5);
});

test('the reference protocol on a 60 Hz display, normal build, has no deviation', () => {
  const options = parse('--only', 'scroll', '--react', 'normal');
  assert.equal(options.warmupSeconds, 30);
  assert.equal(options.trialSeconds, 20);
  assert.equal(options.trials, 3);
  assert.equal(options.pods, 5000);
  assert.deepEqual(protocolDeviations(options, { reactBuild: 'normal', refreshHz: 60 }), []);
});

test('a profiling build, a forced minifier or a 120 Hz display is never read as the reference', () => {
  const options = parse('--only', 'scroll', '--react', 'profiling', '--minify', 'on');
  const deviations = protocolDeviations(options, { reactBuild: 'profiling', refreshHz: 120 });
  assert.ok(deviations.some((line) => /React build is profiling/.test(line)));
  assert.ok(deviations.some((line) => /minifier forced on/.test(line)));
  assert.ok(deviations.some((line) => /120 Hz/.test(line)));
  assert.equal(options.mutations, true, 'mutation attribution defaults on only for profiling builds');
  assert.equal(parse('--only', 'scroll', '--react', 'normal').mutations, false);
});

test('the matrix expands scenario × metric state × update workload × CPU throttle', () => {
  const options = parse('--only', 'pods-paced,pods-jump', '--react', 'normal', '--metrics', 'healthy,hidden', '--updates', 'none,sparse', '--cpu-throttle', '1,4');
  const cells = buildCells(options);
  assert.equal(cells.length, 2 * 2 * 2 * 2);
  assert.equal(cells[0].key, cellKey('pods-paced', 'healthy', 'none', 1));
  assert.equal(new Set(cells.map((cell) => cell.key)).size, cells.length);
  assert.ok(cells.every((cell) => cell.workload.id.endsWith('/v1')));
});

test('the declared parameters are recorded with the workload, and sparse updates declare their metric refresh', () => {
  const options = parse('--only', 'pods-reversal', '--react', 'normal', '--updates', 'sparse', '--speed', '900', '--reversal-segment-seconds', '3');
  const [cell] = buildCells(options);
  const params = workloadParams(options, cell);
  assert.equal(params.speedPxPerSecond, 900);
  assert.equal(params.segmentSeconds, 3);
  assert.equal(params.updates.metricRefreshMs, 5000);
  assert.equal(metricRefreshFor(options, cell), 5000);
  const quiet = buildCells(parse('--only', 'pods-paced', '--react', 'normal', '--metrics', 'healthy'))[0];
  assert.equal(metricRefreshFor(options, quiet), null);
  assert.equal(workloadParams(parse('--only', 'pods-paced', '--react', 'normal'), quiet).updates, 'none');
});

const table = { maxScroll: 150_000, rowHeightPx: 30 };

test('the paced plan is one constant-velocity segment and fails loudly when the table is too short', () => {
  const options = parse('--only', 'pods-paced', '--react', 'normal');
  const [cell] = buildCells(options);
  const plan = wheelPlan(options, cell, table);
  assert.equal(plan.startPx, 0);
  assert.deepEqual(plan.segments, [{ durationMs: 20_000, pxPerSec: 1200 }]);
  assert.throws(() => wheelPlan(options, cell, { maxScroll: 5000, rowHeightPx: 30 }), /scrolls only 5000 px/);
});

test('the reversal plan alternates direction and stays clear of both boundaries', () => {
  const options = parse('--only', 'pods-reversal', '--react', 'normal');
  const [cell] = buildCells(options);
  const plan = wheelPlan(options, cell, table);
  assert.equal(plan.segments.length, 10);
  assert.deepEqual(plan.segments.slice(0, 3).map((segment) => Math.sign(segment.pxPerSec)), [1, -1, 1]);
  // A segment travels 2 s × 1200 px/s = 2400 px; the start sits one travel plus a margin below the top.
  assert.equal(plan.startPx, 2400 + 60);
  assert.throws(() => wheelPlan(options, cell, { maxScroll: 3000, rowHeightPx: 30 }), /scrolls only/);
});

test('the jump workload has no wheel plan: it is a settling in-page driver', () => {
  const options = parse('--only', 'pods-jump', '--react', 'normal');
  const [cell] = buildCells(options);
  assert.equal(cell.workload.driver, 'in-page-settle');
  assert.throws(() => wheelPlan(options, cell, table), /no wheel plan/);
  assert.equal(workloadParams(options, cell).pages, 30);
});

test('sampling coverage less often than every frame is reported as a deviation', () => {
  const options = parse('--only', 'pods-paced', '--react', 'normal', '--coverage-every', '2');
  assert.equal(options.coverageEvery, 2);
  assert.ok(protocolDeviations(options, { reactBuild: 'normal', refreshHz: 60 }).some((line) => /every 2 frames/.test(line)));
  assert.throws(() => parse('--only', 'pods-paced', '--react', 'normal', '--coverage-every', '0'), /--coverage-every/);
});
