import { describe, expect, it } from 'vitest';
import { makeNotices } from './testing';
import { TIMING } from './types';

// A plugin that leaves (ch16 S88, S89, PO1: "a plugin that is off contributes nothing"; S84: a function that cannot run stays visible, disabled, with the reason): its operations end, its
// notices' actions are marked unavailable, what it posts afterwards is refused, and a plugin that comes back starts clean. Never a dead button.

const route = { plugin: 'cloud', contribution: 'instances', params: { id: 'i-1' } };

describe('a plugin leaves: its operations end', () => {
  it('ends each as unknown, the outcome that cannot be known: the producer is lost (S74), unread, with no toast and no announcement of its own', () => {
    const { store, said } = makeNotices();
    const cloud = store.forSource('cloud');
    cloud.begin({ title: 'Restarting api-gateway', initiator: 'user', target: 'api-gateway', progress: { current: 3, total: 7 }, onCancel: () => undefined });
    cloud.begin({ title: 'Syncing connections' });
    store.forSource('stack').begin({ title: 'Rolling out' });
    store.dismissToasts();
    said.length = 0;
    expect(store.removePlugin('cloud')).toBe(true);
    const state = store.getSnapshot();
    expect(state.active.map((record) => record.source)).toEqual(['stack']);
    const lost = state.recent.filter((record) => record.source === 'cloud');
    expect(lost.map((record) => [record.state, record.severity, record.word, record.unread, record.progress])).toEqual([['unknown', 'warning', 'Outcome unknown.', true, undefined], ['unknown', 'warning', 'Outcome unknown.', true, undefined]]);
    expect(lost.map((record) => record.text).sort()).toEqual(['Check api-gateway. Cloud isn\'t running.', 'Check the target. Cloud isn\'t running.']);
    expect(state.toasts.items).toEqual([]);
    expect(said).toEqual([]);
    expect(state.bell.dot).toBe('warning');
  });

  it('never calls the code of a plugin that is not there: its cancel is not asked', () => {
    const { store } = makeNotices();
    let asked = 0;
    const op = store.forSource('cloud').begin({ title: 'Backing up', onCancel: () => {
      asked += 1;
    } });
    store.removePlugin('cloud');
    expect(store.run(op.id, 'cancel')).toMatchObject({ status: 'refused' });
    expect(asked).toBe(0);
  });

  it('answers nothing when there is nothing to do, and does not touch the host\'s own work', () => {
    const { store } = makeNotices();
    store.begin({ title: 'Syncing' });
    expect(store.removePlugin('cloud')).toBe(true);
    expect(store.removePlugin('cloud')).toBe(false);
    expect(store.removePlugin('host')).toBe(false);
    expect(store.getSnapshot().active).toHaveLength(1);
  });

  it('lets the users of the status area see the count fall at once', () => {
    const { store } = makeNotices();
    store.forSource('cloud').begin({ title: 'A' });
    store.forSource('cloud').begin({ title: 'B' });
    store.forSource('stack').begin({ title: 'C' });
    expect(store.getSnapshot().activity.count).toBe(3);
    store.removePlugin('cloud');
    expect(store.getSnapshot().activity).toMatchObject({ count: 1, text: 'C' });
  });
});

describe('a plugin leaves: its notices\' actions are marked unavailable (never a dead button)', () => {
  it('shows the action of its code disabled with the reason, and keeps what is data: a route and a command are the host\'s to answer', () => {
    const { store } = makeNotices();
    let ran = 0;
    store.forSource('cloud').notify({ title: 'Disk is filling', severity: 'warning', actions: [
      { id: 'fix', label: 'Fix it', run: () => {
        ran += 1;
      } },
      { id: 'go', label: 'Open instance', route },
      { id: 'cmd', label: 'Sign in', command: { id: 'host.signIn' } },
    ] });
    store.removePlugin('cloud');
    const actions = store.getSnapshot().recent[0]?.actions ?? [];
    expect(Object.fromEntries(actions.map((action) => [action.id, action.disabled]))).toEqual({ fix: 'Cloud isn\'t running.', go: '', cmd: '' });
    expect(store.run('n1', 'fix')).toEqual({ status: 'refused', reason: 'disabled', message: 'Cloud isn\'t running.' });
    expect(ran).toBe(0);
  });

  it('says why in words under the text, for a surface that has room (X9)', () => {
    const { store } = makeNotices();
    store.forSource('cloud').begin({ title: 'Connecting to prod-db', initiator: 'user', onRetry: () => undefined }).fail('Nothing answered.');
    store.removePlugin('cloud');
    expect(store.getSnapshot().recent[0]).toMatchObject({ reason: 'Retry is unavailable. Cloud isn\'t running.' });
  });

  it('leaves no action that is both enabled and without a way to act: every action either acts or says why not', () => {
    const { store } = makeNotices();
    const cloud = store.forSource('cloud');
    cloud.notify({ title: 'A', actions: [{ id: 'a', label: 'A', run: () => undefined }] });
    cloud.begin({ title: 'B', initiator: 'user', onRetry: () => undefined, actions: [{ id: 'b', label: 'B', run: () => undefined }] }).fail();
    cloud.begin({ title: 'C', initiator: 'user', onCancel: () => undefined });
    store.removePlugin('cloud');
    for (const record of [...store.getSnapshot().recent, ...store.getSnapshot().active]) {
      for (const action of record.actions) {
        const acts = action.route !== undefined || action.command !== undefined;
        expect({ id: action.id, ok: acts || action.disabled !== '' }).toEqual({ id: action.id, ok: true });
      }
    }
  });

  it('asks the host again for what it answers (a route to a plugin that is now off), when the plugin leaves', () => {
    const { store, off } = makeNotices();
    store.forSource('stack').notify({ title: 'See the instance', actions: [{ id: 'go', label: 'Open instance', route }] });
    off.add('cloud');
    store.removePlugin('cloud');
    expect(store.getSnapshot().recent[0]?.actions[0]).toMatchObject({ id: 'go', disabled: 'cloud is turned off' });
  });

  it('takes the decision away from a toast that waited on it: a warning closes by itself now, and stays unread; an error stays (S77: a failure must not vanish)', async () => {
    const { store, clock } = makeNotices();
    const fix = { id: 'fix', label: 'Fix it', run: () => undefined };
    store.forSource('cloud').notify({ title: 'Disk is filling', severity: 'warning', actions: [fix] });
    store.forSource('cloud').notify({ title: 'Disk is full', severity: 'error', actions: [fix] });
    expect(store.getSnapshot().toasts.items.map((item) => item.sticky)).toEqual([true, true]);
    store.removePlugin('cloud');
    expect(store.getSnapshot().toasts.items.map((item) => item.sticky)).toEqual([false, true]);
    await clock.advance(TIMING.toast + 1);
    expect(store.getSnapshot().toasts.items.map((item) => item.record?.name)).toEqual(['Disk is full']);
    expect(store.getSnapshot().recent.map((record) => record.unread)).toEqual([true, true]);
  });

  it('keeps what is in the history: the notices stay, readable, and may still be cleared', () => {
    const { store } = makeNotices();
    store.forSource('cloud').notify({ title: 'Disk is full' });
    store.removePlugin('cloud');
    expect(store.getSnapshot().recent).toHaveLength(1);
    expect(store.clear({ source: 'cloud' }).removed).toBe(1);
  });
});

describe('a plugin that left cannot post (epoch fencing)', () => {
  it('refuses what a producer made before the plugin left: its notices, its operations, and the handles it still holds', () => {
    const { store } = makeNotices();
    const stale = store.forSource('cloud');
    const op = stale.begin({ title: 'Backing up' });
    store.removePlugin('cloud');
    const count = store.getSnapshot().recent.length;
    expect(stale.notify({ title: 'Zombie' })).toMatchObject({ id: '', refused: expect.stringContaining('cloud') as string });
    expect(stale.begin({ title: 'Zombie' }).refused).not.toBe('');
    expect(stale.fromError({ type: 'omniview:internal', title: 'Error', status: 500, detail: 'x' })).toMatchObject({ id: '' });
    expect(op.progress(5)).toBe(false);
    expect(op.succeed()).toBe(false);
    expect(store.getSnapshot().recent).toHaveLength(count);
  });

  it('starts clean when the plugin comes back: a new producer works, its old actions say they did not survive', () => {
    const { store } = makeNotices();
    store.forSource('cloud').notify({ title: 'Old', actions: [{ id: 'fix', label: 'Fix it', run: () => undefined }] });
    store.removePlugin('cloud');
    const fresh = store.forSource('cloud');
    expect(fresh.notify({ title: 'New' })).toMatchObject({ refused: '' });
    const [created, old] = store.getSnapshot().recent;
    expect(created?.name).toBe('New');
    expect(old?.actions[0]).toMatchObject({ id: 'fix', disabled: 'Not available after restart' });
  });

  it('gives it a new budget: what it posted before it left does not count against it', () => {
    const { store } = makeNotices();
    const first = store.forSource('cloud');
    for (let index = 0; index < 20; index += 1) {
      first.notify({ title: `Notice ${String(index)}` });
    }

    store.removePlugin('cloud');
    expect(store.forSource('cloud').notify({ title: 'After' }).record?.count).toBe(1);
    expect(store.getSnapshot().recent[0]).toMatchObject({ name: 'After' });
  });

  it('is not the host: its producer is never fenced', () => {
    const { store } = makeNotices();
    const host = store.forSource('host');
    store.removePlugin('host');
    expect(host.notify({ title: 'Still here' }).refused).toBe('');
  });
});
