import assert from 'node:assert/strict';
import test from 'node:test';

import { driveWheel, summarizeDrive, wheelSchedule } from './wheel-driver.mjs';

test('constant velocity becomes equal integer deltas that sum exactly to the declared distance', () => {
  const schedule = wheelSchedule({ hz: 60, segments: [{ durationMs: 20_000, pxPerSec: 1200 }] });
  assert.equal(schedule.events, 1200);
  assert.equal(schedule.requestedPx, 24_000);
  assert.ok(Array.from(schedule.deltaY).every((delta) => delta === 20));
  assert.equal(schedule.cumulativePx[schedule.events - 1], 24_000);
});

test('rounding never accumulates when the per-event distance is fractional', () => {
  // 1000 px/s at 70 events/s is 14.2857 px per event.
  const schedule = wheelSchedule({ hz: 70, segments: [{ durationMs: 10_000, pxPerSec: 1000 }] });
  assert.ok(Array.from(schedule.deltaY).every((delta) => Number.isInteger(delta)));
  assert.ok(Math.abs(schedule.requestedPx - 10_000) <= 1);
  for (let i = 0; i < schedule.events; i++) {
    const exact = (1000 * schedule.plannedMs[i]) / 1000;
    assert.ok(Math.abs(schedule.cumulativePx[i] - exact) <= 0.5 + 1e-9);
  }
});

test('a reversal returns to its start and records the travelled extremes', () => {
  const schedule = wheelSchedule({
    hz: 60,
    segments: [{ durationMs: 1000, pxPerSec: 600 }, { durationMs: 1000, pxPerSec: -600 }],
  });
  assert.equal(schedule.events, 120);
  assert.equal(Math.abs(schedule.requestedPx), 0);
  assert.equal(schedule.maxCumulative, 600);
  assert.equal(Math.abs(schedule.minCumulative), 0);
});

test('a calibration scale stretches every delta, not the cadence', () => {
  const plain = wheelSchedule({ hz: 60, segments: [{ durationMs: 1000, pxPerSec: 600 }] });
  const scaled = wheelSchedule({ hz: 60, segments: [{ durationMs: 1000, pxPerSec: 600 }], scale: 2 });
  assert.equal(scaled.events, plain.events);
  assert.equal(scaled.requestedPx, 2 * plain.requestedPx);
});

function fakeClock() {
  const clock = { now: 0 };
  return {
    clock,
    now: () => clock.now,
    sleep: async (ms) => { clock.now += ms; },
    yieldTurn: async () => { clock.now += 0.5; },
  };
}

test('events leave on the absolute schedule and the loop never waits for an acknowledgement', async () => {
  const { clock, now, sleep, yieldTurn } = fakeClock();
  const schedule = wheelSchedule({ hz: 100, segments: [{ durationMs: 100, pxPerSec: 1000 }] });
  const sentWhileAckPending = [];
  let outstanding = 0;
  const drive = await driveWheel({
    schedule,
    now,
    sleep,
    yieldTurn,
    // The browser takes far longer than one cadence interval to acknowledge.
    send: () => {
      outstanding++;
      sentWhileAckPending.push(outstanding);
      return new Promise((resolve) => setTimeout(() => { outstanding--; resolve(); }, 5));
    },
  });
  assert.equal(drive.events, 10);
  assert.ok(Math.max(...sentWhileAckPending) > 1, 'a later event was sent while an earlier one was unacknowledged');
  for (let i = 0; i < drive.events; i++) {
    assert.ok(drive.sentMs[i] >= schedule.plannedMs[i] - 1e-9, 'never early');
    assert.ok(drive.sentMs[i] - schedule.plannedMs[i] <= 0.5 + 1e-9, 'within one yield of its instant');
  }
  const summary = summarizeDrive(schedule, drive);
  assert.equal(summary.acknowledged, 10);
  assert.equal(summary.failures, 0);
  assert.equal(summary.requestedPx, 100);
  assert.ok(clock.now >= 100);
});

test('failed events are counted and reported, not swallowed', async () => {
  const { now, sleep, yieldTurn } = fakeClock();
  const schedule = wheelSchedule({ hz: 100, segments: [{ durationMs: 50, pxPerSec: 1000 }] });
  let n = 0;
  const drive = await driveWheel({
    schedule, now, sleep, yieldTurn,
    send: async () => { if (++n === 3) throw new Error('target closed'); },
  });
  const summary = summarizeDrive(schedule, drive);
  assert.equal(summary.failures, 1);
  assert.equal(summary.firstFailure, 'target closed');
  assert.equal(summary.acknowledged, schedule.events - 1);
});

test('a frozen browser holds at most the in-flight limit and the wait is counted', async () => {
  const { now, sleep, yieldTurn } = fakeClock();
  const schedule = wheelSchedule({ hz: 100, segments: [{ durationMs: 100, pxPerSec: 1000 }] });
  let inflight = 0;
  let peak = 0;
  const drive = await driveWheel({
    schedule, now, sleep, yieldTurn, inflightLimit: 2,
    send: () => {
      peak = Math.max(peak, ++inflight);
      return new Promise((resolve) => setTimeout(() => { inflight--; resolve(); }, 3));
    },
  });
  assert.ok(peak <= 2);
  assert.ok(drive.backpressureWaits > 0);
  assert.equal(summarizeDrive(schedule, drive).acknowledged, 10);
});
