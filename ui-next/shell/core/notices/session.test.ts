import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreNotices } from './persist';
import { createNoticesSaver, type Saver } from './saver';
import { createNoticesStore } from './store';
import { makeNotices, manualClock, START, type Fixture } from './testing';
import { LIMITS, NOTICES_VERSION } from './types';

// The history survives a restart, and the saving is one write for a burst (docs/ui-next/optimisations.md HSH-25: the old shell lost the last state when the window closed). The mock persists the
// records (at most 200, 7 days), the mutes, and brings work that was running back as unknown (ch16 S74, S82). What cannot survive is not saved: the code of an action, a toast, the progress.

const route = { plugin: 'cloud', contribution: 'instances', params: { id: 'i-1' } };

describe('serialise', () => {
  it('writes the version first, the records newest first, and the mutes', () => {
    const { store, clock } = makeNotices();
    store.forSource('cloud').notify({ title: 'A', severity: 'warning', actions: [{ id: 'go', label: 'Open it', route }] });
    store.notify({ title: 'B' });
    store.mute('cloud', clock.now() + TIMING_HOUR);
    const written = store.serialise();
    expect(Object.keys(written)).toEqual(['version', 'records', 'muted']);
    expect(written.version).toBe(NOTICES_VERSION);
    expect(written.records.map((record) => record.title)).toEqual(['B', 'A']);
    expect(written.muted).toEqual({ cloud: clock.now() + TIMING_HOUR });
  });

  it('is plain JSON', () => {
    const { store } = makeNotices();
    store.begin({ title: 'Working', initiator: 'user', onCancel: () => undefined, actions: [{ id: 'x', label: 'X', run: () => undefined }] });
    store.notify({ title: 'A', details: 'diagnostics', actions: [{ id: 'go', route }] });
    expect(JSON.parse(JSON.stringify(store.serialise()))).toEqual(store.serialise());
  });

  it('writes the work that is running, once, as what it is: not what it says now, so a tick or a new phase is not a change to save', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Uploading', initiator: 'user', progress: { current: 0, total: 10 }, message: 'Starting' });
    const first = JSON.stringify(store.serialise());
    op.progress({ current: 5 });
    op.update({ message: 'Halfway', fields: [{ label: 'Sent', value: '5' }] });
    expect(JSON.stringify(store.serialise())).toBe(first);
  });

  it('keeps diagnostics to what is saved of them', () => {
    const { store } = makeNotices();
    store.notify({ title: 'A', details: 'x'.repeat(8000) });
    expect(store.serialise().records[0]?.details).toHaveLength(LIMITS.storedDetails);
  });

  it('writes the severity a producer raised, so a record is never quieter after a restart', () => {
    const { store } = makeNotices();
    const op = store.begin({ title: 'Importing', initiator: 'user', severity: 'warning' });
    op.succeed();
    const restored = restoreNotices(JSON.parse(JSON.stringify(store.serialise())), { now: START });
    expect(restored.ok && restored.records[0]).toMatchObject({ state: 'succeeded', severity: 'warning', raised: 'warning' });
  });
});

const TIMING_HOUR = 3_600_000;

describe('the way back', () => {
  const restart = (writer: Fixture, ago = 0): Fixture => {
    const raw: unknown = JSON.parse(JSON.stringify(writer.store.serialise()));
    const clock = manualClock(writer.clock.now() + ago);
    const result = restoreNotices(raw, { now: clock.now() });
    expect(result.ok).toBe(true);
    return makeNotices({ initial: result.ok ? { records: result.records, muted: result.muted } : undefined }, clock);
  };

  it('brings the history back in its order, as it was left, read or not, with no toast and no announcement: a restored record was seen before', () => {
    const before = makeNotices();
    before.store.forSource('cloud').notify({ title: 'First', severity: 'warning' });
    before.store.forSource('stack').notify({ title: 'Second', severity: 'error' });
    before.store.read('n1');
    const after = restart(before);
    const state = after.store.getSnapshot();
    expect(state.recent.map((record) => [record.id, record.name, record.read, record.unread])).toEqual([['n2', 'Second', false, true], ['n1', 'First', true, false]]);
    expect(state.toasts.items).toEqual([]);
    expect(after.said).toEqual([]);
    expect(state.bell).toMatchObject({ dot: 'error', unread: 1 });
  });

  it('brings work that was running back as unknown, unread, and says where to check (S74)', () => {
    const before = makeNotices();
    before.store.begin({ title: 'Installing plugin cloud', initiator: 'user', target: 'cloud', progress: { current: 3, total: 9 }, onCancel: () => undefined, message: 'Download' });
    const after = restart(before, 5000);
    const state = after.store.getSnapshot();
    expect(state.active).toEqual([]);
    expect(state.recent[0]).toMatchObject({ state: 'unknown', severity: 'warning', unread: true, word: 'Outcome unknown.', cancellation: 'unsupported', progress: undefined });
    expect(state.recent[0]?.text).toContain('Check cloud.');
    expect(state.toasts.items).toEqual([]);
    expect(state.recent[0]?.actions).toEqual([]);
  });

  it('continues the numbering: a new notice never takes the id of one that came back', () => {
    const before = makeNotices();
    for (let index = 0; index < 5; index += 1) {
      before.store.forSource(`p${String(index)}`).notify({ title: `Notice ${String(index)}` });
    }

    const after = restart(before);
    expect(after.store.notify({ title: 'New' }).id).toBe('n6');
  });

  it('shows what needs code as disabled with its reason, and what is data as it was: a restored Retry is never a dead button (S84)', () => {
    const before = makeNotices();
    const op = before.store.begin({ title: 'Reconnecting', initiator: 'user', onRetry: () => undefined, actions: [{ id: 'logs', label: 'Open logs', run: () => undefined }, { id: 'go', label: 'Open instance', route }] });
    op.fail('Nothing answered.');
    const after = restart(before);
    const actions = after.store.getSnapshot().recent[0]?.actions ?? [];
    expect(Object.fromEntries(actions.map((action) => [action.id, action.disabled]))).toEqual({ retry: 'Not available after restart', logs: 'Not available after restart', go: '' });
    expect(after.store.run('n1', 'logs')).toMatchObject({ status: 'refused', reason: 'disabled' });
    expect(after.store.run('n1', 'go')).toMatchObject({ status: 'done' });
    expect(after.opened).toHaveLength(1);
  });

  it('keeps the model\'s own Mute on the row of a source that posts too much: it needs no code', () => {
    const before = makeNotices();
    for (let index = 0; index < 8; index += 1) {
      before.store.forSource('cloud').notify({ title: `Notice ${String(index)}` });
    }

    const after = restart(before);
    const row = after.store.getSnapshot().recent[0];
    expect(row).toMatchObject({ title: 'Cloud is posting many notifications' });
    expect(row?.actions[0]).toMatchObject({ id: 'mute', disabled: '' });
    expect(after.store.run(row?.id ?? '', 'mute')).toEqual({ status: 'done' });
    expect(after.store.getSnapshot().muted).toHaveLength(1);
  });

  it('keeps the mutes that have not ended, and not the ones that have', () => {
    const before = makeNotices();
    before.store.mute('cloud', before.clock.now() + 60_000);
    before.store.mute('stack', before.clock.now() + 10 * 60_000);
    before.store.mute('widgets', 'forever');
    const after = restart(before, 2 * 60_000);
    expect(after.store.getSnapshot().muted.map((entry) => [entry.source, entry.until === 'forever' ? 'forever' : 'time'])).toEqual([['stack', 'time'], ['widgets', 'forever']]);
  });

  it('lets a record go that is older than the history keeps, and keeps what the host chose to keep', () => {
    const before = makeNotices();
    before.store.notify({ title: 'Old' });
    const after = restart(before, LIMITS.age + 1000);
    expect(after.store.getSnapshot().recent).toEqual([]);
  });

  it('is bounded at the history, whatever the document held', () => {
    const records = Array.from({ length: 600 }, (_, index) => ({
      id: `n${String(index + 1)}`, kind: 'message', source: 'cloud', initiator: 'system', severity: 'info', state: 'succeeded', title: `Notice ${String(index)}`, doneTitle: '', detail: '', details: '', fields: [], actions: [], count: 1, fold: '', attempt: 1,
      createdAt: START - index, updatedAt: START - index, finishedAt: START - index, read: false,
    }));
    const result = restoreNotices({ version: NOTICES_VERSION, records, muted: {} }, { now: START });
    const store = createNoticesStore({ scheduler: manualClock().scheduler, initial: result.ok ? { records: result.records, muted: result.muted } : undefined });
    expect(store.getSnapshot().recent).toHaveLength(500);
    const small = createNoticesStore({ scheduler: manualClock().scheduler, history: { max: 10 }, initial: result.ok ? { records: result.records, muted: result.muted } : undefined });
    expect(small.getSnapshot().recent).toHaveLength(10);
  });

  it('starts empty from nothing', () => {
    const { store } = makeNotices({ initial: undefined });
    expect(store.getSnapshot().recent).toEqual([]);
  });
});

describe('the saver: one write for a burst', () => {
  // The shell's saver runs on the platform's timers: these tests drive them, and the clock the model reads, with fake ones.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const saver = (): Fixture & { readonly writes: unknown[]; readonly handle: Saver } => {
    const fixture = makeNotices({ scheduler: undefined });
    const writes: unknown[] = [];
    const handle = createNoticesSaver({ store: fixture.store, write: (value) => {
      writes.push(value);
    } });
    return { ...fixture, writes, handle };
  };

  it('writes once, 400 ms after the last change, for ten changes', async () => {
    const { store, writes } = saver();
    for (let index = 0; index < 10; index += 1) {
      store.forSource(`p${String(index)}`).notify({ title: `Notice ${String(index)}` });
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toHaveLength(1);
  });

  it('writes nothing for what is not saved: a tick of progress, a new phase, a toast that closes', async () => {
    const { store, writes } = saver();
    const op = store.begin({ title: 'Uploading', initiator: 'user', progress: { current: 0, total: 100 }, message: 'Starting' });
    await vi.advanceTimersByTimeAsync(1000);
    const before = writes.length;
    for (let tick = 1; tick <= 50; tick += 1) {
      op.progress({ current: tick });
      op.update({ message: `Chunk ${String(tick)}` });
      await vi.advanceTimersByTimeAsync(100);
    }

    await vi.advanceTimersByTimeAsync(2000);
    expect(writes.length).toBe(before);
  });

  it('writes the document in the shape the model restores', async () => {
    const { store, writes } = saver();
    store.notify({ title: 'A' });
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toHaveLength(1);
    expect(restoreNotices(writes[0], { now: Date.now() })).toMatchObject({ ok: true, records: [{ title: 'A' }] });
    expect(store.serialise()).toEqual(writes[0]);
  });

  it('writes at once what is pending when asked: the window is closing', () => {
    const { store, handle, writes } = saver();
    store.notify({ title: 'A' });
    handle.flush();
    expect(writes).toHaveLength(1);
    handle.flush();
    expect(writes).toHaveLength(1);
  });

  it('stops when it is disposed', async () => {
    const { store, handle, writes } = saver();
    handle.dispose();
    store.notify({ title: 'A' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toHaveLength(0);
  });
});
