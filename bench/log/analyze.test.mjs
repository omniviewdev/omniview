// node --test bench/log/analyze.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { BUDGETS, commitsPass, p95Gate, rowsPass, spread, summary } from './analyze.mjs';

test('p95Gate: an unmeasured (null) kit median is not run, never a pass', () => {
  assert.equal(p95Gate('chromium', null, null, BUDGETS.followP95ChromiumMs, BUDGETS.followP95WebkitOverControl).pass, null);
  assert.equal(p95Gate('webkit', null, 10, BUDGETS.followP95ChromiumMs, BUDGETS.followP95WebkitOverControl).pass, null);
});

test('p95Gate: a null control median gives no limit (not 0) and not run', () => {
  const gate = p95Gate('webkit', 10, null, BUDGETS.followP95ChromiumMs, BUDGETS.followP95WebkitOverControl);
  assert.equal(gate.limit, null);
  assert.equal(gate.pass, null);
  assert.equal(p95Gate('webkit', 10, undefined, 16.7, 1.1).pass, null);
});

test('p95Gate: measured medians are still judged', () => {
  assert.deepEqual(p95Gate('chromium', 16.7, null, 16.7, 1.1), { limit: 16.7, pass: true });
  assert.equal(p95Gate('chromium', 16.8, null, 16.7, 1.1).pass, false);
  const ok = p95Gate('webkit', 11, 10, 16.7, 1.1);
  assert.equal(ok.pass, true);
  assert.ok(Math.abs(ok.limit - 11) < 1e-9);
  assert.equal(p95Gate('webkit', 11.1, 10, 16.7, 1.1).pass, false);
});

const commits = (perSecond, maxInAFrame) => ({ commitsPerSecond: spread(perSecond), commitsMaxInAFrame: spread(maxInAFrame) });

test('commitsPass: two commits in one frame fail even at 59 commits a second', () => {
  assert.equal(commitsPass(commits([59, 59, 59], [1, 2, 1])), false);
});

test('commitsPass: one commit a frame at 60.0/s passes', () => {
  assert.equal(commitsPass(commits([60, 60, 60], [1, 1, 1])), true);
  assert.equal(commitsPass(commits([60.04], [1])), true);
});

test('commitsPass: over 60.0/s fails; no rate or no per-frame figure is not run', () => {
  assert.equal(commitsPass(commits([61, 61], [1, 1])), false);
  assert.equal(commitsPass(commits([], [])), null);
  assert.equal(commitsPass(commits([60], [])), null);
});

test('rowsPass: a row count that was never measured is not run, never a pass; a measured count over the budget fails', () => {
  assert.equal(rowsPass({ measured: false, worst: 0 }), null);
  assert.equal(rowsPass({ measured: true, worst: 48 }), true);
  assert.equal(rowsPass({ measured: true, worst: 49 }), false);
});

test('summary keeps each memory trial\'s growthOfHeld', () => {
  const engine = { follow: {}, scroll: {}, search: [], counts: null, meta: {} };
  const result = {
    prefix: 'x',
    budgets: [],
    engines: { chromium: engine, webkit: engine },
    memory: [
      { round: 0, h0MB: 1, h1MB: 25, h2MB: 25.1, heldMB: 24, growthMB: 0.1, growthOfHeld: 0.002, bytesPerLine: 250, streamed: 1_000_000, load: { before: 1, after: 2 }, attempts: 1 },
      { round: 1, h0MB: 1, h1MB: 25, h2MB: 25, heldMB: 24, growthMB: 0, growthOfHeld: 0, bytesPerLine: 250, streamed: 1_000_000, load: { before: 1, after: 2 }, attempts: 1 },
    ],
  };
  assert.deepEqual(summary(result).memory.map((trial) => trial.growthOfHeld), [0.002, 0]);
});
