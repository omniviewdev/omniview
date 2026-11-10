/**
 * Paced wheel input, driven from Node over CDP, independent of the renderer.
 *
 * The page never schedules its own input: a rAF- or timer-driven scrollTop loop inside the
 * page slows down exactly when JavaScript stalls, hiding the lag it is meant to expose. This
 * driver sends `Input.dispatchMouseEvent` wheel events on an absolute schedule from another
 * process (the declared cadence, e.g. 60 events/s, whatever the renderer is doing), never
 * awaits an event before sending the next, and records for every event when it was due, when
 * it was actually sent and when the browser acknowledged it. A stalled renderer therefore
 * shows up as lag between requested and delivered scroll, not as slower input.
 *
 * It does no layout, no flushSync and reads nothing from the page.
 */
import { performance } from 'node:perf_hooks';

import { summarizeSeries } from './stats.mjs';

/**
 * The event schedule of piecewise-constant scrolling.
 *
 * Positions follow the declared velocity exactly; each event carries the integer pixel delta
 * that brings the cumulative sum closest to the position at its due time, so rounding never
 * accumulates and `requestedPx` equals the integral of the velocity to within one pixel.
 *
 * @param {{ hz: number, segments: Array<{ durationMs: number, pxPerSec: number }>, scale?: number }} plan
 */
export function wheelSchedule({ hz, segments, scale = 1 }) {
  if (!(hz > 0)) throw new Error('wheel cadence must be positive');
  const intervalMs = 1000 / hz;
  const totalMs = segments.reduce((total, segment) => total + segment.durationMs, 0);
  const count = Math.floor(totalMs / intervalMs + 1e-9);
  const plannedMs = new Float64Array(count);
  const deltaY = new Float64Array(count);
  const cumulativePx = new Float64Array(count);
  let sent = 0;
  let minCumulative = 0;
  let maxCumulative = 0;
  // Integral of the velocity from 0 to t.
  const position = (t) => {
    let area = 0;
    let at = 0;
    for (const segment of segments) {
      const span = Math.min(segment.durationMs, Math.max(0, t - at));
      area += (segment.pxPerSec * span) / 1000;
      at += segment.durationMs;
      if (t <= at) break;
    }
    return area * scale;
  };
  for (let i = 0; i < count; i++) {
    const due = (i + 1) * intervalMs;
    const target = Math.round(position(due));
    plannedMs[i] = due;
    deltaY[i] = target - sent;
    sent = target;
    cumulativePx[i] = sent;
    minCumulative = Math.min(minCumulative, sent);
    maxCumulative = Math.max(maxCumulative, sent);
  }
  return { hz, intervalMs, durationMs: totalMs, events: count, plannedMs, deltaY, cumulativePx, requestedPx: sent, minCumulative, maxCumulative, scale };
}

/**
 * Send the schedule. `send(deltaY)` returns a promise that settles when the browser acknowledges
 * the event. Time is `now()` in milliseconds on a monotonic clock; `sleep(ms)` waits roughly that
 * long, and the last couple of milliseconds are spent yielding to the event loop so that
 * acknowledgements keep being processed while the next event waits for its instant.
 *
 * At most `inflightLimit` events are unacknowledged at a time (a frozen browser must not queue
 * unbounded work); waiting on that limit is counted, not hidden.
 */
export async function driveWheel({ schedule, send, now = () => performance.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), yieldTurn = () => new Promise((resolve) => setImmediate(resolve)), inflightLimit = 64 }) {
  const n = schedule.events;
  const sentMs = new Float64Array(n);
  const ackedMs = new Float64Array(n).fill(Number.NaN);
  const pending = new Set();
  let failures = 0;
  let firstFailure = null;
  let backpressureWaits = 0;
  const t0 = now();
  for (let i = 0; i < n; i++) {
    const due = t0 + schedule.plannedMs[i];
    for (let remaining = due - now(); remaining > 0; remaining = due - now()) {
      if (remaining > 2) await sleep(remaining - 1.5);
      else await yieldTurn();
    }
    sentMs[i] = now() - t0;
    const index = i;
    const promise = send(schedule.deltaY[i]).then(
      () => { ackedMs[index] = now() - t0; },
      (error) => { failures++; firstFailure ??= String(error?.message ?? error); },
    ).finally(() => pending.delete(promise));
    pending.add(promise);
    if (pending.size >= inflightLimit) {
      backpressureWaits++;
      await Promise.race(pending);
    }
  }
  const lastSentAt = n ? sentMs[n - 1] : 0;
  await Promise.allSettled([...pending]);
  const endedAt = now();
  return { t0, endedAt, events: n, sentMs, ackedMs, failures, firstFailure, backpressureWaits, lastSentMs: lastSentAt };
}

/** Per-event accounting of a finished drive, in milliseconds and pixels. */
export function summarizeDrive(schedule, drive) {
  const late = [];
  const ack = [];
  let acked = 0;
  for (let i = 0; i < drive.events; i++) {
    late.push(drive.sentMs[i] - schedule.plannedMs[i]);
    if (Number.isFinite(drive.ackedMs[i])) { ack.push(drive.ackedMs[i] - drive.sentMs[i]); acked++; }
  }
  const spanMs = drive.events > 1 ? drive.sentMs[drive.events - 1] - drive.sentMs[0] : 0;
  return {
    declaredHz: schedule.hz,
    events: drive.events,
    acknowledged: acked,
    failures: drive.failures,
    firstFailure: drive.firstFailure,
    backpressureWaits: drive.backpressureWaits,
    requestedPx: schedule.requestedPx,
    durationMs: schedule.durationMs,
    actualHz: drive.events > 1 && spanMs > 0 ? Math.round(((drive.events - 1) * 1000 * 100) / spanMs) / 100 : null,
    latenessMs: summarizeSeries(late, 3),
    ackLatencyMs: summarizeSeries(ack, 3),
  };
}
