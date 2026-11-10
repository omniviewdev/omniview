import assert from 'node:assert/strict';
import test from 'node:test';

import { compare, summarize } from './report.mjs';

const KEY = 'pods-paced[metrics=healthy,updates=none,cpu=1x]';

function result({ reactDom = 'react-dom/client', p95 = [18, 19, 17], minify = false, harness = 'd'.repeat(64), deviations = [], task = 8400 } = {}) {
  const meta = {
    date: '2026-11-09T00:00:00.000Z', commit: 'abc1234', dirty: false, k8sPlugin: 'def5678', chromium: '140.0', host: 'test machine', runs: 5, cpuThrottle: 1,
    frontend: {
      config: 'bench/app/vite.config.ts', reactBuild: reactDom === 'react-dom/client' ? 'normal' : 'profiling', reactDom,
      minify: { setting: 'app', effective: minify }, rebuilt: true, manifest: { state: 'verified' },
      bundle: { treeSHA256: 'a'.repeat(64), bytes: 22 * 2 ** 20, files: 3 },
    },
    hostSource: { state: 'identified', head: 'f'.repeat(40), short: 'abc1234', dirty: false, trackedDiffSHA256: 'b'.repeat(64) },
    plugin: { checkout: { state: 'identified', short: 'def5678', dirty: false }, bundle: { treeSHA256: 'c'.repeat(64) } },
    harness: { treeSHA256: harness, files: 20 },
    engine: { name: 'chromium', version: '140.0', headless: false,
      graphics: { state: 'available', compositing: 'enabled', rasterization: 'enabled', renderer: 'test GPU' } },
    environment: { cpuModel: 'Apple M1', osRelease: '25.0' },
    ui: { '@omniviewdev/base-ui': { state: 'resolved', declared: '~0.17.1', version: '0.17.1', source: 'linked-checkout', git: { state: 'identified', short: '05ea005', dirty: false }, dist: { treeSHA256: 'e'.repeat(64) } } },
    label: 'baseline',
    appRoot: '/work/baseline/omniview',
    protocol: { deviations },
    scenarios: {
      [KEY]: {
        definition: {
          scenario: 'pods-paced',
          workload: { id: 'pods-paced/v1', kind: 'paced', driver: 'cdp-wheel', params: { pods: 5000, trials: 3, warmupSeconds: 30, trialSeconds: 20, speedPxPerSecond: 1200, inputHz: 60, updates: 'none' } },
          metrics: 'healthy', updates: 'none', cpuThrottle: 1,
        },
        table: {
          columns: { count: 14, headers: ['', 'Name', 'CPU', 'Memory'] },
          rows: { served: 5000, impliedByGeometry: 5000, mounted: 76, rowHeightPx: 30 },
          domElements: 5809, scroller: { maxScroll: 149_100 }, viewport: { width: 1440, height: 900 },
        },
        display: { medianMs: 16.7, estimatedHz: 60 },
        capabilities: { timerResolutionMs: 0.1 },
        wheelCalibration: { requestedPx: 200, pageSawDeltaYSum: 200, pageSawEvents: 10, observedScrollPx: 200, ratio: 1, scale: 1 },
        protocolDeviations: deviations,
      },
    },
  };
  const trials = p95.map((value, i) => ({
    index: i + 1,
    scroll: {
      windowMs: 21_000, frames: 1200, frameP50Ms: 16.7, frameP95Ms: value, frameP99Ms: 20, frameMaxMs: 30, taskMs: task,
      // Unsupported by the engine: unavailable, not zero.
      longTasks: null, longTaskMaxMs: null,
    },
    errors: [], notes: [],
  }));
  return { meta, results: { [KEY]: trials } };
}

test('a scroll cell reports its declared workload, observed table and unavailable signals without inventing zeros', () => {
  const summary = summarize(result());
  assert.match(summary, /#### pods-paced\[metrics=healthy,updates=none,cpu=1x\]/);
  assert.match(summary, /Workload pods-paced\/v1 \(cdp-wheel\): 1200 px\/s as 60 wheel events\/s from Node over CDP for 20 s/);
  assert.match(summary, /Observed table: 14 columns/);
  assert.match(summary, /5000 Pods served, 5000 implied by table height; 76 rows mounted/);
  assert.match(summary, /Wheel calibration: 200 px requested/);
  assert.match(summary, /\| \*\*median\*\* \|/);
  // The React family has no value in a normal build: stated once, not as zeros.
  assert.match(summary, /React \(profiling build only\) and DOM: unavailable for this cell/);
  assert.doesNotMatch(summary, /Whole-app profile[\s\S]*Median of 5 runs/, 'a scroll-only result has no legacy run line');
  assert.doesNotMatch(summary, /unknown legacy workload/);
  assert.match(summary, /No page errors, console errors, failed requests or notices/);
});

test('an unsupported long-task signal is a dash in an otherwise available family', () => {
  const summary = summarize(result());
  const row = summary.split('\n').find((line) => line.startsWith('| 1 |') && line.includes('8400'));
  assert.ok(row, 'the main-thread row exists');
  assert.match(row, /—/);
});

test('the nominal-scroll targets are informational and name the measured medians', () => {
  const summary = summarize(result());
  assert.match(summary, /Sprint nominal-scroll targets \(#459\), informational only/);
  assert.match(summary, /frame interval p95 18 ms \(within 20 ms\)/);
});

test('errors and notes recorded in a trial are listed with their trial', () => {
  const data = result();
  data.results[KEY][1].errors = ['console error: Failed to load resource (/assets/x.js)'];
  data.results[KEY][2].notes = ['2 of 1200 wheel events were not acknowledged'];
  data.meta.scenarios[KEY].notices = ['Activity observation The operation could not be completed.'];
  const summary = summarize(data);
  assert.match(summary, /- trial 2: console error: Failed to load resource/);
  assert.match(summary, /- trial 3: 2 of 1200 wheel events were not acknowledged/);
  assert.match(summary, /visible notice at ready: "Activity observation/);
  assert.doesNotMatch(summary, /No page errors, console errors/);
});

test('a run that is not the reference protocol says so', () => {
  const summary = summarize(result({ deviations: ['2 s warmup, the reference is 30 s'] }));
  assert.match(summary, /This run differs from the reference protocol:\*\* 2 s warmup/);
  assert.match(summary, /Not the reference protocol:\*\* 2 s warmup/);
});

test('comparing normal and profiling builds refuses to compute any delta', () => {
  const text = compare(result(), result({ reactDom: 'react-dom/profiling' }));
  assert.match(text, /Not comparable — no deltas are computed/);
  assert.match(text, /React build differs \(react-dom\/client vs react-dom\/profiling\)/);
  assert.doesNotMatch(text, /\| metric \|/);
});

test('comparing builds with different minifiers or harness bytes is refused', () => {
  assert.match(compare(result(), result({ minify: 'esbuild' })), /minifier differs/);
  assert.match(compare(result(), result({ harness: '1'.repeat(64) })), /harness bytes differ/);
});

test('graphics mode changes cannot produce a performance delta', () => {
  for (const change of [
    (engine) => { engine.headless = true; },
    (engine) => { engine.graphics.compositing = 'disabled_software'; },
    (engine) => { engine.graphics.rasterization = 'disabled_software'; },
    (engine) => { engine.graphics.renderer = 'different GPU'; },
    (engine) => { delete engine.graphics; },
  ]) {
    const candidate = result({ p95: [1, 1, 1] });
    change(candidate.meta.engine);
    const text = compare(result(), candidate);
    assert.match(text, /Not comparable/);
    assert.doesNotMatch(text, /\| frame interval p95 ms \|/);
  }
});

test('comparable results show medians, ranges and a verdict with a tolerance band', () => {
  const text = compare(result({ p95: [20, 21, 19], task: 8400 }), result({ p95: [15, 16, 14], task: 8460 }));
  assert.doesNotMatch(text, /Not comparable/);
  assert.match(text, /\| frame interval p95 ms \| 20\.00 \(19\.00–21\.00\) \| 15\.00 \(14\.00–16\.00\) \| -5\.00 \(-25\.0%\) better \|/);
  // 8400 ms over a 21 s window is 400 ms/s; 8460 is 402.86 ms/s, inside the 2% band.
  assert.match(text, /\| main-thread task ms\/s \| 400\.00 \(400\.00–400\.00\) \| 402\.86 \(402\.86–402\.86\) \| \+2\.86 \(0\.7%\) same \|/);
  // A signal neither side supplied has no row at all.
  assert.doesNotMatch(text, /long tasks/);
});

test('cells whose workload parameters differ are not paired', () => {
  const candidate = result();
  candidate.meta.scenarios[KEY].definition.workload.params.speedPxPerSecond = 900;
  assert.match(compare(result(), candidate), /Workload ids or declared parameters differ; this cell is not compared/);
});

test('provenance of both sides is shown, including the resolved shared UI package', () => {
  const text = compare(result(), result());
  assert.match(text, /\| @omniviewdev\/base-ui \| 0\.17\.1 linked-checkout 05ea005 dist eeeeeeeeeeee \|/);
  assert.match(text, /\| harness bytes \| dddddddddddd \| dddddddddddd \|/);
  assert.match(text, /\| frontend \| react-dom\/client, minify false \|/);
});
