import { describe, expect, it } from 'vitest';
import { makeNotices } from './testing';
import { LIMITS, TIMING } from './types';

// Messages: something that happened, as one record (ch16 S74, S75, S79, S80, S81, S82, S85; the mock's `Shell.notify`, shell-notify.js:15-17, 168-200, 306-380, 620-690). A repeating failure updates
// one notice with a count instead of stacking; the history is bounded; read and unread follow S81; a plugin cannot flood (S82); the host's error is a notice.

const second = 1000;
const day = 86_400_000;

describe('posting a message', () => {
  it('is one record that every rendering reads, newest first, unread', () => {
    const { store } = makeNotices();
    const handle = store.notify({ title: 'Snapshot created', detail: '40 GiB in us-east-1', severity: 'success' });
    expect(handle).toMatchObject({ id: 'n1', refused: '' });
    const record = store.getSnapshot().recent[0];
    expect(record).toMatchObject({ id: 'n1', kind: 'message', severity: 'success', state: 'succeeded', source: 'host', sourceName: 'Omniview', initiator: 'system', title: 'Snapshot created', text: '40 GiB in us-east-1', active: false, unread: true, read: false, count: 1, fold: '', attempt: 1 });
    expect(handle.record).toBe(record);
    expect(store.getSnapshot().counts).toEqual({ all: 1, active: 0, attention: 0, unread: 1 });
    expect(store.getSnapshot().bell).toMatchObject({ dot: 'info', unread: 1, label: 'Notifications, 1 unread' });
  });

  it('lists the newest first', () => {
    const { store } = makeNotices();
    store.notify({ title: 'First' });
    store.notify({ title: 'Second' });
    store.notify({ title: 'Third' });
    expect(store.getSnapshot().recent.map((record) => record.name)).toEqual(['Third', 'Second', 'First']);
  });

  it('bounds the title, the sentence and the diagnostics, and cleans them: a title cannot be disguised', () => {
    const { store } = makeNotices();
    store.notify({ title: `${'T'.repeat(100)}`, detail: 'd'.repeat(300), details: 'x'.repeat(20_000) });
    store.notify({ title: 'Deploy\u202egnirtS\u202c done', detail: 'line one\nline two\u0007' });
    const [second, first] = store.getSnapshot().recent;
    expect(first?.name).toHaveLength(LIMITS.title);
    expect(first?.text).toHaveLength(LIMITS.detail);
    expect(first?.details).toHaveLength(LIMITS.details);
    expect(second?.name).toBe('DeploygnirtS done');
    expect(second?.text).toBe('line one line two');
  });

  it('refuses what is not a notice, with a reason, and tells the host\'s hook: it records nothing', () => {
    const { store, errors } = makeNotices();
    const before = store.getSnapshot();
    for (const bad of [{ title: '   ' }, { title: '' }, {}, null, 'text', 7] as unknown[]) {
      const handle = store.notify(bad as never);
      expect(handle.refused).not.toBe('');
      expect(handle.id).toBe('');
      expect(handle.record).toBeUndefined();
      expect(handle.dismiss()).toBe(false);
    }

    expect(store.getSnapshot()).toBe(before);
    expect(errors.length).toBe(6);
  });

  it('is of the host unless a producer of the host names a source; a plugin\'s producer ignores a source it was handed: the host stamps it (S74)', () => {
    const { store } = makeNotices();
    store.notify({ title: 'From the host' });
    store.notify({ title: 'Named', source: 'Cloud' });
    store.forSource('stack').notify({ title: 'Claimed', source: 'cloud' });
    expect(store.getSnapshot().recent.map((record) => [record.name, record.source, record.sourceName])).toEqual([['Claimed', 'stack', 'Stack'], ['Named', 'cloud', 'Cloud'], ['From the host', 'host', 'Omniview']]);
  });

  it('gives a plugin that has no name of its own its id with a capital', () => {
    const { store } = makeNotices();
    store.forSource('widgets').notify({ title: 'Hello' });
    expect(store.getSnapshot().recent[0]?.sourceName).toBe('Widgets');
  });

  it('hands a producer for a source that is not a plugin id nothing to post with', () => {
    const { store } = makeNotices();
    const producer = store.forSource('   ');
    expect(producer.notify({ title: 'x' }).refused).not.toBe('');
    expect(producer.begin({ title: 'x' }).refused).not.toBe('');
    expect(store.getSnapshot().recent).toEqual([]);
  });

  it('keeps nothing of what it was handed that it could be changed through', () => {
    const { store } = makeNotices();
    const actions = [{ id: 'go', label: 'Go', route: { plugin: 'cloud', contribution: 'instances', params: { id: 'i-1' } } }];
    store.notify({ title: 'x', actions });
    actions[0] = { id: 'other', label: 'Other', route: { plugin: 'cloud', contribution: 'volumes', params: { id: 'v-1' } } };
    expect(store.getSnapshot().recent[0]?.actions.map((action) => action.id)).toEqual(['go']);
    expect(Object.isFrozen(store.getSnapshot().recent[0])).toBe(true);
  });
});

describe('read and unread (S81)', () => {
  it('is unread until read, and reading counts what it changed', () => {
    const { store } = makeNotices();
    store.notify({ title: 'a' });
    store.notify({ title: 'b' });
    store.notify({ title: 'c' });
    expect(store.read(['n1'])).toBe(1);
    expect(store.read('n1')).toBe(0);
    expect(store.getSnapshot().bell.unread).toBe(2);
    expect(store.readAll()).toBe(2);
    expect(store.readAll()).toBe(0);
    expect(store.getSnapshot().bell).toMatchObject({ dot: '', unread: 0, label: 'Notifications' });
  });

  it('changes nothing, and hands back the same snapshot, for a read that read nothing', () => {
    const { store } = makeNotices();
    store.notify({ title: 'a' });
    store.readAll();
    const before = store.getSnapshot();
    expect(store.read(['n1', 'gone'])).toBe(0);
    expect(store.readAll()).toBe(0);
    expect(store.getSnapshot()).toBe(before);
  });

  it('counts what the centre listed as read when it was open at least a second, and not before (S81)', () => {
    const { store, clock } = makeNotices();
    store.notify({ title: 'a' });
    store.notify({ title: 'b' });
    expect(store.seen(['n1', 'n2'], { since: clock.now() - (TIMING.seen - 1) })).toBe(0);
    expect(store.getSnapshot().bell.unread).toBe(2);
    expect(store.seen(['n1', 'n2'], { since: clock.now() - TIMING.seen })).toBe(2);
    expect(store.getSnapshot().bell.unread).toBe(0);
  });

  it('lights the bell by the worst unread severity, and names the counts, never a number to draw (A12)', () => {
    const { store } = makeNotices();
    store.notify({ title: 'a', severity: 'warning' });
    store.notify({ title: 'b', severity: 'warning' });
    store.notify({ title: 'c', severity: 'error' });
    store.notify({ title: 'd', severity: 'success' });
    const bell = store.getSnapshot().bell;
    expect(bell).toMatchObject({ dot: 'error', unread: 4, errors: 1, warnings: 2, attention: 3 });
    expect(bell.label).toBe('Notifications, 4 unread, 1 error, 2 warnings');
    expect(store.getSnapshot().counts).toEqual({ all: 4, active: 0, attention: 3, unread: 4 });
  });

  it('dismisses by hiding the toast and marking it read: the record stays in the history (ch05 162)', () => {
    const { store } = makeNotices();
    const handle = store.notify({ title: 'a' });
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
    expect(handle.dismiss()).toBe(true);
    const state = store.getSnapshot();
    expect(state.toasts.items).toEqual([]);
    expect(state.recent).toHaveLength(1);
    expect(state.recent[0]).toMatchObject({ read: true, unread: false, toasted: true });
    expect(handle.dismiss()).toBe(false);
    expect(store.dismiss('n1')).toBe(false);
    expect(store.dismiss('gone')).toBe(false);
  });
});

describe('the bounded history (S74)', () => {
  it('is five hundred records and seven days: the owner\'s decision B7, ruled by the lead on 2026-11-20 (the mock says two hundred)', () => {
    expect(LIMITS.history).toBe(500);
    expect(LIMITS.age).toBe(7 * day);
  });

  it('keeps the newest five hundred and lets the oldest go', () => {
    const { store } = makeNotices();
    for (let index = 1; index <= 550; index += 1) {
      store.forSource(`p${String(index % 110)}`).notify({ title: `Notice ${String(index)}` });
    }

    const { recent } = store.getSnapshot();
    expect(recent).toHaveLength(500);
    expect(recent[0]?.name).toBe('Notice 550');
    expect(recent.at(-1)?.name).toBe('Notice 51');
    expect(store.getSnapshot().counts.all).toBe(500);
  });

  it('never drops work that is still running, however many messages come after it', () => {
    const { store } = makeNotices();
    const handle = store.begin({ title: 'Restoring a backup' });
    for (let index = 1; index <= 600; index += 1) {
      store.forSource(`p${String(index % 120)}`).notify({ title: `Notice ${String(index)}` });
    }

    expect(handle.active).toBe(true);
    expect(store.getSnapshot().active.map((record) => record.id)).toEqual([handle.id]);
    expect(store.getSnapshot().recent).toHaveLength(500);
  });

  it('is told its own bound: the decision of B7 is two numbers', () => {
    const { store } = makeNotices({ history: { max: 3 } });
    for (let index = 1; index <= 5; index += 1) {
      store.forSource(`p${String(index)}`).notify({ title: `Notice ${String(index)}` });
    }

    expect(store.getSnapshot().recent.map((record) => record.name)).toEqual(['Notice 5', 'Notice 4', 'Notice 3']);
  });

  it('lets a record go that is older than seven days, the next time something is recorded', async () => {
    const { store, clock } = makeNotices();
    store.forSource('p1').notify({ title: 'Old' });
    await clock.advance(7 * day);
    store.forSource('p2').notify({ title: 'Recent' });
    expect(store.getSnapshot().recent.map((record) => record.name)).toEqual(['Recent', 'Old']);
    await clock.advance(day + TIMING.fold);
    store.forSource('p3').notify({ title: 'Newest' });
    expect(store.getSnapshot().recent.map((record) => record.name)).toEqual(['Newest', 'Recent']);
  });

  it('keeps an age the host chose', async () => {
    const { store, clock } = makeNotices({ history: { age: 2 * TIMING.fold } });
    store.forSource('p1').notify({ title: 'Old' });
    await clock.advance(3 * TIMING.fold);
    store.forSource('p2').notify({ title: 'New' });
    expect(store.getSnapshot().recent.map((record) => record.name)).toEqual(['New']);
  });
});

describe('remove, clear and undo (S80)', () => {
  it('removes a finished record, and Undo puts it back where it was, for ten seconds', async () => {
    const { store, clock } = makeNotices();
    store.notify({ title: 'a' });
    store.notify({ title: 'b' });
    store.notify({ title: 'c' });
    store.dismissToasts();
    const result = store.remove('n2');
    expect(result.removed).toBe(1);
    expect(store.getSnapshot().recent.map((record) => record.name)).toEqual(['c', 'a']);
    expect(store.getSnapshot().undo).toEqual({ count: 1, until: clock.now() + TIMING.undo });
    expect(result.undo()).toBe(true);
    expect(store.getSnapshot().recent.map((record) => record.name)).toEqual(['c', 'b', 'a']);
    expect(store.getSnapshot().undo).toBeUndefined();
    expect(result.undo()).toBe(false);
  });

  it('puts a record back without a toast, an announcement or a new unread mark: it was seen before', () => {
    const { store, said } = makeNotices();
    store.notify({ title: 'a' });
    store.dismissToasts();
    const result = store.remove('n1');
    result.undo();
    expect(store.getSnapshot().toasts.items).toEqual([]);
    expect(store.getSnapshot().recent[0]?.read).toBe(true);
    expect(said).toEqual([]);
  });

  it('offers Undo for ten seconds only, and says so in the snapshot', async () => {
    const { store, clock } = makeNotices();
    store.notify({ title: 'a' });
    const result = store.remove('n1');
    await clock.advance(TIMING.undo - 1);
    expect(store.getSnapshot().undo).toBeDefined();
    await clock.advance(2);
    expect(store.getSnapshot().undo).toBeUndefined();
    expect(result.undo()).toBe(false);
    expect(store.undo()).toBe(false);
    expect(store.getSnapshot().recent).toEqual([]);
  });

  it('undoes the last removal only', () => {
    const { store } = makeNotices();
    store.notify({ title: 'a' });
    store.notify({ title: 'b' });
    const first = store.remove('n1');
    const second = store.remove('n2');
    expect(first.undo()).toBe(false);
    expect(second.undo()).toBe(true);
    expect(store.getSnapshot().recent.map((record) => record.name)).toEqual(['b']);
  });

  it('removes nothing that is still running, and nothing that is not there', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Working' });
    expect(store.remove(op.id).removed).toBe(0);
    expect(store.remove('gone').removed).toBe(0);
    expect(op.active).toBe(true);
  });

  it('clears the finished and keeps the active, with Undo', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Working' });
    store.notify({ title: 'a' });
    store.notify({ title: 'b' });
    const result = store.clear();
    expect(result.removed).toBe(2);
    expect(store.getSnapshot().recent).toEqual([]);
    expect(store.getSnapshot().active.map((record) => record.id)).toEqual([op.id]);
    expect(result.undo()).toBe(true);
    expect(store.getSnapshot().recent).toHaveLength(2);
    expect(store.clear().removed).toBe(2);
  });

  it('clears only the kind or the source it is told (the Operations tool\'s "Clear finished" leaves the messages)', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Working' });
    op.succeed();
    store.notify({ title: 'a' });
    store.forSource('cloud').notify({ title: 'b' });
    expect(store.clear({ kind: 'operation' }).removed).toBe(1);
    expect(store.clear({ source: 'cloud' }).removed).toBe(1);
    expect(store.getSnapshot().recent.map((record) => record.name)).toEqual(['a']);
    expect(store.clear({ source: 'nobody' }).removed).toBe(0);
  });

  it('frees the dedupe key of what it removed', () => {
    const { store } = makeNotices();
    const first = store.notify({ title: 'Lost the connection', key: 'conn' });
    store.remove(first.id);
    const second = store.notify({ title: 'Lost the connection', key: 'conn' });
    expect(second.id).not.toBe(first.id);
    expect(store.getSnapshot().recent[0]?.count).toBe(1);
  });
});

describe('a repeating failure is one notice with a count, not a stack (S85)', () => {
  it('folds the same key into the notice it already has, keeps its words, and counts', async () => {
    const { store, clock } = makeNotices();
    const producer = store.forSource('cloud');
    const first = producer.notify({ title: 'Lost the connection', detail: 'Nothing answered.', severity: 'warning', key: 'conn:prod' });
    await clock.advance(30 * second);
    const again = producer.notify({ title: 'Lost the connection to prod', detail: 'It timed out.', severity: 'warning', key: 'conn:prod' });
    expect(again.id).toBe(first.id);
    const { recent } = store.getSnapshot();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ count: 2, fold: 'key', title: 'Lost the connection', text: 'Happened 2 times · Nothing answered.' });
  });

  it('is quiet: it is not unread again, and raises no toast again, after the user has seen it', async () => {
    const { store, clock } = makeNotices();
    const producer = store.forSource('cloud');
    const first = producer.notify({ title: 'Lost the connection', severity: 'warning', key: 'conn:prod' });
    first.dismiss();
    await clock.advance(5 * second);
    producer.notify({ title: 'Lost the connection', severity: 'warning', key: 'conn:prod' });
    producer.notify({ title: 'Lost the connection', severity: 'warning', key: 'conn:prod' });
    const state = store.getSnapshot();
    expect(state.recent[0]).toMatchObject({ count: 3, read: true, unread: false });
    expect(state.toasts.items).toEqual([]);
    expect(state.bell.unread).toBe(0);
  });

  it('takes the worst severity it saw', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    producer.notify({ title: 'Lost the connection', severity: 'warning', key: 'k' });
    producer.notify({ title: 'Lost the connection', severity: 'error', key: 'k' });
    producer.notify({ title: 'Lost the connection', severity: 'info', key: 'k' });
    expect(store.getSnapshot().recent[0]?.severity).toBe('error');
  });

  it('allows one notification a key in ten minutes, counted from the first: then it is a new notice', async () => {
    const { store, clock } = makeNotices();
    const producer = store.forSource('cloud');
    const first = producer.notify({ title: 'Lost the connection', key: 'k' });
    await clock.advance(TIMING.key - 1);
    expect(producer.notify({ title: 'Lost the connection', key: 'k' }).id).toBe(first.id);
    await clock.advance(2);
    const next = producer.notify({ title: 'Lost the connection', key: 'k' });
    expect(next.id).not.toBe(first.id);
    expect(store.getSnapshot().recent.map((record) => record.count)).toEqual([1, 2]);
  });

  it('keeps a key of its own for each source', () => {
    const { store } = makeNotices();
    store.forSource('cloud').notify({ title: 'Down', key: 'k' });
    store.forSource('stack').notify({ title: 'Down', key: 'k' });
    expect(store.getSnapshot().recent).toHaveLength(2);
  });

  it('costs nothing to repeat: it is not a record, so a flood of one key is one notice with a big count', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    for (let index = 0; index < 5000; index += 1) {
      producer.notify({ title: 'Lost the connection', key: 'k' });
    }

    const { recent } = store.getSnapshot();
    expect(recent).toHaveLength(1);
    expect(recent[0]?.count).toBe(5000);
    expect(store.stats().limited).toBe(0);
  });
});

describe('a burst of related notices is one record (S82, S79)', () => {
  it('folds a group inside sixty seconds, says it in words, and is news again each time', async () => {
    const { store, clock } = makeNotices();
    const producer = store.forSource('cloud');
    for (let index = 1; index <= 3; index += 1) {
      producer.notify({ title: `Connecting to replica ${String(index)}`, detail: 'Timed out', severity: 'error', group: 'connect' });
      await clock.advance(10 * second);
    }

    const { recent } = store.getSnapshot();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ count: 3, fold: 'group', title: '3 connections failed', name: 'Connecting to replica 3', text: 'Latest: Connecting to replica 3 — Timed out', unread: true });
  });

  it('raises its toast again for a group the user dismissed: a failure must not vanish (S78)', async () => {
    const { store, clock } = makeNotices();
    const producer = store.forSource('cloud');
    const first = producer.notify({ title: 'Connecting to replica 1', severity: 'error', group: 'connect' });
    first.dismiss();
    expect(store.getSnapshot().toasts.items).toEqual([]);
    await clock.advance(second);
    producer.notify({ title: 'Connecting to replica 2', severity: 'error', group: 'connect' });
    expect(store.getSnapshot().toasts.items.map((item) => item.id)).toEqual([first.id]);
    expect(store.getSnapshot().recent[0]?.unread).toBe(true);
  });

  it('slides: each fold keeps the window open, and a minute of quiet closes it', async () => {
    const { store, clock } = makeNotices();
    const producer = store.forSource('cloud');
    producer.notify({ title: 'Connecting to replica 1', severity: 'error', group: 'connect' });
    await clock.advance(50 * second);
    producer.notify({ title: 'Connecting to replica 2', severity: 'error', group: 'connect' });
    await clock.advance(50 * second);
    producer.notify({ title: 'Connecting to replica 3', severity: 'error', group: 'connect' });
    expect(store.getSnapshot().recent).toHaveLength(1);
    await clock.advance(TIMING.fold + 1);
    producer.notify({ title: 'Connecting to replica 4', severity: 'error', group: 'connect' });
    expect(store.getSnapshot().recent.map((record) => record.count)).toEqual([1, 3]);
  });

  it('says a group that has no noun by its source, and keeps the children in its details', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    producer.notify({ title: 'Something happened', detail: 'one', group: 'g' });
    producer.notify({ title: 'Something else happened', detail: 'two', group: 'g' });
    const record = store.getSnapshot().recent[0];
    expect(record?.title).toBe('2 notifications from Cloud');
    expect(record?.details).toContain('Something happened');
    expect(record?.details).toContain('Something else happened — two');
  });

  it('takes the latest producer\'s actions, so a Retry on a folded failure is the latest one\'s', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    const calls: string[] = [];
    producer.notify({ title: 'Connecting to replica 1', severity: 'error', group: 'connect', actions: [{ id: 'fix', label: 'Fix', run: () => calls.push('first') }] });
    producer.notify({ title: 'Connecting to replica 2', severity: 'error', group: 'connect', actions: [{ id: 'fix', label: 'Fix', run: () => calls.push('second') }] });
    store.run('n1', 'fix');
    expect(calls).toEqual(['second']);
  });

  it('keeps a group of each source apart', () => {
    const { store } = makeNotices();
    store.forSource('cloud').notify({ title: 'Connecting to a', severity: 'error', group: 'g' });
    store.forSource('stack').notify({ title: 'Connecting to b', severity: 'error', group: 'g' });
    expect(store.getSnapshot().recent).toHaveLength(2);
  });
});

describe('the same message again (S79)', () => {
  it('is one record that says how many times', async () => {
    const { store, clock } = makeNotices();
    const producer = store.forSource('cloud');
    producer.notify({ title: 'Snapshot created', detail: 'snap-0a1b2c' });
    await clock.advance(5 * second);
    producer.notify({ title: 'Snapshot created', detail: 'snap-0a1b2c' });
    producer.notify({ title: 'Snapshot created', detail: 'snap-0a1b2c' });
    const { recent } = store.getSnapshot();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ count: 3, fold: 'repeat', title: 'Snapshot created 3 times' });
  });

  it('is another record when anything differs, or when a minute went by', async () => {
    const { store, clock } = makeNotices();
    const producer = store.forSource('cloud');
    producer.notify({ title: 'Snapshot created', detail: 'a' });
    producer.notify({ title: 'Snapshot created', detail: 'b' });
    producer.notify({ title: 'Snapshot created', detail: 'a', severity: 'warning' });
    await clock.advance(TIMING.fold + 1);
    producer.notify({ title: 'Snapshot created', detail: 'a' });
    expect(store.getSnapshot().recent).toHaveLength(4);
  });
});

describe('a handle of a notice that folded drives the notice that holds it', () => {
  it('answers with the id that holds it, and dismisses that one', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    const first = producer.notify({ title: 'Snapshot created' });
    const second = producer.notify({ title: 'Snapshot created' });
    expect(second.id).toBe(first.id);
    expect(second.record?.count).toBe(2);
    expect(second.dismiss()).toBe(true);
    expect(store.getSnapshot().toasts.items).toEqual([]);
  });
});

describe('a plugin cannot flood the user (S82)', () => {
  it('folds what is over its second into one row that says so, and keeps the notices within budget as they were', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    const handles = Array.from({ length: 8 }, (_, index) => producer.notify({ title: `Notice ${String(index)}` }));
    const { recent } = store.getSnapshot();
    expect(recent).toHaveLength(LIMITS.perSecond + 1);
    const row = recent[0];
    expect(row).toMatchObject({ source: 'cloud', severity: 'warning', title: 'Cloud is posting many notifications', count: 3, text: '3 more notifications grouped in this row.' });
    expect(row?.actions.map((action) => [action.id, action.label, action.disabled])).toEqual([['mute', 'Mute for 1 hour', '']]);
    expect(handles.slice(0, LIMITS.perSecond).every((handle) => handle.id !== row?.id)).toBe(true);
    expect(handles.slice(LIMITS.perSecond).every((handle) => handle.id === row?.id && handle.refused === '')).toBe(true);
  });

  it('says one notification of the row in the singular', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    for (let index = 0; index < LIMITS.perSecond + 1; index += 1) {
      producer.notify({ title: `Notice ${String(index)}` });
    }

    expect(store.getSnapshot().recent[0]?.text).toBe('1 more notification grouped in this row.');
  });

  it('is quiet about it after the first time: the row counts on and does not raise its toast again', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    for (let index = 0; index < 8; index += 1) {
      producer.notify({ title: `Notice ${String(index)}` });
    }

    store.dismissToasts();
    for (let index = 8; index < 40; index += 1) {
      producer.notify({ title: `Notice ${String(index)}` });
    }

    const state = store.getSnapshot();
    expect(state.recent[0]?.count).toBe(35);
    expect(state.toasts.items).toEqual([]);
  });

  it('keeps the minute: a source that went on posting stays folded after the second is over, and recovers after a quiet minute', async () => {
    const { store, clock } = makeNotices();
    const producer = store.forSource('cloud');
    for (let at = 0; at < 6; at += 1) {
      for (let index = 0; index < 5; index += 1) {
        producer.notify({ title: `Notice ${String(at)}.${String(index)}` });
      }

      await clock.advance(second);
    }

    // Thirty posts in six seconds: twenty a minute is long over.
    const afterBurst = store.getSnapshot().recent.filter((record) => record.fold !== 'rate' && record.count === 1).length;
    expect(afterBurst).toBeLessThanOrEqual(LIMITS.perMinute);
    await clock.advance(30 * second);
    producer.notify({ title: 'Still flooding' });
    expect(store.getSnapshot().recent[0]).toMatchObject({ title: 'Cloud is posting many notifications' });
    await clock.advance(TIMING.fold + second);
    const calm = producer.notify({ title: 'After a quiet minute' });
    expect(store.getSnapshot().recent[0]).toMatchObject({ id: calm.id, name: 'After a quiet minute' });
  });

  it('keeps one source from affecting another', () => {
    const { store } = makeNotices();
    for (let index = 0; index < 20; index += 1) {
      store.forSource('cloud').notify({ title: `Notice ${String(index)}` });
    }

    expect(store.forSource('stack').notify({ title: 'Fine' }).record?.count).toBe(1);
  });

  it('keeps a plugin that floods from filling the history: ten thousand notices in one tick are five records and a row', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    for (let index = 0; index < 10_000; index += 1) {
      producer.notify({ title: `Notice ${String(index)}` });
    }

    const state = store.getSnapshot();
    expect(state.recent).toHaveLength(LIMITS.perSecond + 1);
    expect(state.recent[0]).toMatchObject({ count: 10_000 - LIMITS.perSecond, fold: 'rate' });
    expect(state.toasts.items.length).toBeLessThanOrEqual(LIMITS.toasts);
    expect(store.stats().limited).toBe(10_000 - LIMITS.perSecond);
    expect(store.stats().posted).toBeLessThanOrEqual(LIMITS.perSecond + 1);
  });

  it('keeps the children it folded in its details, and bounded', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    for (let index = 0; index < 1000; index += 1) {
      producer.notify({ title: `Notice ${String(index)}` });
    }

    const row = store.getSnapshot().recent[0];
    expect(row?.details.split('\n').length).toBeLessThanOrEqual(LIMITS.children);
    expect(row?.details).toContain('Notice 999');
  });

  it('lets the user mute the plugin from the row: its toasts and bell dot stop, its records stay (S82, Settings > Notifications)', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    for (let index = 0; index < 8; index += 1) {
      producer.notify({ title: `Notice ${String(index)}` });
    }

    const row = store.getSnapshot().recent[0];
    expect(row).toBeDefined();
    expect(store.run(row?.id ?? '', 'mute')).toEqual({ status: 'done' });
    const state = store.getSnapshot();
    expect(state.muted).toEqual([{ source: 'cloud', name: 'Cloud', until: expect.any(Number) as number }]);
    expect(state.toasts.items).toEqual([]);
    expect(state.bell.unread).toBe(0);
    expect(state.recent).toHaveLength(LIMITS.perSecond + 1);
  });
});

describe('the host\'s error as a notice', () => {
  const timeout = { type: 'omniview:resource/timeout', title: 'Timed out', status: 408, detail: 'The cluster did not complete the request in time.', code: 'TIMEOUT', requestId: 'req-1', recovery: 'none' };

  it('is the class\'s title and the sentence, an error of work the user started, with its diagnostics', () => {
    const { store } = makeNotices();
    const handle = store.forSource('cloud').fromError(timeout);
    expect(handle?.record).toMatchObject({ kind: 'message', severity: 'error', title: 'Timed out', text: 'The cluster did not complete the request in time.', initiator: 'user', urgent: true, source: 'cloud' });
    expect(handle?.record?.details).toContain('Code: TIMEOUT');
  });

  it('says nothing for a cancellation: it is not a failure to tell', () => {
    const { store } = makeNotices();
    expect(store.forSource('cloud').fromError({ type: 'omniview:cancelled', title: 'Cancelled', status: 499, detail: 'The operation was cancelled.', code: 'CANCELLED' })).toBeUndefined();
    expect(store.getSnapshot().recent).toEqual([]);
  });

  it('keeps the host\'s own text for FORBIDDEN whatever the caller offers (the notice cannot say what the host did not)', () => {
    const { store } = makeNotices();
    const handle = store.forSource('cloud').fromError({ type: 'omniview:resource/forbidden', title: 'Access denied', status: 403, detail: 'The operation is not permitted.', code: 'FORBIDDEN' }, { title: 'Mine', detail: 'My sentence with a secret.' });
    expect(handle?.record).toMatchObject({ title: 'Access denied', text: 'The operation is not permitted.' });
  });

  it('is a generic failure for what is not the host\'s envelope, and shows none of it', () => {
    const { store } = makeNotices();
    const handle = store.forSource('cloud').fromError(new Error('token=abc123'));
    expect(handle?.record).toMatchObject({ title: 'Operation failed', text: 'The operation could not be completed.' });
    expect(JSON.stringify(handle?.record)).not.toContain('abc123');
  });

  it('folds the same failure again by its words, and by a key a caller gives', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    producer.fromError(timeout);
    producer.fromError(timeout);
    expect(store.getSnapshot().recent).toHaveLength(1);
    expect(store.getSnapshot().recent[0]).toMatchObject({ count: 2, title: 'Timed out 2 times' });
  });
});
