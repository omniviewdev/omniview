import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostRecord, HostSourceViewEvent, HostSourceViewRequest } from './host';

const mocks = vi.hoisted(() => ({
  on: vi.fn(), off: vi.fn(), open: vi.fn(), sync: vi.fn(), refresh: vi.fn(), close: vi.fn(),
}));
vi.mock('@wailsio/runtime', async importOriginal => ({ ...(await importOriginal<object>()), Events: { On: mocks.on } }));
vi.mock('./client', () => ({
  OpenSourceView: mocks.open, SyncSourceView: mocks.sync,
  RefreshSourceView: mocks.refresh, CloseSourceView: mocks.close,
}));
import { openSourceView } from './sourceView';
import { setFrontendSpanRecorder, type FrontendSpanRecorder } from '../../telemetry/frontendSpans';

const request = { targetId: 'target', target: {}, updates: 'ifSupported' } as HostSourceViewRequest;
const status = { state: 'following', mode: 'snapshotAndUpdates', count: { kind: 'exact', value: '1' } } as const;
const record = (key: string) => ({ key }) as HostRecord;
let emit: (event: { data: HostSourceViewEvent }) => void;
let frame: FrameRequestCallback | undefined;
const event = (generation: string, sequence: string, kind: HostSourceViewEvent['kind'], extra: Partial<HostSourceViewEvent> = {}) => {
  emit({ data: { viewId: 'view', viewGeneration: generation, sequence, kind, ...extra } });
};

beforeEach(() => {
  vi.clearAllMocks();
  frame = undefined;
  mocks.open.mockResolvedValue({ viewId: 'view', topic: 'topic', mode: 'snapshotAndUpdates' });
  mocks.sync.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.on.mockImplementation((_topic, callback) => { emit = callback; return mocks.off; });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('source view spans', () => {
  afterEach(() => setFrontendSpanRecorder(null));
  it('records the initial snapshot and a sequence-gap resync with record counts', async () => {
    const records: Parameters<FrontendSpanRecorder>[] = [];
    setFrontendSpanRecorder((...args) => records.push(args));
    await openSourceView('plugin', { ...request, target: { type: 'core::v1::Pod' } } as HostSourceViewRequest);
    event('one', '1', 'snapshot', { records: [record('a')] });
    event('one', '2', 'snapshotEnd', { status });
    expect(records[0][1]).toMatchObject({ mode: 'snapshot', reason: 'initial', records: 1, plugin_id: 'plugin', resource_type: 'core::v1::Pod', outcome: 'success' });
    event('one', '9', 'changes', { upserts: [record('b')] });
    event('two', '1', 'snapshot', { records: [record('a')] });
    event('two', '2', 'snapshotEnd', { status });
    expect(records[1][1]).toMatchObject({ mode: 'resync', reason: 'sequence_gap', attempt: 1, records: 1, outcome: 'success' });
  });

  it('records a failed open without the error text', async () => {
    const records: Parameters<FrontendSpanRecorder>[] = [];
    setFrontendSpanRecorder((...args) => records.push(args));
    mocks.open.mockRejectedValue({ code: 'UNAVAILABLE', title: 't', message: 'token=abc123' });
    await expect(openSourceView('plugin', request)).rejects.toBeDefined();
    expect(records[0][1]).toMatchObject({ mode: 'snapshot', reason: 'initial', outcome: 'failure', error_class: 'UNAVAILABLE' });
    expect(JSON.stringify(records)).not.toContain('abc123');
  });
});

describe('source views', () => {
  it('attaches before sync and atomically swaps staged snapshots', async () => {
    const view = await openSourceView('plugin', request);
    expect(mocks.on.mock.invocationCallOrder[0]).toBeLessThan(mocks.sync.mock.invocationCallOrder[0]);
    const listener = vi.fn();
    view.subscribe(listener);
    event('one', '1', 'snapshot', { records: [record('a')] });
    expect(view.getSnapshot().records.size).toBe(0);
    event('one', '2', 'snapshotEnd', { status });
    expect([...view.getSnapshot().records.keys()]).toEqual(['a']);
    expect(view.getSnapshot().complete).toBe(true);
    event('one', '3', 'changes', { upserts: [record('b')], removes: [{ key: 'a', addressKey: 'a' }] });
    expect([...view.getSnapshot().records.keys()]).toEqual(['b']);
    expect(view.getSnapshot().event?.kind).toBe('changes');
    expect(listener).not.toHaveBeenCalled();
    frame?.(0);
    expect(listener).toHaveBeenCalledTimes(1);
    view.close();
  });

  it('issues one resync per gap and caps repeated failed generations', async () => {
    vi.useFakeTimers();
    const view = await openSourceView('plugin', request);
    event('one', '1', 'snapshotEnd', { status });
    event('one', '3', 'changes');
    event('one', '4', 'changes');
    event('other', '2', 'changes');
    event('other', '3', 'status', { status });
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(view.getSnapshot().status?.state).toBe('following');
    event('two', '1', 'snapshotEnd', { status });
    event('two', '3', 'changes');
    event('three', '1', 'snapshotEnd', { status });
    event('three', '3', 'changes');
    expect(mocks.sync).toHaveBeenCalledTimes(4);
    event('four', '1', 'snapshotEnd', { status });
    event('four', '3', 'changes');
    expect(mocks.sync).toHaveBeenCalledTimes(4);
    expect(view.getSnapshot().status?.state).toBe('failed');
    expect(view.getSnapshot().status?.error?.message).toContain('contiguous');
    view.close();
  });

  it('ignores the triggering unknown generation until a fresh generation arrives', async () => {
    const view = await openSourceView('plugin', request);
    event('one', '1', 'snapshotEnd', { status });
    event('stray', '1', 'snapshot', { records: [record('stray')] });
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    event('stray', '1', 'snapshotEnd', { status });
    event('one', '2', 'changes', { upserts: [record('old')] });
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(view.getSnapshot().viewGeneration).toBe('one');
    event('two', '1', 'snapshotEnd', { status });
    expect(view.getSnapshot().viewGeneration).toBe('two');
    view.close();
  });

  it('retains current records through reset until the next generation ends', async () => {
    const view = await openSourceView('plugin', request);
    event('one', '1', 'snapshot', { records: [record('old')] });
    event('one', '2', 'snapshotEnd', { status });
    event('one', '5', 'reset', { reset: { reason: 'overflow', message: 'overflow' } });
    expect(view.getSnapshot().event?.kind).toBe('reset');
    event('two', '1', 'snapshot', { records: [record('new')] });
    expect([...view.getSnapshot().records.keys()]).toEqual(['old']);
    event('two', '2', 'snapshotEnd', { status });
    expect([...view.getSnapshot().records.keys()]).toEqual(['new']);
    expect(view.getSnapshot().viewGeneration).toBe('two');
    view.close();
  });

  describe('record identity', () => {
    // The record's content is its target id; `record` above carries a key only.
    const versioned = (key: string, version: number) => ({ key, targetId: `version-${version}` }) as HostRecord;
    const versionOf = (value: HostRecord | undefined) => value?.targetId;

    it('keeps every unchanged record and never modifies a map a reader holds', async () => {
      const view = await openSourceView('plugin', request);
      const [a, b, c] = [versioned('a', 1), versioned('b', 1), versioned('c', 1)];
      event('one', '1', 'snapshot', { records: [a, b, c] });
      event('one', '2', 'snapshotEnd', { status });
      const first = view.getSnapshot();
      // A delete in the middle must not disturb the records that follow it.
      event('one', '3', 'changes', { removes: [{ key: 'b', addressKey: 'b' }] });
      const second = view.getSnapshot();
      expect([...first.records.keys()]).toEqual(['a', 'b', 'c']);
      expect([...second.records.keys()]).toEqual(['a', 'c']);
      expect(second.records.get('a')).toBe(a);
      expect(second.records.get('c')).toBe(c);
      // The same content in a new object, and the removal of nothing, change no record. The event still counts.
      event('one', '4', 'changes', { upserts: [versioned('a', 1)], removes: [{ key: 'missing', addressKey: 'missing' }] });
      const third = view.getSnapshot();
      expect(third.records).toBe(second.records);
      expect(third.records.get('a')).toBe(a);
      expect(third.event).toEqual({ kind: 'changes', revision: second.event!.revision + 1 });
      // A real change replaces only the record that changed.
      event('one', '5', 'changes', { upserts: [versioned('a', 2)] });
      const fourth = view.getSnapshot();
      expect(fourth.records).not.toBe(third.records);
      expect(versionOf(fourth.records.get('a'))).toBe('version-2');
      expect(fourth.records.get('c')).toBe(c);
      expect(third.records.get('a')).toBe(a);
      view.close();
    });

    it('applies the patches of one frame once and keeps the maps readers already received', async () => {
      const view = await openSourceView('plugin', request);
      const listener = vi.fn();
      view.subscribe(listener);
      event('one', '1', 'snapshotEnd', { status });
      const before = view.getSnapshot();
      event('one', '2', 'changes', { upserts: [versioned('a', 1)] });
      event('one', '3', 'changes', { upserts: [versioned('b', 1)], removes: [{ key: 'a', addressKey: 'a' }] });
      event('one', '4', 'changes', { upserts: [versioned('a', 2)] });
      frame?.(0);
      expect(listener).toHaveBeenCalledTimes(1);
      const after = view.getSnapshot();
      expect(before.records.size).toBe(0);
      // A record deleted and recreated within one frame is a new entry at the end, as it is across frames.
      expect([...after.records].map(([key, value]) => [key, versionOf(value)])).toEqual([['b', 'version-1'], ['a', 'version-2']]);
      expect(after.event?.revision).toBe(4);
      const read = after.records;
      event('one', '5', 'changes', { upserts: [versioned('c', 1)] });
      expect(read.size).toBe(2);
      expect(view.getSnapshot().records.size).toBe(3);
      view.close();
    });

    it('keeps the objects of records a new generation repeats unchanged, by key rather than by position', async () => {
      const view = await openSourceView('plugin', request);
      const [a, b, c] = [versioned('a', 1), versioned('b', 1), versioned('c', 1)];
      event('one', '1', 'snapshot', { records: [a, b, c] });
      event('one', '2', 'snapshotEnd', { status });
      event('one', '3', 'reset', { reset: { reason: 'resync', message: 'resync' } });
      event('two', '1', 'snapshot', { records: [versioned('c', 1), versioned('a', 1), versioned('b', 2)] });
      event('two', '2', 'snapshotEnd', { status });
      const { records, viewGeneration } = view.getSnapshot();
      expect(viewGeneration).toBe('two');
      expect([...records.keys()]).toEqual(['c', 'a', 'b']);
      expect(records.get('a')).toBe(a);
      expect(records.get('c')).toBe(c);
      expect(records.get('b')).not.toBe(b);
      expect(versionOf(records.get('b'))).toBe('version-2');
      view.close();
    });

    it('publishes a status event only when it changes the status', async () => {
      const view = await openSourceView('plugin', request);
      const listener = vi.fn();
      view.subscribe(listener);
      event('one', '1', 'snapshotEnd', { status });
      frame?.(0);
      expect(listener).toHaveBeenCalledTimes(1);
      const held = view.getSnapshot().status;
      frame = undefined;
      event('one', '2', 'status', { status: { ...status, count: { ...status.count } } });
      expect(frame).toBeUndefined();
      expect(view.getSnapshot().status).toBe(held);
      event('one', '3', 'status', { status: { ...status, state: 'finished' } });
      expect(frame).toBeDefined();
      expect(view.getSnapshot().status?.state).toBe('finished');
      view.close();
    });
  });

  it('refreshes and closes once, cancelling delivery and detaching events', async () => {
    const view = await openSourceView('plugin', request);
    const listener = vi.fn();
    const unsubscribe = view.subscribe(listener);
    unsubscribe();
    await view.refresh();
    expect(mocks.refresh).toHaveBeenCalledWith('plugin', 'view');
    event('one', '1', 'snapshotEnd', { status });
    view.close();
    view.close();
    frame?.(0);
    expect(listener).not.toHaveBeenCalled();
    expect(mocks.off).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledWith('plugin', 'view');
  });

  it('closes an opened view if initial sync fails', async () => {
    mocks.sync.mockRejectedValueOnce(new Error('sync failed'));
    await expect(openSourceView('plugin', request)).rejects.toThrow('sync failed');
    expect(mocks.off).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledWith('plugin', 'view');
  });
});
