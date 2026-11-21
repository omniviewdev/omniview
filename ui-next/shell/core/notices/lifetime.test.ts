import { describe, expect, it } from 'vitest';
import { makeNotices } from './testing';
import { LIMITS, TIMING } from './types';

// How long a toast lives, and what holds it (ch16 S77, S78, S79, S89a, OF4; the mock's `toastPolicy`, `retime`, `setPaused` and `toastEntries`, shell-notify.js:993-1165): a toast that ended
// calmly closes by itself eight seconds after it appears (S78; the mock's code says seven: the lead ruled for the written rule on 2026-11-20); a failure, an unknown outcome, an error and a
// warning that waits on a decision stay until the user acts (S77: "a failure must not vanish"); the clocks wait while the pointer or the focus is in the stack, as one; a modal or the centre
// suspends the stack; when the clocks resume a toast has at least two seconds to be read. A toast that closes is still unread in the bell.

const route = { plugin: 'cloud', contribution: 'instances', params: { id: 'i-1' } };
const fix = { id: 'fix', label: 'Fix it', run: () => undefined };

const ids = (items: ReadonlyArray<{ readonly id: string }>): string[] => items.map((item) => item.id);

describe('how long a toast lives', () => {
  it('closes a calm one eight seconds after it appears (S78, not the mock\'s seven), and the record stays, unread', async () => {
    const { store, clock } = makeNotices();
    expect(TIMING.toast).toBe(8000);
    store.notify({ title: 'Snapshot created', severity: 'success' });
    await clock.advance(7999);
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
    await clock.advance(2);
    const state = store.getSnapshot();
    expect(state.toasts.items).toEqual([]);
    expect(state.recent[0]).toMatchObject({ unread: true, toasted: true });
    expect(state.bell.unread).toBe(1);
  });

  it('keeps one that waits on a decision until the user acts: an error or a warning with a command of the producer', async () => {
    const { store, clock } = makeNotices();
    store.notify({ title: 'Disk is full', severity: 'error', actions: [fix] });
    store.notify({ title: 'Disk is filling', severity: 'warning', actions: [{ ...fix, id: 'fix2' }] });
    await clock.advance(10 * 60_000);
    expect(store.getSnapshot().toasts.items.map((item) => item.sticky)).toEqual([true, true]);
  });

  it('keeps a failure that has nothing to decide until the user acts, S77 and S78 (the lead ruled for the written rule: the mock\'s code timed it out); a warning with nothing to decide still closes', async () => {
    const { store, clock } = makeNotices();
    store.notify({ title: 'Lost the connection', severity: 'error', actions: [{ id: 'go', label: 'Open connections', route }] });
    store.notify({ title: 'Disk is filling', severity: 'warning' });
    expect(store.getSnapshot().toasts.items.map((item) => item.sticky)).toEqual([true, false]);
    await clock.advance(10 * 60_000);
    const state = store.getSnapshot();
    expect(state.toasts.items.map((item) => item.record?.name)).toEqual(['Lost the connection']);
    expect(state.bell).toMatchObject({ dot: 'error', unread: 2 });
  });

  it('keeps a warning that carries ANY action until the user acts, an Open too (S77: "a warning with an action", the lead ruled for the written rule), and closes one whose action cannot be used', async () => {
    const { store, clock, off } = makeNotices();
    store.notify({ title: 'Disk is filling', severity: 'warning', actions: [{ id: 'go', label: 'Open instance', route }] });
    off.add('stack');
    store.notify({ title: 'Cache is filling', severity: 'warning', actions: [{ id: 'go', label: 'Open cache', route: { ...route, plugin: 'stack' } }] });
    expect(store.getSnapshot().toasts.items.map((item) => item.sticky)).toEqual([true, false]);
    await clock.advance(10 * 60_000);
    expect(store.getSnapshot().toasts.items.map((item) => item.record?.name)).toEqual(['Disk is filling']);
  });

  it('keeps the toast of a failure whose Retry is not enabled: a disabled Retry is not a decision, and a failure sticks without one', async () => {
    const { store, clock } = makeNotices();
    store.begin({ title: 'Reconnecting', initiator: 'user', actions: [{ kind: 'retry' }] }).fail('Nothing answered.');
    expect(store.getSnapshot().toasts.items.map((item) => item.sticky)).toEqual([true]);
    await clock.advance(10 * 60_000);
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
  });

  it('keeps the toast of work the user started until it ends, then closes it seven seconds after (S78: updated in place)', async () => {
    const { store, clock } = makeNotices();
    const op = store.begin({ title: 'Scaling orders-api', doneTitle: 'Scaled orders-api', initiator: 'user', progress: { current: 0, total: 10 } });
    await clock.advance(5 * 60_000);
    expect(store.getSnapshot().toasts.items.map((item) => [item.id, item.sticky])).toEqual([['n1', true]]);
    op.succeed();
    expect(store.getSnapshot().toasts.items.map((item) => [item.id, item.sticky])).toEqual([['n1', false]]);
    await clock.advance(TIMING.toast + 1);
    expect(store.getSnapshot().toasts.items).toEqual([]);
  });

  it('keeps the toast of a failure that has a Retry, and updates it in place when the work starts over', async () => {
    const { store, clock } = makeNotices();
    const op = store.begin({ title: 'Reconnecting data source', initiator: 'user', onRetry: () => undefined });
    op.fail('Nothing answered.');
    await clock.advance(5 * 60_000);
    expect(store.getSnapshot().toasts.items.map((item) => item.sticky)).toEqual([true]);
    const key = store.getSnapshot().toasts.items[0]?.key;
    op.restart();
    expect(store.getSnapshot().toasts.items[0]?.key).toBe(key);
  });

  it('puts a toast back for a failure the user dismissed when it fails again (S78: a failure must not vanish)', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Reconnecting data source', initiator: 'user', onRetry: () => undefined });
    op.fail('Nothing answered.');
    op.dismiss();
    expect(store.getSnapshot().toasts.items).toEqual([]);
    op.restart();
    op.fail('Nothing answered.');
    expect(ids(store.getSnapshot().toasts.items)).toEqual([op.id]);
  });

  it('says an error of work the user started interrupts (role="alert"), and nothing else does (S86)', () => {
    const { store } = makeNotices();
    store.begin({ title: 'Scaling', initiator: 'user' }).fail('No.');
    store.notify({ title: 'Info' });
    store.notify({ title: 'System error', severity: 'error' });
    expect(store.getSnapshot().toasts.items.map((item) => item.urgent)).toEqual([true, false, false]);
  });
});

describe('the pointer or the focus in the stack (S78)', () => {
  it('stops the clocks of every toast as one, and gives back what was left', async () => {
    const { store, clock } = makeNotices();
    store.notify({ title: 'A' });
    await clock.advance(3000);
    store.notify({ title: 'B' });
    expect(store.hold('pointer', true)).toBe(true);
    expect(store.getSnapshot().toasts).toMatchObject({ paused: true, suspended: false });
    await clock.advance(60_000);
    expect(ids(store.getSnapshot().toasts.items)).toEqual(['n1', 'n2']);
    expect(store.hold('pointer', false)).toBe(true);
    expect(store.getSnapshot().toasts.paused).toBe(false);
    await clock.advance(TIMING.toast - 3000 - 1);
    expect(ids(store.getSnapshot().toasts.items)).toEqual(['n1', 'n2']);
    await clock.advance(2);
    expect(ids(store.getSnapshot().toasts.items)).toEqual(['n2']);
    await clock.advance(3000);
    expect(store.getSnapshot().toasts.items).toEqual([]);
  });

  it('gives a toast that had less than two seconds left two seconds when the clocks resume (S89a)', async () => {
    const { store, clock } = makeNotices();
    store.notify({ title: 'A' });
    await clock.advance(TIMING.toast - 500);
    store.hold('focus', true);
    await clock.advance(30_000);
    store.hold('focus', false);
    await clock.advance(TIMING.grace - 1);
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
    await clock.advance(2);
    expect(store.getSnapshot().toasts.items).toEqual([]);
  });

  it('waits for both: the clocks run again when the pointer and the focus are both gone', async () => {
    const { store, clock } = makeNotices();
    store.notify({ title: 'A' });
    store.hold('pointer', true);
    store.hold('focus', true);
    store.hold('pointer', false);
    await clock.advance(60_000);
    expect(store.getSnapshot().toasts).toMatchObject({ paused: true });
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
    store.hold('focus', false);
    await clock.advance(TIMING.toast + 1);
    expect(store.getSnapshot().toasts.items).toEqual([]);
  });

  it('is told once: a hold that is already held changes nothing', () => {
    const { store } = makeNotices();
    expect(store.hold('pointer', true)).toBe(true);
    const before = store.getSnapshot();
    expect(store.hold('pointer', true)).toBe(false);
    expect(store.getSnapshot()).toBe(before);
    expect(store.hold('focus', false)).toBe(false);
  });

  it('holds a toast that appears while it is held, until it is released', async () => {
    const { store, clock } = makeNotices();
    store.hold('pointer', true);
    store.notify({ title: 'A' });
    await clock.advance(60_000);
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
    store.hold('pointer', false);
    await clock.advance(TIMING.toast + 1);
    expect(store.getSnapshot().toasts.items).toEqual([]);
  });

  it('never stops what is sticky from being there: it was never counting down', async () => {
    const { store, clock } = makeNotices();
    store.notify({ title: 'A', severity: 'error', actions: [fix] });
    store.hold('pointer', true);
    store.hold('pointer', false);
    await clock.advance(10 * 60_000);
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
  });
});

describe('a modal owns the window, or the centre is open (S89a)', () => {
  it('suspends the stack: nothing is shown, nothing is lost, the clocks wait', async () => {
    const { store, clock } = makeNotices();
    store.notify({ title: 'A', severity: 'error', actions: [fix] });
    store.notify({ title: 'B' });
    expect(store.hold('modal', true)).toBe(true);
    expect(store.getSnapshot().toasts).toEqual({ items: [], paused: true, suspended: true });
    store.notify({ title: 'C' });
    await clock.advance(60_000);
    expect(store.getSnapshot().toasts.items).toEqual([]);
    store.hold('modal', false);
    expect(ids(store.getSnapshot().toasts.items)).toEqual(['n1', 'n2', 'n3']);
    expect(store.getSnapshot().toasts).toMatchObject({ paused: false, suspended: false });
  });

  it('gives the toasts that wait at least two seconds when it closes, and the rest of their lifetime', async () => {
    const { store, clock } = makeNotices();
    store.notify({ title: 'A' });
    await clock.advance(TIMING.toast - 500);
    store.hold('modal', true);
    store.notify({ title: 'B' });
    await clock.advance(120_000);
    store.hold('modal', false);
    await clock.advance(TIMING.grace - 1);
    expect(ids(store.getSnapshot().toasts.items)).toEqual(['n1', 'n2']);
    await clock.advance(2);
    expect(ids(store.getSnapshot().toasts.items)).toEqual(['n2']);
    await clock.advance(TIMING.toast);
    expect(store.getSnapshot().toasts.items).toEqual([]);
  });

  it('is the same for the centre, and stays suspended until every one of them is closed', async () => {
    const { store } = makeNotices();
    store.notify({ title: 'A' });
    store.hold('center', true);
    store.hold('modal', true);
    store.hold('center', false);
    expect(store.getSnapshot().toasts.suspended).toBe(true);
    expect(store.getSnapshot().toasts.items).toEqual([]);
    store.hold('modal', false);
    expect(store.getSnapshot().toasts.suspended).toBe(false);
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
  });

  it('never loses a record to it: the record is in the history while its toast waits, and what the user read while it was shut raises no toast', () => {
    const { store } = makeNotices();
    store.hold('center', true);
    store.notify({ title: 'A' });
    expect(store.getSnapshot().recent).toHaveLength(1);
    store.read('n1');
    store.hold('center', false);
    expect(store.getSnapshot().toasts.items).toEqual([]);
  });
});

describe('the stack (S79)', () => {
  it('shows three at most, the newest at the bottom; with more, the two newest and a summary that says how many are behind it', () => {
    const { store } = makeNotices();
    for (let index = 1; index <= 5; index += 1) {
      store.forSource(`p${String(index)}`).notify({ title: `Notice ${String(index)}` });
    }

    const { items } = store.getSnapshot().toasts;
    expect(items.map((item) => item.id)).toEqual(['__summary', 'n4', 'n5']);
    expect(items[0]?.summary).toMatchObject({ count: 3, ids: ['n1', 'n2', 'n3'], severity: 'info' });
  });

  it('says the worst severity it holds', () => {
    const { store } = makeNotices();
    store.forSource('p1').notify({ title: 'A', severity: 'warning' });
    store.forSource('p2').notify({ title: 'B', severity: 'error' });
    store.forSource('p3').notify({ title: 'C' });
    store.forSource('p4').notify({ title: 'D' });
    expect(store.getSnapshot().toasts.items[0]?.summary?.severity).toBe('error');
  });

  it('opens the centre on its button, and dismisses what it holds without deleting any of it', () => {
    const { store, centre } = makeNotices();
    for (let index = 1; index <= 5; index += 1) {
      store.forSource(`p${String(index)}`).notify({ title: `Notice ${String(index)}` });
    }

    expect(store.showSummary()).toBe(true);
    expect(centre.opened).toBe(1);
    expect(store.dismissSummary()).toBe(3);
    const state = store.getSnapshot();
    expect(ids(state.toasts.items)).toEqual(['n4', 'n5']);
    expect(state.recent).toHaveLength(5);
    expect(state.recent.filter((record) => record.read).map((record) => record.id).sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('has no summary to show or to dismiss when there is none', () => {
    const { store, centre } = makeNotices();
    store.notify({ title: 'A' });
    expect(store.showSummary()).toBe(false);
    expect(store.dismissSummary()).toBe(0);
    expect(centre.opened).toBe(0);
  });

  it('dismisses every toast at once, marks them read and deletes nothing', () => {
    const { store } = makeNotices();
    for (let index = 1; index <= 4; index += 1) {
      store.forSource(`p${String(index)}`).notify({ title: `Notice ${String(index)}` });
    }

    expect(store.dismissToasts()).toBe(4);
    expect(store.getSnapshot().toasts.items).toEqual([]);
    expect(store.getSnapshot().recent).toHaveLength(4);
    expect(store.getSnapshot().bell.unread).toBe(0);
    expect(store.dismissToasts()).toBe(0);
  });

  it('keeps one toast for a record however it changes: its key is its id, so the view moves it and never makes it again (S108)', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Uploading', initiator: 'user', progress: { current: 0, total: 100 } });
    const key = store.getSnapshot().toasts.items[0]?.key;
    for (let tick = 1; tick <= 100; tick += 1) {
      op.progress({ current: tick });
    }

    const { items } = store.getSnapshot().toasts;
    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe(key);
    expect(items[0]?.record?.progress).toMatchObject({ current: 100 });
  });

  it('drops the toast of a record that was removed or read', () => {
    const { store } = makeNotices();
    store.notify({ title: 'A' });
    store.notify({ title: 'B' });
    store.read('n1');
    expect(ids(store.getSnapshot().toasts.items)).toEqual(['n2']);
    store.remove('n2');
    expect(store.getSnapshot().toasts.items).toEqual([]);
  });

  it('keeps the toasts of hundreds of records in bounds: the clocks of the ones nobody sees run out too', async () => {
    const { store, clock } = makeNotices();
    for (let index = 0; index < 300; index += 1) {
      store.forSource(`p${String(index % 60)}`).notify({ title: `Notice ${String(index)}` });
    }

    expect(store.getSnapshot().toasts.items).toHaveLength(LIMITS.toasts);
    await clock.advance(TIMING.toast + 1);
    expect(store.getSnapshot().toasts.items).toEqual([]);
    expect(clock.pending()).toBeLessThanOrEqual(2);
  });
});

describe('a source that is muted (Settings > Notifications, S82)', () => {
  it('raises no toast and lights no dot, and keeps its records in the history', () => {
    const { store } = makeNotices();
    expect(store.mute('cloud')).toBe(true);
    store.forSource('cloud').notify({ title: 'Quiet', severity: 'error', actions: [fix] });
    store.forSource('stack').notify({ title: 'Loud' });
    const state = store.getSnapshot();
    expect(ids(state.toasts.items)).toEqual(['n2']);
    expect(state.recent).toHaveLength(2);
    expect(state.bell.unread).toBe(1);
    expect(state.recent.find((record) => record.source === 'cloud')).toMatchObject({ read: true, unread: false });
  });

  it('takes the toasts it had away when it is muted', () => {
    const { store } = makeNotices();
    store.forSource('cloud').notify({ title: 'A', severity: 'error', actions: [fix] });
    store.mute('cloud');
    expect(store.getSnapshot().toasts.items).toEqual([]);
    expect(store.getSnapshot().bell.unread).toBe(0);
  });

  it('is not unread while it lasts, and its older records are unread again when it ends, unless read', async () => {
    const { store, clock } = makeNotices();
    store.forSource('cloud').notify({ title: 'Before the mute', severity: 'error' });
    store.mute('cloud', clock.now() + 60_000);
    expect(store.getSnapshot().bell.unread).toBe(0);
    store.forSource('cloud').notify({ title: 'During the mute', severity: 'error' });
    await clock.advance(60_001);
    expect(store.getSnapshot().muted).toEqual([]);
    const { recent, bell } = store.getSnapshot();
    expect(recent.map((record) => [record.name, record.unread])).toEqual([['During the mute', false], ['Before the mute', true]]);
    expect(bell.unread).toBe(1);
  });

  it('is told for how long: an hour, a number, or until it is turned on again', () => {
    const { store, clock } = makeNotices();
    store.mute('cloud');
    store.mute('stack', 'forever');
    store.mute('widgets', clock.now() + 5000);
    const { muted } = store.getSnapshot();
    expect(muted.map((entry) => [entry.source, entry.name, entry.until])).toEqual([['cloud', 'Cloud', clock.now() + TIMING.hour], ['stack', 'Stack', 'forever'], ['widgets', 'Widgets', clock.now() + 5000]]);
  });

  it('refuses a mute that is not a time in the future, and one for a source that is not a plugin id', () => {
    const { store, clock } = makeNotices();
    expect(store.mute('cloud', clock.now() - 1)).toBe(false);
    expect(store.mute('cloud', Number.NaN)).toBe(false);
    expect(store.mute('  ')).toBe(false);
    expect(store.getSnapshot().muted).toEqual([]);
  });

  it('is turned off by one source or by all of them', () => {
    const { store } = makeNotices();
    store.mute('cloud');
    store.mute('stack');
    expect(store.unmute('cloud')).toBe(true);
    expect(store.unmute('cloud')).toBe(false);
    expect(store.unmuteAll()).toBe(1);
    expect(store.getSnapshot().muted).toEqual([]);
  });

  it('is changed by saying it again: the later time wins, and the model keeps one timer for the earliest end', async () => {
    const { store, clock } = makeNotices();
    store.mute('cloud', clock.now() + 1000);
    store.mute('cloud', clock.now() + 5000);
    await clock.advance(2000);
    expect(store.getSnapshot().muted).toHaveLength(1);
    await clock.advance(3001);
    expect(store.getSnapshot().muted).toEqual([]);
  });
});
