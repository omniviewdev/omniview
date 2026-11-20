import { describe, expect, it } from 'vitest';
import { makeNotices } from './testing';
import { TIMING } from './types';

// One snapshot per flush (the lead's brief; ch16 S86, S107, S108, S151: a progress tick writes what the user can see and no more). The store is the shape `useSyncExternalStore` wants: a
// snapshot that is always current, and a listener that is called at most once a frame, however many changes came in it. A change that is a no-op returns the same snapshot and tells nobody; what
// did not change is the same object, so a view that draws it can skip it.

const frame = TIMING.frame;

describe('the snapshot', () => {
  it('starts complete and empty, and is frozen plain data', () => {
    const { store } = makeNotices();
    const state = store.getSnapshot();
    expect(state).toEqual({
      version: 1,
      active: [],
      recent: [],
      counts: { all: 0, active: 0, attention: 0, unread: 0 },
      bell: { dot: '', unread: 0, errors: 0, warnings: 0, attention: 0, active: 0, label: 'Notifications' },
      activity: { count: 0, running: 0, queued: 0, paused: 0, worst: '', text: 'Operations', tooltip: 'Nothing is running', bar: undefined, cancel: undefined },
      toasts: { items: [], paused: false, suspended: false },
      muted: [],
      undo: undefined,
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.recent)).toBe(true);
  });

  it('is JSON, whatever happened: no function and no cycle', () => {
    const { store } = makeNotices();
    store.begin({ title: 'Working', initiator: 'user', progress: { current: 1, total: 2 }, onCancel: () => undefined, actions: [{ id: 'x', label: 'X', run: () => undefined }] });
    store.notify({ title: 'A', actions: [{ id: 'go', route: { plugin: 'cloud', contribution: 'instances' } }] });
    store.mute('cloud');
    const text = JSON.stringify(store.getSnapshot());
    expect(typeof text).toBe('string');
    expect(text).not.toContain('function');
  });

  it('is the same object when nothing changed, and is current the moment a change is made, before anybody is told', () => {
    const { store } = makeNotices();
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);
    store.notify({ title: 'A' });
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().recent).toHaveLength(1);
  });

  it('keeps every part of it that did not change as the same object: a view skips what it already drew', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Working', initiator: 'user', progress: { current: 0, total: 100 } });
    store.notify({ title: 'A' });
    store.notify({ title: 'B' });
    const before = store.getSnapshot();
    op.progress({ current: 40 });
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.recent).toBe(before.recent);
    expect(after.recent[0]).toBe(before.recent[0]);
    expect(after.bell).toBe(before.bell);
    expect(after.counts).toBe(before.counts);
    expect(after.muted).toBe(before.muted);
    expect(after.active[0]).not.toBe(before.active[0]);
    expect(after.toasts.items[0]?.record).toBe(after.active[0]);
    expect(store.selectors.record('n2')).toBe(before.recent[1]);
  });

  it('keeps the toasts of records that did not change as the same objects', () => {
    const { store } = makeNotices();
    store.notify({ title: 'A' });
    store.notify({ title: 'B' });
    const before = store.getSnapshot().toasts.items;
    store.begin({ title: 'C' });
    expect(store.getSnapshot().toasts.items).toBe(before);
  });

  it('offers one selector for each part, and each answers the same object while its part is the same', () => {
    const { store } = makeNotices();
    store.notify({ title: 'A' });
    const { selectors } = store;
    const state = store.getSnapshot();
    expect([selectors.toasts(), selectors.bell(), selectors.activity(), selectors.counts(), selectors.active(), selectors.recent()]).toEqual([state.toasts, state.bell, state.activity, state.counts, state.active, state.recent]);
    expect(selectors.record('n1')).toBe(state.recent[0]);
    expect(selectors.record('gone')).toBeUndefined();
    store.mute('cloud');
    expect(store.selectors.recent()).toBe(state.recent);
  });
});

describe('who is told, and when (one snapshot per frame)', () => {
  it('tells the first change at once, and the rest at the end of the frame, once, however many there were', async () => {
    const { store, clock } = makeNotices();
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });
    for (let index = 0; index < 100; index += 1) {
      store.forSource(`p${String(index % 50)}`).notify({ title: `Notice ${String(index)}` });
    }

    expect(told).toBe(1);
    await clock.advance(frame - 1);
    expect(told).toBe(1);
    await clock.advance(1);
    expect(told).toBe(2);
    await clock.advance(10 * frame);
    expect(told).toBe(2);
    expect(store.getSnapshot().recent).toHaveLength(100);
  });

  it('builds one snapshot for what a frame brought, not one for each change', async () => {
    const { store, clock } = makeNotices();
    store.subscribe(() => undefined);
    const op = store.begin({ title: 'Uploading', initiator: 'user', progress: { current: 0, total: 1000 } });
    await clock.advance(frame);
    const before = store.stats().snapshots;
    for (let tick = 1; tick <= 1000; tick += 1) {
      op.progress({ current: tick });
    }

    await clock.advance(frame);
    // The first tick of a frame is told at once; the rest are one trailing flush.
    expect(store.stats().snapshots - before).toBeLessThanOrEqual(2);
    expect(store.getSnapshot().active[0]?.progress?.fraction).toBe(1);
  });

  it('tells nobody of a change that changed nothing', async () => {
    const { store, clock } = makeNotices();
    let told = 0;
    store.notify({ title: 'A' });
    await clock.advance(frame);
    store.subscribe(() => {
      told += 1;
    });
    store.readAll();
    expect(told).toBe(1);
    await clock.advance(frame);
    store.readAll();
    store.dismissToasts();
    store.hold('pointer', false);
    store.unmuteAll();
    store.refresh();
    await clock.advance(frame);
    expect(told).toBe(1);
  });

  it('is told once more only when the frame had something to say: nothing pending, nothing said', async () => {
    const { store, clock } = makeNotices();
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });
    store.notify({ title: 'A' });
    await clock.advance(5 * frame);
    expect(told).toBe(1);
    expect(clock.pending()).toBeLessThanOrEqual(1);
  });

  it('flushes what is pending when asked', () => {
    const { store } = makeNotices();
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });
    store.notify({ title: 'A' });
    store.notify({ title: 'B' });
    expect(told).toBe(1);
    store.flush();
    expect(told).toBe(2);
    store.flush();
    expect(told).toBe(2);
  });

  it('lets a listener unsubscribe, and one that was removed is not called for the change that removed it', () => {
    const { store } = makeNotices();
    const calls: string[] = [];
    let stopB = (): void => undefined;
    store.subscribe(() => {
      calls.push('a');
      stopB();
    });
    stopB = store.subscribe(() => {
      calls.push('b');
    });
    store.notify({ title: 'A' });
    expect(calls).toEqual(['a']);
  });

  it('lets a listener change the store: that is told in the next frame, never recursively', async () => {
    const { store, clock } = makeNotices();
    let told = 0;
    store.subscribe(() => {
      told += 1;
      if (told === 1) {
        store.notify({ title: 'Second' });
      }
    });
    store.notify({ title: 'First' });
    expect(told).toBe(1);
    await clock.advance(frame);
    expect(told).toBe(2);
    expect(store.getSnapshot().recent.map((record) => record.name)).toEqual(['Second', 'First']);
  });

  it('keeps a listener that throws from breaking the others or the model', () => {
    const { store, errors } = makeNotices();
    const calls: string[] = [];
    store.subscribe(() => {
      throw new Error('broken view');
    });
    store.subscribe(() => {
      calls.push('ok');
    });
    store.notify({ title: 'A' });
    expect(calls).toEqual(['ok']);
    expect(errors.some((entry) => entry.where.includes('listener'))).toBe(true);
  });

  it('tells a selector\'s listener only when what it selected changed, with the value before', async () => {
    const { store, clock } = makeNotices();
    const seen: Array<[string, string]> = [];
    store.subscribeTo((state) => state.bell.dot, (value, previous) => {
      seen.push([previous, value]);
    });
    store.notify({ title: 'A' });
    await clock.advance(frame);
    store.notify({ title: 'B' });
    await clock.advance(frame);
    store.notify({ title: 'C', severity: 'error' });
    await clock.advance(frame);
    store.readAll();
    expect(seen).toEqual([['', 'info'], ['info', 'error'], ['error', '']]);
  });

  it('can be given its own equality', async () => {
    const { store, clock } = makeNotices();
    let told = 0;
    store.subscribeTo((state) => state.recent.map((record) => record.id), () => {
      told += 1;
    }, (a, b) => a.join() === b.join());
    store.notify({ title: 'A' });
    await clock.advance(frame);
    store.readAll();
    expect(told).toBe(1);
  });

  it('stops everything when it is disposed: no timer, no listener', async () => {
    const { store, clock } = makeNotices();
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });
    store.notify({ title: 'A' });
    store.begin({ title: 'B', initiator: 'user', progress: { current: 0, total: 10 } });
    store.mute('cloud');
    store.remove('n1');
    store.dispose();
    expect(clock.pending()).toBe(0);
    await clock.advance(10 * 60_000);
    expect(told).toBe(1);
  });
});

describe('what a screen reader is told of a bar changes at most once a second (S86)', () => {
  it('takes the value of a tick into the bar at once and into the words once a second', async () => {
    const { store, clock } = makeNotices();
    const op = store.begin({ title: 'Uploading', progress: { current: 0, total: 100 } });
    const words: string[] = [];
    const note = (): void => {
      const text = store.getSnapshot().active[0]?.progress?.a11y.text ?? '';
      if (words.at(-1) !== text) {
        words.push(text);
      }
    };

    note();
    for (let tick = 1; tick <= 900; tick += 1) {
      op.progress({ current: Math.ceil(tick / 9) });
      await clock.advance(1);
      note();
    }

    expect(store.getSnapshot().active[0]?.progress?.fraction).toBe(1);
    expect(words.length).toBeLessThanOrEqual(3);
    await clock.advance(TIMING.a11y);
    note();
    expect(words.at(-1)).toBe('100 of 100');
    expect(store.getSnapshot().active[0]?.progress?.a11y).toMatchObject({ now: 100, current: 100, total: 100 });
  });

  it('says a state at once: paused and queued are read when they happen, not up to a second later', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Uploading', progress: { current: 40, total: 100, unit: '%' } });
    expect(store.getSnapshot().active[0]?.progress?.a11y.text).toBe('40%');
    op.pause();
    expect(store.getSnapshot().active[0]?.progress?.a11y.text).toBe('40%, paused');
    op.resume();
    expect(store.getSnapshot().active[0]?.progress?.a11y.text).toBe('40%');
  });

  it('keeps a bar that cannot be measured as "Working…", with no value', () => {
    const { store } = makeNotices();
    store.begin({ title: 'Refreshing', progress: 'indeterminate' });
    expect(store.getSnapshot().active[0]?.progress).toMatchObject({ kind: 'indeterminate', fraction: null, a11y: { now: null, text: 'Working…' } });
  });

  it('makes the words of the status area the same sample as the bar\'s, so two surfaces of one sync never disagree (QA-SF-27)', async () => {
    const { store, clock } = makeNotices();
    const op = store.begin({ title: 'Syncing connections', progress: { current: 0, total: 12, unit: 'connections' } });
    op.progress({ current: 2 });
    const first = store.getSnapshot();
    expect(first.activity.bar?.text).toBe(first.active[0]?.progress?.a11y.text);
    await clock.advance(TIMING.a11y + 250);
    const next = store.getSnapshot();
    expect(next.activity.bar?.text).toBe('2 of 12 connections');
    expect(next.activity.bar?.text).toBe(next.active[0]?.progress?.a11y.text);
  });
});
