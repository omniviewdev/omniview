import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostRecord, HostSourceViewEvent, HostSourceViewRequest } from './host';

const mocks = vi.hoisted(() => ({
  on: vi.fn(), off: vi.fn(), open: vi.fn(), sync: vi.fn(), refresh: vi.fn(), close: vi.fn(),
}));
vi.mock('@wailsio/runtime', () => ({ Events: { On: mocks.on } }));
vi.mock('./client', () => ({
  OpenSourceView: mocks.open, SyncSourceView: mocks.sync,
  RefreshSourceView: mocks.refresh, CloseSourceView: mocks.close,
}));
import { openSourceView } from './sourceView';

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
