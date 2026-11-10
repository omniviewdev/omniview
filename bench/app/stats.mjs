/**
 * Pure statistics for bench/app. The page-side capture (bundled into the app) and the
 * Node runner and report import this same module, so a number computed in a native
 * WebView and the same number computed from a Chromium run mean the same thing.
 *
 * Nothing here touches the DOM, Node APIs or timers. Missing input is `null` (the
 * signal is unavailable), never `0`.
 */

/** Frame-interval thresholds counted by `summarizeFrames`, in milliseconds. */
export const FRAME_THRESHOLDS_MS = Object.freeze([20, 33.4, 50, 100]);

/** Round to `digits` decimal places (three by default); return null for a non-finite or nonnumeric value. */
const round = (value, digits = 3) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
export { round };

/** Finite numbers only, ascending. */
export function finiteSorted(values) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Nearest-rank quantile of an ascending array: the smallest sample with at least
 * `p` of the samples at or below it. It never interpolates, so a tail quantile is
 * always a frame that really happened. Empty input is `null`.
 */
export function quantileSorted(sorted, p) {
  const n = sorted.length;
  if (n === 0) return null;
  if (p <= 0) return sorted[0];
  if (p >= 1) return sorted[n - 1];
  return sorted[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
}

/** Arithmetic mean of finite numeric samples; null when none remain. */
export function mean(values) {
  const sorted = finiteSorted(values);
  if (!sorted.length) return null;
  let sum = 0;
  for (const value of sorted) sum += value;
  return sum / sorted.length;
}

/** Median of finite numeric samples, averaging the middle pair for an even count; null when none remain. */
export function median(values) {
  const sorted = finiteSorted(values);
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Sum of finite numeric samples; zero when none remain. */
export function sum(values) {
  let total = 0;
  for (const value of finiteSorted(values)) total += value;
  return total;
}

/**
 * Count and rounded statistics of finite numeric samples, using nearest-rank quantiles.
 * `digits` sets decimal places (three by default). With no samples, count is zero and all statistics are null.
 */
export function summarizeSeries(values, digits = 3) {
  const sorted = finiteSorted(values);
  const n = sorted.length;
  if (!n) return { count: 0, min: null, mean: null, p50: null, p90: null, p95: null, p99: null, max: null };
  let total = 0;
  for (const value of sorted) total += value;
  return {
    count: n,
    min: round(sorted[0], digits),
    mean: round(total / n, digits),
    p50: round(quantileSorted(sorted, 0.5), digits),
    p90: round(quantileSorted(sorted, 0.9), digits),
    p95: round(quantileSorted(sorted, 0.95), digits),
    p99: round(quantileSorted(sorted, 0.99), digits),
    max: round(sorted[n - 1], digits),
  };
}

/** Median of the spacing between consecutive timestamps; null with fewer than two. */
export function medianSpacing(timestamps) {
  const spacing = [];
  for (let i = 1; i < timestamps.length; i++) spacing.push(timestamps[i] - timestamps[i - 1]);
  return median(spacing);
}

/**
 * Frame-interval summary from requestAnimationFrame timestamps. Only frames whose
 * timestamp lies inside [startMs, endMs] are used. An interval counts for the window
 * when both of its frames do.
 *
 * `refreshMs` (the idle rAF cadence) turns each interval into a count of missed refresh
 * slots: round(interval / refreshMs) - 1. That is an estimate from page-visible
 * callbacks, never a compositor drop count.
 *
 * `gaps` lists the largest intervals above `gapThresholdMs`, newest data last by time,
 * with `atMs` measured from `originMs` (the first included frame by default).
 */
export function summarizeFrames(timestamps, options = {}) {
  const {
    startMs = -Infinity,
    endMs = Infinity,
    originMs,
    refreshMs = null,
    gapThresholdMs = FRAME_THRESHOLDS_MS[1],
    gapLimit = 20,
  } = options;
  const frames = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    if (t >= startMs && t <= endMs) frames.push(t);
  }
  const intervals = [];
  for (let i = 1; i < frames.length; i++) intervals.push(frames[i] - frames[i - 1]);
  const origin = originMs ?? (frames.length ? frames[0] : 0);
  const sorted = finiteSorted(intervals);
  const n = sorted.length;
  const over = {};
  for (const threshold of FRAME_THRESHOLDS_MS) over[threshold] = sorted.filter((v) => v > threshold).length;
  let dropped = null;
  if (typeof refreshMs === 'number' && refreshMs > 0 && n) {
    dropped = 0;
    for (const interval of sorted) dropped += Math.max(0, Math.round(interval / refreshMs) - 1);
  }
  const gaps = [];
  for (let i = 0; i < intervals.length; i++) {
    if (intervals[i] > gapThresholdMs) gaps.push({ atMs: round(frames[i] - origin, 1), ms: round(intervals[i], 1) });
  }
  gaps.sort((a, b) => b.ms - a.ms);
  gaps.length = Math.min(gaps.length, gapLimit);
  gaps.sort((a, b) => a.atMs - b.atMs);
  let total = 0;
  for (const interval of sorted) total += interval;
  return {
    frames: frames.length,
    intervals: n,
    spanMs: frames.length > 1 ? round(frames[frames.length - 1] - frames[0], 1) : null,
    meanMs: n ? round(total / n) : null,
    minMs: n ? round(sorted[0]) : null,
    p50Ms: n ? round(quantileSorted(sorted, 0.5)) : null,
    p90Ms: n ? round(quantileSorted(sorted, 0.9)) : null,
    p95Ms: n ? round(quantileSorted(sorted, 0.95)) : null,
    p99Ms: n ? round(quantileSorted(sorted, 0.99)) : null,
    maxMs: n ? round(sorted[n - 1]) : null,
    fpsMean: n && total > 0 ? round((n * 1000) / total, 2) : null,
    over,
    refreshMs: typeof refreshMs === 'number' ? round(refreshMs, 3) : null,
    droppedEstimate: dropped,
    gapThresholdMs,
    gaps,
  };
}

/**
 * Viewport-coverage summary. `series` is column-oriented (`t`, `coverage`, `above`,
 * `below`, `rows`, `edge`), all the same length. Samples taken while the scroller sat at
 * a scroll boundary are `edge` samples: the end of a list may legitimately leave part of
 * the viewport empty, so they are counted but never scored.
 *
 * `above`/`below` are how far mounted rows extend beyond the viewport edges, in px
 * (negative is an uncovered strip). A hole is a scored sample below `fullThreshold`.
 */
export function summarizeCoverage(series, options = {}) {
  const { startMs = -Infinity, endMs = Infinity, fullThreshold = 0.999 } = options;
  const t = series.t ?? [];
  const scored = [];
  let edgeSamples = 0;
  let inWindow = 0;
  for (let i = 0; i < t.length; i++) {
    if (!(t[i] >= startMs && t[i] <= endMs)) continue;
    inWindow++;
    if (series.edge && series.edge[i]) { edgeSamples++; continue; }
    scored.push(i);
  }
  if (!scored.length) {
    return {
      samples: inWindow, scored: 0, edgeSamples, sampleEveryMs: null,
      min: null, p01: null, p05: null, mean: null,
      holes: null, holeFraction: null, longestHoleSamples: null, longestHoleMs: null,
      minAbovePx: null, minBelowPx: null, rows: { min: null, p50: null, max: null },
    };
  }
  const coverage = scored.map((i) => series.coverage[i]);
  const sorted = finiteSorted(coverage);
  const spacing = medianSpacing(scored.map((i) => t[i]));
  let holes = 0;
  let longest = 0;
  let longestMs = 0;
  let run = 0;
  let runStart = 0;
  for (let k = 0; k < scored.length; k++) {
    const hole = series.coverage[scored[k]] < fullThreshold;
    if (hole) {
      holes++;
      if (run === 0) runStart = t[scored[k]];
      run++;
      const span = t[scored[k]] - runStart + (spacing ?? 0);
      if (run > longest) longest = run;
      if (span > longestMs) longestMs = span;
    } else run = 0;
  }
  const above = finiteSorted(scored.map((i) => series.above[i]));
  const below = finiteSorted(scored.map((i) => series.below[i]));
  const rows = finiteSorted(scored.map((i) => series.rows[i]));
  let total = 0;
  for (const value of sorted) total += value;
  return {
    samples: inWindow,
    scored: scored.length,
    edgeSamples,
    sampleEveryMs: spacing === null ? null : round(spacing, 2),
    min: round(sorted[0], 4),
    p01: round(quantileSorted(sorted, 0.01), 4),
    p05: round(quantileSorted(sorted, 0.05), 4),
    mean: round(total / sorted.length, 4),
    holes,
    holeFraction: round(holes / scored.length, 4),
    longestHoleSamples: longest,
    longestHoleMs: round(longestMs, 1),
    minAbovePx: above.length ? round(above[0], 1) : null,
    minBelowPx: below.length ? round(below[0], 1) : null,
    rows: {
      min: rows.length ? rows[0] : null,
      p50: rows.length ? quantileSorted(rows, 0.5) : null,
      max: rows.length ? rows[rows.length - 1] : null,
    },
  };
}

/**
 * Distance between where the input says the viewport should be and where it is.
 * `requested` is a piecewise step function: `plannedEpochMs` ascending with the
 * cumulative requested px after each event. `samples` are `{ epochMs, scrollTop }`.
 * Both clocks must be epoch milliseconds (performance.timeOrigin + performance.now()),
 * so the alignment error is the clock-resolution of the two processes, not drift.
 * Returns absolute lag in px per sample.
 */
export function requestedLagPx({ plannedEpochMs, cumulativePx, startScrollTop, samples }) {
  const lag = [];
  let k = -1;
  for (const sample of samples) {
    while (k + 1 < plannedEpochMs.length && plannedEpochMs[k + 1] <= sample.epochMs) k++;
    const requested = k < 0 ? 0 : cumulativePx[k];
    lag.push(Math.abs(startScrollTop + requested - sample.scrollTop));
  }
  return lag;
}

/** Lag summary in px, and in ms at the declared speed when there is one. */
export function summarizeLag(lagPx, speedPxPerSec = null) {
  const sorted = finiteSorted(lagPx);
  if (!sorted.length) return { samples: 0, p50Px: null, p95Px: null, maxPx: null, p50Ms: null, p95Ms: null, maxMs: null };
  const px = (p) => quantileSorted(sorted, p);
  const ms = (value) => (typeof speedPxPerSec === 'number' && speedPxPerSec > 0 ? round((value / speedPxPerSec) * 1000, 1) : null);
  return {
    samples: sorted.length,
    p50Px: round(px(0.5), 1),
    p95Px: round(px(0.95), 1),
    maxPx: round(sorted[sorted.length - 1], 1),
    p50Ms: ms(px(0.5)),
    p95Ms: ms(px(0.95)),
    maxMs: ms(sorted[sorted.length - 1]),
  };
}

/** Sum of absolute differences between consecutive values: the distance actually travelled. */
export function pathLength(values) {
  let total = 0;
  for (let i = 1; i < values.length; i++) total += Math.abs(values[i] - values[i - 1]);
  return total;
}
