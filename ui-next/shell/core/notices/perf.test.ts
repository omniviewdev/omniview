import { describe, expect, it } from 'vitest';
import { makeNotices } from './testing';
import { LIMITS, TIMING } from './types';

// Performance: the cost of a frame is bounded by what changed in it, not by what exists. Ten thousand notices in one tick, and a thousand concurrent operations each ticking once a second (or one
// ticking a thousand times a second), cost one snapshot per flush (TIMING.frame, 16 ms), one view per record that changed, and no timer for what nobody sees. The time bounds are generous (a
// laptop measures a tenth of them): a shared runner is several times slower, and the fastest of three runs is compared with the bound, as the tab model's `perf.test.ts` does. The counts are
// not timing: they are exact, and they are the proof.

const BOUND = 250;
const frame = TIMING.frame;

const fastest = (run: () => void, tries = 3): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }

  return best;
};

describe('ten thousand notices in one tick', () => {
  it('from one plugin: five records and a row, one leading snapshot and one trailing, a handful of views', async () => {
    const { store, clock } = makeNotices();
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });
    const producer = store.forSource('cloud');
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      producer.notify({ title: `Notice ${String(index)}`, severity: index % 3 === 0 ? 'error' : 'info' });
    }

    const took = performance.now() - started;
    await clock.advance(frame);
    expect(took).toBeLessThan(BOUND);
    expect(told).toBeLessThanOrEqual(2);
    const stats = store.stats();
    // The first snapshot is the one `subscribe` reads, then the leading one and the trailing one.
    expect(stats.snapshots).toBeLessThanOrEqual(3);
    expect(stats.views).toBeLessThanOrEqual(LIMITS.perSecond + 5);
    expect(stats.limited).toBe(10_000 - LIMITS.perSecond);
    expect(store.getSnapshot().recent).toHaveLength(LIMITS.perSecond + 1);
    expect(store.getSnapshot().toasts.items.length).toBeLessThanOrEqual(LIMITS.toasts);
  });

  it('from a hundred plugins: the history stays at its bound, and so does the number of timers it holds', async () => {
    const { store, clock } = makeNotices();
    const producers = Array.from({ length: 100 }, (_, index) => store.forSource(`p${String(index)}`));
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      producers[index % 100]?.notify({ title: `Notice ${String(index)}` });
    }

    const took = performance.now() - started;
    expect(took).toBeLessThan(BOUND * 2);
    const state = store.getSnapshot();
    expect(state.recent).toHaveLength(LIMITS.history);
    expect(state.toasts.items.length).toBeLessThanOrEqual(LIMITS.toasts);
    // A toast of a record that left the history is gone with it: its timer is not kept.
    expect(clock.pending()).toBeLessThanOrEqual(LIMITS.history + 5);
    await clock.advance(TIMING.toast + frame);
    expect(clock.pending()).toBeLessThanOrEqual(3);
  });

  it('of one key: one notice with a count, each repeat costing a count', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    const took = fastest(() => {
      for (let index = 0; index < 10_000; index += 1) {
        producer.notify({ title: 'Lost the connection', key: 'conn' });
      }
    });
    expect(took).toBeLessThan(BOUND);
    expect(store.getSnapshot().recent).toHaveLength(1);
    expect(store.getSnapshot().recent[0]?.count).toBe(30_000);
  });
});

describe('a thousand progress updates in a second', () => {
  it('on one operation, in one frame: one view, one snapshot to tell, however many ticks', async () => {
    const { store, clock } = makeNotices();
    store.subscribe(() => undefined);
    const op = store.begin({ title: 'Uploading', initiator: 'user', progress: { current: 0, total: 1000, unit: 'chunks' } });
    await clock.advance(frame);
    const before = store.stats();
    const took = fastest(() => {
      for (let tick = 1; tick <= 1000; tick += 1) {
        op.progress({ current: tick });
      }
    });
    await clock.advance(frame);
    const after = store.stats();
    expect(took).toBeLessThan(BOUND);
    expect(after.snapshots - before.snapshots).toBeLessThanOrEqual(2 * 3);
    expect(after.views - before.views).toBeLessThanOrEqual(2 * 3);
    expect(store.getSnapshot().active[0]?.progress?.fraction).toBe(1);
  });

  it('on one operation, a tick each millisecond for three seconds: the listeners are told once a frame, not once a tick', async () => {
    const { store, clock } = makeNotices();
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });
    const op = store.begin({ title: 'Uploading', initiator: 'user', progress: { current: 0, total: 3000 } });
    for (let tick = 1; tick <= 3000; tick += 1) {
      op.progress({ current: tick });
      await clock.advance(1);
    }

    expect(told).toBeLessThanOrEqual(Math.ceil(3000 / frame) + 5);
    expect(store.getSnapshot().active[0]?.progress?.fraction).toBe(1);
  });

  it('on a thousand operations at once, each ticking once a second for five seconds: a frame costs what changed in it', async () => {
    const { store, clock } = makeNotices();
    const handles = Array.from({ length: 1000 }, (_, index) => store.forSource(`p${String(index % 10)}`).begin({ title: `Task ${String(index)}`, progress: { current: 0, total: 5000, unit: 'items' } }));
    expect(store.getSnapshot().active).toHaveLength(1000);
    store.subscribe(() => undefined);
    await clock.advance(frame);
    const frames = Math.ceil(5000 / frame);
    const batch = Math.ceil(1000 / (1000 / frame));
    const startViews = store.stats().views;
    let busy = 0;
    let updates = 0;
    const started = performance.now();
    for (let at = 0; at < frames; at += 1) {
      const before = store.stats().views;
      for (let index = 0; index < batch; index += 1) {
        handles[(updates + index) % 1000]?.progress({ current: Math.floor(updates / 1000) + 1 });
      }

      updates += batch;
      await clock.advance(frame);
      store.getSnapshot();
      // A frame costs one view for each record that changed in it. Once a second what a screen reader is told is published too, for the bars that moved: that frame costs more.
      if (store.stats().views - before > batch + 1) {
        busy += 1;
      }
    }

    const took = performance.now() - started;
    const stats = store.stats();
    expect(busy).toBeLessThanOrEqual(40);
    // Each tick costs one view, and at most one more for what a screen reader is told of it, once a second.
    expect(stats.views - startViews).toBeLessThanOrEqual((2 * updates) + 1000);
    expect(stats.snapshots).toBeLessThanOrEqual(frames + 5);
    expect(took).toBeLessThan(BOUND * 20);
    // The records nobody touched in a frame are the same objects in the next: sharing is what bounds the work.
    const first = store.getSnapshot().active;
    handles[0]?.progress({ current: 4999 });
    const second = store.getSnapshot().active;
    expect(second.filter((record, index) => record === first[index])).toHaveLength(999);
    expect(clock.pending()).toBeLessThanOrEqual(4);
  });

  it('makes one view for one change among a thousand records, not a thousand', () => {
    const { store } = makeNotices();
    const handles = Array.from({ length: 1000 }, (_, index) => store.forSource(`p${String(index % 10)}`).begin({ title: `Task ${String(index)}`, progress: { current: 0, total: 10 } }));
    store.getSnapshot();
    const before = store.stats().views;
    handles[500]?.progress({ current: 5 });
    store.getSnapshot();
    expect(store.stats().views - before).toBe(1);
  });

  it('keeps what a screen reader is told to a few wake-ups a second: one timer, whatever the number of bars', async () => {
    const { store, clock } = makeNotices();
    const handles = Array.from({ length: 1000 }, (_, index) => store.forSource(`p${String(index % 10)}`).begin({ title: `Task ${String(index)}`, progress: { current: 0, total: 100 } }));
    for (const handle of handles) {
      handle.progress({ current: 50 });
      await clock.advance(1);
    }

    expect(clock.pending()).toBeLessThanOrEqual(3);
    await clock.advance(2 * TIMING.a11y);
    expect(store.getSnapshot().active.every((record) => record.progress?.a11y.text === '50 of 100')).toBe(true);
  });
});

describe('a flood does not grow what the model keeps', () => {
  it('a hundred thousand notices from forty plugins leave the history, the toasts and the timers where they were', async () => {
    const { store, clock } = makeNotices();
    const producers = Array.from({ length: 40 }, (_, index) => store.forSource(`p${String(index)}`));
    for (let round = 0; round < 25; round += 1) {
      for (let index = 0; index < 4000; index += 1) {
        producers[index % 40]?.notify({ title: `Notice ${String(index)}` });
      }

      await clock.advance(61_000);
    }

    const state = store.getSnapshot();
    expect(state.recent.length).toBeLessThanOrEqual(LIMITS.history);
    expect(state.toasts.items.length).toBeLessThanOrEqual(LIMITS.toasts);
    expect(clock.pending()).toBeLessThanOrEqual(LIMITS.history + 5);
    expect(store.serialise().records.length).toBeLessThanOrEqual(LIMITS.history);
  }, 60_000);
});
