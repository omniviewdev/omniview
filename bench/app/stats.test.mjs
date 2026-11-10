import assert from 'node:assert/strict';
import test from 'node:test';

import {
  median,
  pathLength,
  quantileSorted,
  requestedLagPx,
  summarizeCoverage,
  summarizeFrames,
  summarizeLag,
  summarizeSeries,
} from './stats.mjs';

test('nearest-rank quantiles return a sample that happened and never interpolate', () => {
  const sorted = [10, 20, 30, 40];
  assert.equal(quantileSorted(sorted, 0.5), 20);
  assert.equal(quantileSorted(sorted, 0.75), 30);
  assert.equal(quantileSorted(sorted, 0.99), 40);
  assert.equal(quantileSorted(sorted, 0), 10);
  assert.equal(quantileSorted([], 0.5), null);
});

test('an empty series is unavailable (null), never zero', () => {
  const summary = summarizeSeries([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.p95, null);
  assert.equal(summary.max, null);
  assert.equal(median([]), null);
});

test('frame intervals count the thresholds, estimate missed refreshes and locate the gaps', () => {
  const timestamps = [0, 16, 32, 48, 148, 164];
  const summary = summarizeFrames(timestamps, { refreshMs: 16 });
  assert.equal(summary.frames, 6);
  assert.equal(summary.intervals, 5);
  assert.equal(summary.maxMs, 100);
  assert.equal(summary.p50Ms, 16);
  assert.deepEqual(summary.over, { 20: 1, 33.4: 1, 50: 1, 100: 0 });
  // 100 ms at a 16 ms refresh is six slots: five were missed.
  assert.equal(summary.droppedEstimate, 5);
  assert.deepEqual(summary.gaps, [{ atMs: 48, ms: 100 }]);
});

test('a frame window uses only the intervals whose both frames are inside it', () => {
  const summary = summarizeFrames([0, 16, 32, 48, 148, 164], { startMs: 16, endMs: 148 });
  assert.equal(summary.frames, 4);
  assert.equal(summary.intervals, 3);
  assert.equal(summary.maxMs, 100);
  assert.equal(summarizeFrames([5], {}).p95Ms, null);
});

test('without a refresh estimate dropped frames are unavailable, not zero', () => {
  assert.equal(summarizeFrames([0, 16, 32]).droppedEstimate, null);
});

test('coverage never scores samples at a scroll boundary and finds the longest hole', () => {
  const series = {
    t: [0, 1, 2, 3, 4, 5],
    coverage: [1, 1, 0.5, 0.5, 1, 0.2],
    above: [0, 40, 40, 40, 40, 0],
    below: [0, 10, -30, -20, 5, -60],
    rows: [70, 70, 72, 72, 72, 70],
    edge: [1, 0, 0, 0, 0, 1],
  };
  const summary = summarizeCoverage(series);
  assert.equal(summary.samples, 6);
  assert.equal(summary.scored, 4);
  assert.equal(summary.edgeSamples, 2);
  assert.equal(summary.min, 0.5);
  assert.equal(summary.holes, 2);
  assert.equal(summary.holeFraction, 0.5);
  assert.equal(summary.longestHoleSamples, 2);
  assert.equal(summary.longestHoleMs, 2);
  assert.equal(summary.minBelowPx, -30);
  assert.equal(summary.minAbovePx, 40);
  assert.deepEqual(summary.rows, { min: 70, p50: 72, max: 72 });
});

test('coverage with nothing scored is unavailable', () => {
  const summary = summarizeCoverage({ t: [0], coverage: [1], above: [0], below: [0], rows: [1], edge: [1] });
  assert.equal(summary.scored, 0);
  assert.equal(summary.min, null);
  assert.equal(summary.holes, null);
});

test('lag is the distance between the declared position and the actual one on aligned clocks', () => {
  const lag = requestedLagPx({
    plannedEpochMs: [100, 200, 300],
    cumulativePx: [20, 40, 60],
    startScrollTop: 1000,
    samples: [
      { epochMs: 50, scrollTop: 1000 },
      { epochMs: 150, scrollTop: 1020 },
      { epochMs: 250, scrollTop: 1030 },
      { epochMs: 350, scrollTop: 1010 },
    ],
  });
  assert.deepEqual(lag, [0, 0, 10, 50]);
  const summary = summarizeLag(lag, 1200);
  assert.equal(summary.maxPx, 50);
  // 50 px at 1200 px/s is 41.7 ms.
  assert.equal(summary.maxMs, 41.7);
  assert.equal(summarizeLag([], 1200).maxPx, null);
});

test('path length sums movement in both directions', () => {
  assert.equal(pathLength([0, 10, 4, 4, 14]), 26);
  assert.equal(pathLength([]), 0);
});
