import assert from 'node:assert/strict';
import test from 'node:test';

import { CAPTURE_SCHEMA, captureProblems } from './capture-contract.mjs';

const complete = () => ({
  capture: {
    schema: CAPTURE_SCHEMA,
    frames: { refreshMs: 16.7 },
    coverage: { supported: true },
    input: { supported: true },
    scroller: { startScrollTop: 0 },
    series: { coverage: { t: [1, 2, 3] } },
  },
  flat: { frames: 120, coverageMean: 1, deliveredPxAtInputEnd: 3600, lagP95Px: 12 },
});

test('a complete full capture has no problems', () => {
  assert.deepEqual(captureProblems({ captureMode: 'full', kind: 'wheel', ...complete() }), []);
});

test('a page built with another schema fails with both schemas named', () => {
  const trial = complete();
  trial.capture.schema = 'ov-bench-capture/v1';
  const [problem] = captureProblems({ captureMode: 'full', kind: 'wheel', ...trial });
  assert.match(problem, /v1.*v2|v2.*v1|ov-bench-capture\/v1/);
  assert.match(problem, /rebuild/);
});

test('a full capture without coverage samples is a failure, not null fields', () => {
  const trial = complete();
  trial.capture.series.coverage.t = [];
  Object.assign(trial.flat, { coverageMean: null, deliveredPxAtInputEnd: null, lagP95Px: null });
  const problems = captureProblems({ captureMode: 'full', kind: 'wheel', ...trial });
  assert.ok(problems.some((line) => /coverage sampling produced no samples/.test(line)));
  assert.ok(problems.some((line) => /scroll position at the end of input/.test(line)));
  assert.ok(problems.some((line) => /scroll lag/.test(line)));
});

test('the jump workload has no declared input, so no lag is required', () => {
  const trial = complete();
  trial.flat.lagP95Px = null;
  assert.deepEqual(captureProblems({ captureMode: 'full', kind: 'jump', ...trial }), []);
});

test('the light capture promises frame intervals only', () => {
  const trial = complete();
  trial.capture.coverage = { supported: false };
  trial.capture.input = { supported: false };
  Object.assign(trial.flat, { coverageMean: null, deliveredPxAtInputEnd: null, lagP95Px: null });
  assert.deepEqual(captureProblems({ captureMode: 'frames', kind: 'wheel', ...trial }), []);
  trial.flat.frames = 0;
  assert.match(captureProblems({ captureMode: 'frames', kind: 'wheel', ...trial })[0], /no frame intervals/);
});

test('no capture is checked when none was asked for, and a missing one is a failure otherwise', () => {
  assert.deepEqual(captureProblems({ captureMode: 'off', kind: 'wheel', capture: null, flat: {} }), []);
  assert.match(captureProblems({ captureMode: 'full', kind: 'wheel', capture: null, flat: {} })[0], /returned no capture/);
});
