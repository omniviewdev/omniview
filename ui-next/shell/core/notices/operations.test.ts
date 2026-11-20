import { describe, expect, it } from 'vitest';
import { makeNotices } from './testing';
import { LIMITS, TIMING } from './types';

// Operations: work with a state and a record (ch16 S74 to S78, S81, S81a, S84, S84a, S134; ch05 OF1 to OF3; the mock's `Shell.ops.begin`, shell-notify.js:11-14, 168-200, 270-310, 539-575, and the
// simulations of shell-feedback.js:1031-1100). One record, whoever produces it; Retry is the SAME record again (attempt 2, 3), and it keeps its place in the history; cancel is a callback that
// may be absent and never over-promises; the work that ends is its own result notice.

const second = 1000;

describe('beginning work', () => {
  it('is one record that is active: running, with its words, its progress and its toast while the user waits (S77)', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Restarting api-gateway', doneTitle: 'Restarted api-gateway', initiator: 'user', progress: { current: 0, total: 7, unit: 'items' }, message: 'Draining the first node', target: { label: 'api-gateway', kind: 'restart' } });
    expect(op).toMatchObject({ id: 'n1', refused: '', state: 'running', active: true });
    const state = store.getSnapshot();
    expect(state.active).toHaveLength(1);
    expect(state.active[0]).toMatchObject({
      id: 'n1',
      kind: 'operation',
      state: 'running',
      severity: 'info',
      initiator: 'user',
      title: 'Restarting api-gateway',
      text: 'Draining the first node',
      word: '',
      unread: false,
      attempt: 1,
      progress: { kind: 'determinate', fraction: 0, current: 0, total: 7, unit: 'items', a11y: { now: 0, text: '0 of 7 items' } },
    });
    expect(state.recent).toEqual([]);
    expect(state.counts).toMatchObject({ all: 1, active: 1, unread: 0 });
    expect(state.bell).toMatchObject({ unread: 0, active: 1, dot: '' });
    expect(state.toasts.items.map((item) => [item.id, item.sticky])).toEqual([['n1', true]]);
    expect(state.activity).toMatchObject({ count: 1, text: 'Restarting api-gateway' });
  });

  it('waits, queued, until it is started: the word and the reader say so', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Backing up vm-104', state: 'queued', progress: { current: 0, total: 40, unit: 'GiB' } });
    expect(store.getSnapshot().active[0]).toMatchObject({ state: 'queued', word: 'Queued', phase: 'Queued' });
    expect(store.getSnapshot().active[0]?.progress?.a11y.text).toBe('0 of 40 GiB, queued');
    expect(op.start()).toBe(true);
    expect(store.getSnapshot().active[0]).toMatchObject({ state: 'running', word: '' });
    expect(store.getSnapshot().active[0]?.startedAt).toBeDefined();
  });

  it('is of the system unless the producer says the user started it (S74)', () => {
    const { store } = makeNotices();
    store.begin({ title: 'Syncing connections' });
    store.begin({ title: 'Scaling cart-api', initiator: 'user' });
    expect(store.getSnapshot().active.map((record) => record.initiator).sort()).toEqual(['system', 'user']);
  });

  it('is stamped with the source of the producer that began it; a plugin cannot claim another', () => {
    const { store } = makeNotices();
    store.forSource('cloud').begin({ title: 'Syncing', source: 'stack' });
    expect(store.getSnapshot().active[0]).toMatchObject({ source: 'cloud', sourceName: 'Cloud' });
  });

  it('refuses a title it is not given, with a reason, and answers a handle that does nothing', () => {
    const { store } = makeNotices();
    const handle = store.begin({ title: '  ' });
    expect(handle.refused).not.toBe('');
    expect(handle).toMatchObject({ id: '', active: false, state: 'removed' });
    expect(handle.succeed()).toBe(false);
    expect(handle.update({ message: 'x' })).toBe(false);
    expect(handle.progress(5)).toBe(false);
    expect(store.getSnapshot().active).toEqual([]);
  });

  it('keeps a record of its fields, the live facts, at most four', () => {
    const { store } = makeNotices();
    store.begin({ title: 'Working', fields: [{ label: 'Updated', value: '3', unit: 'items' }, { label: 'B', value: 'b' }, { label: 'C', value: 'c' }, { label: 'D', value: 'd' }, { label: 'E', value: 'e' }] });
    expect(store.getSnapshot().active[0]?.fields).toHaveLength(4);
    expect(store.getSnapshot().active[0]?.fields[0]).toEqual({ label: 'Updated', value: '3', unit: 'items' });
  });
});

describe('progress', () => {
  it('is the producer\'s, a tick at a time: a partial update keeps the total and the unit', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Uploading', progress: { current: 0, total: 40, unit: 'GiB' } });
    expect(op.progress({ current: 10 })).toBe(true);
    expect(store.getSnapshot().active[0]?.progress).toMatchObject({ kind: 'determinate', current: 10, total: 40, unit: 'GiB', fraction: 0.25 });
    expect(op.update({ progress: { current: 30 }, message: 'Uploading chunks' })).toBe(true);
    expect(store.getSnapshot().active[0]).toMatchObject({ text: 'Uploading chunks', progress: { current: 30, fraction: 0.75 } });
  });

  it('is never invented: a tick on work with no progress changes nothing, and an unreadable value changes nothing', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Uploading' });
    expect(op.progress({ current: 5 })).toBe(false);
    expect(store.getSnapshot().active[0]?.progress).toBeUndefined();
    const sized = store.begin({ title: 'Sized', progress: { current: 1, total: 4 } });
    expect(sized.progress({ current: 2, total: 0 })).toBe(false);
    expect(sized.progress('indeterminate')).toBe(true);
    expect(store.getSnapshot().active.find((record) => record.id === sized.id)?.progress).toMatchObject({ kind: 'indeterminate', fraction: null });
  });

  it('counts steps from one, and the step names itself from the list (S134)', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Installing plugin cloud', initiator: 'user', progress: { kind: 'steps', current: 1, total: 3, steps: ['Resolve', 'Download', 'Verify'] } });
    expect(store.getSnapshot().active[0]).toMatchObject({ text: 'Resolve', progress: { kind: 'steps', current: 1, label: 'Resolve' } });
    expect(op.step(2)).toBe(true);
    expect(store.getSnapshot().active[0]).toMatchObject({ text: 'Download', progress: { current: 2, label: 'Download', fraction: 1 / 3 } });
    expect(op.step({ current: 3, label: 'Verify checksum' })).toBe(true);
    expect(store.getSnapshot().active[0]?.progress).toMatchObject({ current: 3, label: 'Verify checksum' });
  });

  it('changes nothing when it did not change: the same snapshot, nobody told', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Uploading', progress: { current: 5, total: 10 } });
    const before = store.getSnapshot();
    expect(op.progress({ current: 5 })).toBe(false);
    expect(store.getSnapshot()).toBe(before);
  });

  it('is not told to the live region: a tick is never announced (S86)', () => {
    const { store, said } = makeNotices();
    const op = store.begin({ title: 'Uploading', initiator: 'user', progress: { current: 0, total: 100 } });
    store.dismissToasts();
    said.length = 0;
    for (let tick = 1; tick <= 50; tick += 1) {
      op.progress({ current: tick });
    }

    expect(said).toEqual([]);
  });

  it('is kept by a finished record only as history: the view draws no bar for it', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Uploading', progress: { current: 5, total: 10 } });
    op.succeed();
    expect(store.getSnapshot().recent[0]?.progress).toBeUndefined();
    expect(op.progress({ current: 9 })).toBe(false);
  });
});

describe('the states (S74)', () => {
  it('goes queued, running, paused, running and ends once', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Working', state: 'queued' });
    expect(op.state).toBe('queued');
    expect(op.pause()).toBe(true);
    expect(op.state).toBe('paused');
    expect(store.getSnapshot().active[0]).toMatchObject({ word: 'Paused' });
    expect(op.resume()).toBe(true);
    expect(op.succeed()).toBe(true);
    expect(op.state).toBe('succeeded');
    expect(op.succeed()).toBe(false);
    expect(op.fail()).toBe(false);
    expect(op.cancel()).toBe(false);
    expect(op.start()).toBe(false);
  });

  it('ends as succeeded, failed, cancelled or unknown, and a finished record moves from the active to the recent list', () => {
    const { store } = makeNotices();
    const ok = store.begin({ title: 'A' });
    const bad = store.begin({ title: 'B' });
    const stopped = store.begin({ title: 'C' });
    const lost = store.begin({ title: 'D' });
    ok.succeed();
    bad.fail();
    stopped.cancel();
    lost.unknown();
    const state = store.getSnapshot();
    expect(state.active).toEqual([]);
    expect(state.recent.map((record) => [record.name, record.state, record.severity])).toEqual([['D', 'unknown', 'warning'], ['C', 'cancelled', 'info'], ['B', 'failed', 'error'], ['A', 'succeeded', 'success']]);
  });

  it('finishes with a sentence, an Error or a patch, and an Error\'s text is diagnostics, not chrome', () => {
    const { store } = makeNotices();
    const a = store.begin({ title: 'A' });
    const b = store.begin({ title: 'B' });
    const c = store.begin({ title: 'C' });
    a.fail('Nothing answered on port 9090. Check that it is running.');
    b.fail(new Error('connect ECONNREFUSED 10.0.0.1:9090'));
    c.succeed({ message: 'All 3 connections are open.', fields: [{ label: 'Open', value: '3' }] });
    const [recordC, recordB, recordA] = store.getSnapshot().recent;
    expect(recordA?.text).toBe('Nothing answered on port 9090. Check that it is running.');
    expect(recordB?.details).toContain('ECONNREFUSED');
    expect(recordB?.text).not.toContain('ECONNREFUSED');
    expect(recordC).toMatchObject({ text: 'All 3 connections are open.', fields: [{ label: 'Open', value: '3' }] });
  });

  it('refuses a state that is not an end: finish takes the four', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'A' });
    expect(op.finish('running' as never)).toBe(false);
    expect(op.active).toBe(true);
  });

  it('answers that it is removed once the user cleared it, and does nothing more', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'A' });
    op.succeed();
    store.clear();
    expect(op.state).toBe('removed');
    expect(op.restart()).toBe(false);
    expect(op.record).toBeUndefined();
  });
});

describe('the severity of work (S74)', () => {
  it('follows the state, and a producer may raise it and never lower it', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Importing' });
    expect(store.getSnapshot().active[0]?.severity).toBe('info');
    op.update({ severity: 'warning' });
    expect(store.getSnapshot().active[0]?.severity).toBe('warning');
    op.update({ severity: 'info' });
    expect(store.getSnapshot().active[0]?.severity).toBe('warning');
    op.succeed();
    expect(store.getSnapshot().recent[0]?.severity).toBe('warning');
  });

  it('is an error for a failure whatever the producer asked', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Importing', severity: 'info' });
    op.fail();
    expect(store.getSnapshot().recent[0]?.severity).toBe('error');
  });
});

describe('the words of a record, whoever draws it (OF3, X3)', () => {
  it('reads as what it did once it succeeded: the done title and the effect', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Scaling orders-api', doneTitle: 'Scaled orders-api', initiator: 'user' });
    op.succeed({ message: '3 replicas are ready' });
    expect(store.getSnapshot().recent[0]).toMatchObject({ title: 'Scaled orders-api', text: '3 replicas are ready', phase: 'Scaled orders-api. 3 replicas are ready' });
  });

  it('reads as what it could not do once it failed, with the cause, and no "Failed ·"', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Connecting to prod-db', initiator: 'user' });
    op.fail('Nothing answered on port 9090.');
    expect(store.getSnapshot().recent[0]).toMatchObject({ title: 'Couldn\'t connect to prod-db', name: 'Connecting to prod-db', phase: 'Couldn\'t connect to prod-db. Nothing answered on port 9090.' });
  });

  it('says an unknown outcome, and where to check, never as failed or done (S74)', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Reconnecting data source', initiator: 'user', target: 'Prometheus' });
    op.unknown();
    expect(store.getSnapshot().recent[0]).toMatchObject({ state: 'unknown', severity: 'warning', word: 'Outcome unknown.', text: 'Check Prometheus.', phase: 'Outcome unknown. Check Prometheus.' });
  });

  it('offers the object it produced, by its name, and never one it deleted', () => {
    const { store } = makeNotices();
    const route = { plugin: 'cloud', contribution: 'jobs', params: { id: 'nightly' } };
    const made = store.begin({ title: 'Running now', doneTitle: 'Started Job nightly', initiator: 'user', target: { label: 'Job nightly', kind: 'job', route } });
    const gone = store.begin({ title: 'Deleting', doneTitle: 'Deleted Job old', initiator: 'user', target: { label: 'Job old', kind: 'job', route: { plugin: 'cloud', contribution: 'jobs', params: { id: 'old' } }, removed: true } });
    made.succeed();
    gone.succeed();
    const [recordGone, recordMade] = store.getSnapshot().recent;
    expect(recordMade?.actions.map((action) => [action.kind, action.label])).toEqual([['open', 'Open Job nightly']]);
    expect(recordMade?.produced).toMatchObject({ label: 'Job nightly' });
    expect(recordGone?.actions).toEqual([]);
    expect(recordGone?.produced).toBeUndefined();
  });
});

describe('the result of work, as the notice it leaves (S77, S78, S81, S81a, OF1, OF4)', () => {
  it('is a toast that closes by itself, and an unread record, for work the user started and is not looking at', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Scaling orders-api', doneTitle: 'Scaled orders-api', initiator: 'user' });
    op.succeed();
    const state = store.getSnapshot();
    expect(state.toasts.items.map((item) => [item.id, item.sticky])).toEqual([['n1', false]]);
    expect(state.recent[0]).toMatchObject({ read: false, unread: true, toasted: true });
    expect(state.bell).toMatchObject({ dot: 'info', unread: 1 });
  });

  it('is read history, with no toast and no bell, for a calm outcome of work the system started (S81a)', () => {
    const { store, said } = makeNotices();
    store.begin({ title: 'Syncing connections' }).succeed();
    store.begin({ title: 'Refreshing' }).cancel();
    const state = store.getSnapshot();
    expect(state.recent.map((record) => [record.state, record.read, record.unread, record.toasted])).toEqual([['cancelled', true, false, false], ['succeeded', true, false, false]]);
    expect(state.toasts.items).toEqual([]);
    expect(state.bell.dot).toBe('');
    expect(said).toEqual([]);
  });

  it('is a toast and an unread record for the failure of work the system started: it needs the person', () => {
    const { store } = makeNotices();
    store.begin({ title: 'Syncing connections' }).fail('Nothing answered.');
    expect(store.getSnapshot().recent[0]).toMatchObject({ unread: true, severity: 'error' });
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
  });

  it('is shown by its own control when that is on screen: read, no toast, for a calm outcome (S76, S77, S81a)', () => {
    const { store, inline } = makeNotices();
    inline.add('scale-button');
    const op = store.begin({ title: 'Scaling orders-api', initiator: 'user', origin: { tab: 't1', anchor: 'scale-button' } });
    expect(store.getSnapshot().toasts.items).toEqual([]);
    op.succeed();
    const state = store.getSnapshot();
    expect(state.recent[0]).toMatchObject({ read: true, unread: false, toasted: false });
    expect(state.toasts.items).toEqual([]);
  });

  it('is shown by its own control, and kept unread, for a failure: errors are not silently reclassified (S81a)', () => {
    const { store, inline } = makeNotices();
    inline.add('scale-button');
    const op = store.begin({ title: 'Scaling orders-api', initiator: 'user', origin: { tab: 't1', anchor: 'scale-button' } });
    op.fail('Sample request was rejected. Review the input.');
    const state = store.getSnapshot();
    expect(state.recent[0]).toMatchObject({ state: 'failed', read: false, unread: true, toasted: false });
    expect(state.toasts.items).toEqual([]);
    expect(state.bell.dot).toBe('error');
  });

  it('is a toast and an unread record when the control is not on screen: the user has moved away (S76)', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Scaling orders-api', initiator: 'user', origin: { tab: 't1', anchor: 'scale-button' } });
    op.fail('Sample request was rejected. Review the input.');
    const state = store.getSnapshot();
    expect(state.recent[0]).toMatchObject({ read: false, toasted: true });
    expect(state.toasts.items.map((item) => item.id)).toEqual([op.id]);
  });

  it('stays unread when the outcome is a warning raised above success', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Importing', initiator: 'system', severity: 'warning' });
    op.succeed();
    expect(store.getSnapshot().recent[0]).toMatchObject({ read: false, unread: true, severity: 'warning' });
  });

  it('is told to the live region, once at the start and once at the finish, when there is no toast (S86)', () => {
    const { store, said, inline } = makeNotices();
    inline.add('scale-button');
    const op = store.begin({ title: 'Scaling orders-api', doneTitle: 'Scaled orders-api', initiator: 'user', origin: { anchor: 'scale-button' } });
    expect(said).toEqual([{ text: 'Scaling orders-api', urgent: false }]);
    op.update({ progress: 'indeterminate', message: 'Working' });
    op.succeed({ message: '3 replicas are ready' });
    expect(said).toEqual([{ text: 'Scaling orders-api', urgent: false }, { text: 'Scaled orders-api', urgent: false }]);
  });

  it('interrupts only for the error of work the user started and has no toast to show', () => {
    const { store, said, inline } = makeNotices();
    inline.add('b');
    store.begin({ title: 'Scaling orders-api', initiator: 'user', origin: { anchor: 'b' } }).fail('No.');
    expect(said.at(-1)).toMatchObject({ text: 'Couldn\'t scale orders-api. No.', urgent: true });
  });

  it('says nothing of work the system started while it runs, nor of its calm end (S86a)', () => {
    const { store, said } = makeNotices();
    const op = store.begin({ title: 'Syncing connections' });
    op.progress('indeterminate');
    op.succeed();
    expect(said).toEqual([]);
  });

  it('says nothing for a toast: it announces itself, in the stack', () => {
    const { store, said } = makeNotices();
    store.begin({ title: 'Scaling orders-api', initiator: 'user' }).succeed();
    expect(said).toEqual([]);
  });
});

describe('cancel is a callback that may be absent (S84)', () => {
  it('is not offered when there is none: no Cancel, and nothing claims it can stop', () => {
    const { store } = makeNotices();
    store.begin({ title: 'Reading the disk' });
    expect(store.getSnapshot().active[0]).toMatchObject({ cancellation: 'unsupported', actions: [] });
    expect(store.getSnapshot().activity.cancel).toBeUndefined();
  });

  it('is offered when the producer can: a Cancel, in the record and beside the status widget', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Backing up vm-104', onCancel: () => undefined });
    expect(store.getSnapshot().active[0]?.actions.map((action) => [action.id, action.kind, action.label, action.disabled])).toEqual([['cancel', 'cancel', 'Cancel', '']]);
    expect(store.getSnapshot().activity.cancel).toEqual({ id: op.id, label: 'Cancel', disabled: '' });
  });

  it('can be declared after the work began, and by saying so', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'A' });
    op.onCancel(() => undefined);
    expect(store.getSnapshot().active[0]?.cancellation).toBe('available');
    const declared = store.begin({ title: 'B', cancellation: 'available' });
    expect(declared.record?.cancellation).toBe('available');
  });

  it('says Canceling… until the producer acknowledges, calls the callback once, and never claims a rollback', () => {
    const { store } = makeNotices();
    let calls = 0;
    const op = store.begin({ title: 'Backing up vm-104', initiator: 'user', onCancel: () => {
      calls += 1;
    } });
    expect(store.run(op.id, 'cancel')).toEqual({ status: 'done' });
    expect(calls).toBe(1);
    const asked = store.getSnapshot().active[0];
    expect(asked).toMatchObject({ cancellation: 'requested', word: 'Canceling…' });
    expect(asked?.actions[0]).toMatchObject({ label: 'Canceling…' });
    expect(asked?.actions[0]?.disabled).toContain('Effects are not undone');
    expect(store.run(op.id, 'cancel')).toMatchObject({ status: 'refused', reason: 'disabled' });
    expect(calls).toBe(1);
    expect(op.acknowledgeCancel()).toBe(true);
    expect(store.getSnapshot().active[0]?.cancellation).toBe('acknowledged');
    expect(op.acknowledgeCancel()).toBe(false);
    op.cancel({ message: 'Stopped after 20 of 40 GiB. The partial backup was kept.' });
    expect(store.getSnapshot().recent[0]).toMatchObject({ state: 'cancelled', word: 'Canceled', text: 'Stopped after 20 of 40 GiB. The partial backup was kept.' });
  });

  it('puts the button back when the callback says it did not stop (false), throws, or rejects, and says the work still runs', async () => {
    const { store, clock, errors } = makeNotices();
    const refusing = store.begin({ title: 'A', onCancel: () => false });
    const throwing = store.begin({ title: 'B', onCancel: () => {
      throw new Error('no');
    } });
    const rejecting = store.begin({ title: 'C', onCancel: async () => Promise.reject(new Error('no')) });
    const resolvingFalse = store.begin({ title: 'D', onCancel: async () => Promise.resolve(false) });
    for (const op of [refusing, throwing, rejecting, resolvingFalse]) {
      store.run(op.id, 'cancel');
    }

    await clock.flush();
    for (const op of [refusing, throwing, rejecting, resolvingFalse]) {
      expect(op.record).toMatchObject({ cancellation: 'available', text: 'Couldn\'t cancel. The work is still running.' });
      expect(op.record?.actions[0]).toMatchObject({ label: 'Cancel', disabled: '' });
    }

    // The one that throws and the one that rejects are failures of the producer's code and are told to the host's hook; one that answers false is an answer.
    expect(errors.filter((entry) => entry.where.includes('onCancel'))).toHaveLength(2);
  });

  it('lets a producer relabel it Stop, and disable it with its reason while it cannot be undone (S134)', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Forwarding api-gateway', initiator: 'user', onCancel: () => undefined, actions: [{ kind: 'cancel', label: 'Stop' }] });
    expect(store.getSnapshot().active[0]?.actions[0]).toMatchObject({ label: 'Stop' });
    op.update({ actions: [{ kind: 'cancel', label: 'Cancel', disabled: 'Can\'t cancel while files are replaced' }] });
    expect(store.getSnapshot().active[0]?.actions[0]).toMatchObject({ label: 'Cancel', disabled: 'Can\'t cancel while files are replaced' });
    expect(store.run(op.id, 'cancel')).toMatchObject({ status: 'refused', reason: 'disabled', message: 'Can\'t cancel while files are replaced' });
  });

  it('says Stopping… for a Stop', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Forwarding api-gateway', onCancel: () => undefined, actions: [{ kind: 'cancel', label: 'Stop forwarding' }] });
    store.run(op.id, 'cancel');
    expect(store.getSnapshot().active[0]).toMatchObject({ word: 'Stopping…' });
  });
});

describe('Retry is the same record again (S74; QA-SF-03: the attempts 2 and 3)', () => {
  it('starts it over: running, attempt 2, its progress at zero, its place in the history kept', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Reconnecting data source', initiator: 'user', progress: { current: 0, total: 3, unit: 'items' }, onRetry: () => undefined });
    op.progress({ current: 2 });
    op.fail('Nothing answered on port 9090.');
    expect(store.getSnapshot().recent[0]?.actions.map((action) => [action.id, action.variant, action.disabled])).toEqual([['retry', 'primary', '']]);
    expect(op.restart('Opening 3 connections')).toBe(true);
    expect(store.getSnapshot().recent).toEqual([]);
    expect(store.getSnapshot().active[0]).toMatchObject({ id: op.id, state: 'running', attempt: 2, word: 'Attempt 2', text: 'Opening 3 connections', progress: { current: 0, fraction: 0 }, unread: false });
    expect(store.getSnapshot().active[0]?.finishedAt).toBeUndefined();
  });

  it('fails twice and works the third time, as one record that counts its attempts', () => {
    const { store } = makeNotices();
    let attempts = 0;
    const op = store.begin({ title: 'Reconnecting data source', doneTitle: 'Reconnected data source', initiator: 'user', onRetry: () => {
      attempts += 1;
      op.restart();
      if (attempts < 2) {
        op.fail('Nothing answered.');
      } else {
        op.succeed({ message: 'All 3 connections are open.' });
      }
    } });
    op.fail('Nothing answered.');
    expect(store.run(op.id, 'retry')).toEqual({ status: 'done' });
    expect(store.getSnapshot().recent[0]).toMatchObject({ id: op.id, state: 'failed', attempt: 2 });
    expect(store.run(op.id, 'retry')).toEqual({ status: 'done' });
    expect(store.getSnapshot().recent[0]).toMatchObject({ id: op.id, state: 'succeeded', attempt: 3, title: 'Reconnected data source' });
    expect(store.getSnapshot().recent).toHaveLength(1);
  });

  it('says Retrying once, even while its toast stays', () => {
    const { store, said } = makeNotices();
    const op = store.begin({ title: 'Reconnecting data source', initiator: 'user', onRetry: () => undefined });
    op.fail('Nothing answered.');
    said.length = 0;
    op.restart();
    expect(said).toEqual([{ text: 'Retrying: Reconnecting data source', urgent: false }]);
  });

  it('keeps the toast of a record that started over, and puts back one the user dismissed', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Reconnecting data source', initiator: 'user', onRetry: () => undefined });
    op.fail('Nothing answered.');
    op.dismiss();
    expect(store.getSnapshot().toasts.items).toEqual([]);
    op.restart();
    expect(store.getSnapshot().toasts.items.map((item) => item.id)).toEqual([op.id]);
  });

  it('retires the toast of a record whose producer began a new one instead (one presenter)', () => {
    const { store } = makeNotices();
    const old = store.begin({ title: 'Reconnecting data source', initiator: 'user', onRetry: () => {
      store.begin({ title: 'Reconnecting data source', initiator: 'user' });
    } });
    old.fail('Nothing answered.');
    store.run(old.id, 'retry');
    expect(store.getSnapshot().toasts.items.map((item) => item.id)).not.toContain(old.id);
    expect(store.getSnapshot().recent.find((record) => record.id === old.id)).toMatchObject({ read: true });
  });

  it('restarts what failed, was lost or was stopped, and nothing else', () => {
    const { store } = makeNotices();
    const failed = store.begin({ title: 'A' });
    const lost = store.begin({ title: 'B' });
    const stopped = store.begin({ title: 'C' });
    const done = store.begin({ title: 'D' });
    const running = store.begin({ title: 'E' });
    failed.fail();
    lost.unknown();
    stopped.cancel();
    done.succeed();
    expect([failed.restart(), lost.restart(), stopped.restart(), done.restart(), running.restart()]).toEqual([true, true, true, false, false]);
  });

  it('forgets what the producer asked of the severity: a record that started over is not an error', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'A', severity: 'warning' });
    op.fail();
    op.restart();
    expect(store.getSnapshot().active[0]?.severity).toBe('info');
  });

  it('refuses a Retry whose callback is gone: it is shown disabled, with the reason, never a dead button', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'A', initiator: 'user', actions: [{ kind: 'retry' }] });
    op.fail();
    const retry = store.getSnapshot().recent[0]?.actions[0];
    expect(retry).toMatchObject({ id: 'retry', disabled: 'Not available after restart' });
    expect(store.run(op.id, 'retry')).toMatchObject({ status: 'refused', reason: 'disabled' });
  });
});

describe('many operations at once (S94, ch05 177)', () => {
  it('counts three hundred as one summary, and draws no Cancel and no bar for them', () => {
    const { store } = makeNotices();
    for (let index = 0; index < 300; index += 1) {
      store.forSource(`p${String(index % 6)}`).begin({ title: `Task ${String(index)}`, onCancel: () => undefined });
    }

    const state = store.getSnapshot();
    expect(state.active).toHaveLength(300);
    expect(state.activity).toMatchObject({ count: 300, running: 300, text: '300 operations', cancel: undefined, bar: undefined });
    expect(state.counts).toMatchObject({ all: 300, active: 300 });
  });

  it('draws a bar for several only when they count the same unit, as their sum', () => {
    const { store } = makeNotices();
    const a = store.begin({ title: 'A', progress: { current: 2, total: 10, unit: 'items' } });
    store.begin({ title: 'B', progress: { current: 4, total: 10, unit: 'items' } });
    expect(store.getSnapshot().activity.bar).toMatchObject({ kind: 'determinate', fraction: 0.3, text: '6 of 20 items' });
    store.begin({ title: 'C', progress: { current: 1, total: 2, unit: 'files' } });
    expect(store.getSnapshot().activity.bar).toBeUndefined();
    a.succeed();
  });

  it('goes back to the one operation\'s own words when it is the only one left', () => {
    const { store } = makeNotices();
    const a = store.begin({ title: 'Restarting api-gateway' });
    const b = store.begin({ title: 'Syncing connections' });
    expect(store.getSnapshot().activity.text).toBe('2 operations');
    a.succeed();
    expect(store.getSnapshot().activity).toMatchObject({ count: 1, text: 'Syncing connections' });
    b.succeed();
    expect(store.getSnapshot().activity).toMatchObject({ count: 0, text: 'Operations', tooltip: 'Nothing is running' });
  });

  it('lists what runs first, then what is paused, then what waits, the newest first in each', () => {
    const { store } = makeNotices();
    const a = store.begin({ title: 'A' });
    const b = store.begin({ title: 'B', state: 'queued' });
    const c = store.begin({ title: 'C' });
    c.pause();
    const d = store.begin({ title: 'D' });
    expect(store.getSnapshot().active.map((record) => record.id)).toEqual([d.id, a.id, c.id, b.id]);
  });

  it('says the worst severity that runs (ch05 167)', () => {
    const { store } = makeNotices();
    store.begin({ title: 'A' });
    const b = store.begin({ title: 'B' });
    expect(store.getSnapshot().activity.worst).toBe('info');
    b.update({ severity: 'warning' });
    expect(store.getSnapshot().activity.worst).toBe('warning');
  });

  it('keeps a source from starting more than it should: past its limit the work is refused, and the source is told it is flooding', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    const handles = Array.from({ length: LIMITS.activePerSource + 5 }, (_, index) => producer.begin({ title: `Task ${String(index)}` }));
    expect(handles.filter((handle) => handle.refused === '')).toHaveLength(LIMITS.activePerSource);
    expect(handles.slice(LIMITS.activePerSource).every((handle) => handle.refused !== '' && handle.id === '' && !handle.active)).toBe(true);
    expect(store.getSnapshot().active).toHaveLength(LIMITS.activePerSource);
    expect(store.getSnapshot().recent[0]).toMatchObject({ title: 'Cloud is posting many notifications' });
    expect(store.stats().limited).toBe(5);
    expect(store.forSource('stack').begin({ title: 'Fine' }).refused).toBe('');
  });

  it('lets a source start again when its work ends', () => {
    const { store } = makeNotices();
    const producer = store.forSource('cloud');
    const handles = Array.from({ length: LIMITS.activePerSource }, (_, index) => producer.begin({ title: `Task ${String(index)}` }));
    expect(producer.begin({ title: 'Over' }).refused).not.toBe('');
    handles[0]?.succeed();
    expect(producer.begin({ title: 'Again' }).refused).toBe('');
  });

  it('keeps the whole window to a thousand running at once', () => {
    const { store } = makeNotices();
    const handles = Array.from({ length: LIMITS.active + 10 }, (_, index) => store.forSource(`p${String(index % 6)}`).begin({ title: `Task ${String(index)}` }));
    expect(handles.filter((handle) => handle.refused === '')).toHaveLength(LIMITS.active);
    expect(store.getSnapshot().active).toHaveLength(LIMITS.active);
  });
});

describe('what a producer can do after it is done', () => {
  it('nothing more: every method answers false for a record that ended', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'A' });
    op.succeed();
    expect([op.update({ message: 'x' }), op.progress(5), op.step(2), op.pause(), op.resume(), op.start()]).toEqual([false, false, false, false, false, false]);
    expect(op.record?.state).toBe('succeeded');
  });

  it('is told a message it gave the record while it ran stays', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'A', message: 'Working' });
    op.succeed();
    expect(store.getSnapshot().recent[0]?.text).toBe('Working');
  });
});

describe('time', () => {
  it('stamps when work began, ended and last changed', async () => {
    const { store, clock } = makeNotices();
    const op = store.begin({ title: 'A' });
    const began = clock.now();
    await clock.advance(5 * second);
    op.progress('indeterminate');
    await clock.advance(5 * second);
    op.succeed();
    expect(store.getSnapshot().recent[0]).toMatchObject({ createdAt: began, startedAt: began, finishedAt: began + (10 * second), updatedAt: began + (10 * second) });
  });

  it('puts the toast of a user\'s success out after seven seconds, in the clock the host gave', async () => {
    const { store, clock } = makeNotices();
    store.begin({ title: 'A', initiator: 'user' }).succeed();
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
    await clock.advance(TIMING.toast - 1);
    expect(store.getSnapshot().toasts.items).toHaveLength(1);
    await clock.advance(2);
    expect(store.getSnapshot().toasts.items).toEqual([]);
    expect(store.getSnapshot().recent[0]?.unread).toBe(true);
  });
});
