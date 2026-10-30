import { act, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { WatchState } from '../../types/watch';
import type { HostRecord, HostSourcePage, ResourceView } from '../../resource/v2/host';
import { applyBatch, useEventBatcher, type ResourceUpdateEvent } from './useEventBatcher';

const queryKey = ['provider', 'resource-v2', 'enumerate', 'target'];
const detailKey = ['provider', 'resource-v2', 'get', 'one'];
function row(id: string, incarnation = 'current', targetId = 'target', label = id): HostRecord {
  return { key: `host-membership:${targetId}:${id}:${incarnation}`, addressKey: `host-address:${id}`, targetId, route: { connection: 'route' }, record: {
    reference: { address: { provider: 'provider', authority: 'host-authority', type: 'opaque/type', scope: [{ dimension: 'region', value: '雪/a' }], id }, incarnation },
    body: { kind: 'string', value: label },
    representation: { id: 'native', revision: '1', schema: { state: 'unavailable', validation: 'unvalidated', unvalidated: [] } }, coverage: { kind: 'complete', paths: [] },
  } };
}
function page(records: HostRecord[] = [row('one'), row('two')]): HostSourcePage {
  return { records, sourcePage: { nextCursor: 'opaque-next', count: { kind: 'exact', value: '10000' }, coverage: { kind: 'complete', paths: [] }, consistency: 'bestEffort', sourceRevision: 'native-revision' } };
}
function event(type: ResourceUpdateEvent['type'], record: HostRecord): ResourceUpdateEvent {
  return type === 'DELETE' ? { type, payload: { route: record.route, reference: record.record.reference, key: record.key, addressKey: record.addressKey, targetId: record.targetId, guarantee: 'bestEffort' } } : { type, payload: { route: record.route, record, metadata: {}, guarantee: 'bestEffort' } };
}
const changed = (id: string, label = 'updated') => row(id, 'current', 'target', label);

describe('applyBatch bounded native page membership', () => {
  it('patches and deletes observed host keys without appending unknown rows', () => {
    const baseline = page();
    const result = applyBatch(baseline, [event('ADD', row('three')), event('UPDATE', changed('one')), event('DELETE', row('two'))])!;
    expect(result.records).toEqual([changed('one')]);
    expect(baseline.records).toEqual([row('one'), row('two')]);
    expect(result.sourcePage).toBe(baseline.sourcePage);
    expect(result.sourcePage.nextCursor).toBe('opaque-next');
    expect(result.sourcePage.count).toEqual({ kind: 'exact', value: '10000' });
    expect(result.sourcePage.sourceRevision).toBe('native-revision');
    expect(result.view).toEqual({ guarantee: 'bestEffort', count: { kind: 'unknown' }, membershipStale: true });
  });
  it.each(['ADD', 'UPDATE'] as const)('marks unseen %s stale without expanding an empty native page', (type) => {
    const result = applyBatch(page([]), [event(type, row('new'))])!;
    expect(result.records).toEqual([]);
    expect(result.view?.membershipStale).toBe(true);
  });
  it.each(['ADD', 'UPDATE'] as const)('updates the exact observed membership on %s without declaring membership stale', (type) => {
    const result = applyBatch(page(), [event(type, changed('one'))])!;
    expect(result.records).toEqual([changed('one'), row('two')]);
    expect(result.view?.membershipStale).toBe(false);
  });
  it('does not replace an observed incarnation or admit a different target projection', () => {
    const current = row('same', 'new');
    const result = applyBatch(page([current]), [event('DELETE', row('same', 'old')), event('ADD', row('same', 'replacement')), event('UPDATE', row('same', 'new', 'other-target'))])!;
    expect(result.records).toEqual([current]);
    expect(result.view?.membershipStale).toBe(true);
  });
  it('marks unknown deletes stale without guessing a current membership key', () => {
    const result = applyBatch(page(), [event('DELETE', row('other'))])!;
    expect(result.records).toEqual(page().records);
    expect(result.view?.membershipStale).toBe(true);
  });
  it('does not manufacture a source page before native acquisition', () => {
    expect(applyBatch(undefined, [event('ADD', row('one'))])).toBeUndefined();
  });
  it('accepts native page instances and preserves their source metadata', () => {
    class NativePage { records = [row('one')]; sourcePage = page().sourcePage; }
    const baseline = new NativePage();
    const result = applyBatch(baseline, [event('UPDATE', changed('one')), event('ADD', row('two'))])!;
    expect(result.records).toEqual([changed('one')]);
    expect(result.sourcePage).toBe(baseline.sourcePage);
  });
  it('uses host keys rather than body identity or slash/unicode parsing', () => {
    const opaque = changed('opaque/slash/雪', 'body identity is not the address');
    expect(applyBatch(page([row('opaque/slash/雪')]), [event('UPDATE', opaque)])!.records).toEqual([opaque]);
  });
  it('keeps the stale flag until a fresh native response replaces the overlay', () => {
    const stale = applyBatch(page(), [event('ADD', row('unknown'))])!;
    expect(applyBatch(stale, [event('UPDATE', changed('one'))])!.view?.membershipStale).toBe(true);
    expect(applyBatch(page(), [])?.view).toBeUndefined();
  });
  it('applies mixed frozen batches without mutating canonical rows or metadata', () => {
    const first = Object.freeze(row('one'));
    const second = Object.freeze(row('two'));
    const baseline = Object.freeze({ ...page(), records: Object.freeze([first, second]) });
    const replacement = Object.freeze(changed('one'));
    const result = applyBatch(baseline, [event('UPDATE', replacement), event('DELETE', second), event('ADD', row('new'))])!;
    expect(result.records).toEqual([replacement]);
    expect(result.records[0]).toBe(replacement);
    expect(result.sourcePage).toBe(baseline.sourcePage);
    expect(baseline.records).toEqual([first, second]);
  });
  it('retains an unchanged advisory cache identity without losing source metadata', () => {
    const baseline = applyBatch(page(), [event('ADD', row('unknown'))])!;
    expect(applyBatch(baseline, [event('UPDATE', baseline.records[0]), event('DELETE', row('missing'))])).toBe(baseline);
  });
  it('does not resurrect a deleted page member from a later advisory ADD or UPDATE', () => {
    const original = row('one');
    const replacement = changed('one');
    const result = applyBatch(page([original]), [event('DELETE', original), event('ADD', replacement), event('UPDATE', replacement)])!;
    expect(result.records).toEqual([]);
    expect(result.view?.membershipStale).toBe(true);
  });
});

describe('useEventBatcher bounded adaptive scheduling', () => {
  let client: QueryClient;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  const flushFrames = () => { const pending = [...frames.values()]; frames.clear(); act(() => { pending.forEach(callback => callback(0)); }); };
  const cached = () => client.getQueryData<ResourceView>(queryKey)!;
  beforeEach(() => {
    vi.useFakeTimers(); frames = new Map(); nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKey, page());
  });
  afterEach(() => { client.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('coalesces 1000 observed-key updates into one syncing batch after 500ms', () => {
    const writes = vi.spyOn(client, 'setQueryData');
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSyncing));
    act(() => { for (let n = 0; n < 1000; n++) hook.result.current(event('UPDATE', changed('one', String(n)))); });
    act(() => vi.advanceTimersByTime(499));
    expect(cached().records).toEqual(page().records); expect(frames.size).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(cached().records).toEqual([changed('one', '999'), row('two')]);
    expect(writes).toHaveBeenCalledTimes(1);
  });
  it('collapses an arbitrary unseen-row flood into a stale flag without retaining page members', () => {
    const writes = vi.spyOn(client, 'setQueryData');
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSyncing));
    act(() => { for (let n = 0; n < 1000; n++) hook.result.current(event(n % 2 ? 'UPDATE' : 'ADD', row(`unseen-${n}`))); });
    act(() => vi.advanceTimersByTime(500));
    expect(cached().records).toEqual(page().records);
    expect(cached().view?.membershipStale).toBe(true); expect(writes).toHaveBeenCalledTimes(1);
  });
  it.each([WatchState.WatchStateIdle, WatchState.WatchStateSynced])('commits an observed ADD within the bounded window when frames are withheld (state %s)', (state) => {
    client.setQueryData(detailKey, row('one'));
    const hook = renderHook(() => useEventBatcher(client, queryKey, state));
    act(() => hook.result.current(event('ADD', changed('one'))));
    act(() => vi.advanceTimersByTime(499));
    expect(cached().records).toEqual(page().records);
    act(() => vi.advanceTimersByTime(1));
    expect(cached().records).toEqual([changed('one'), row('two')]);
    expect(client.getQueryData(detailKey)).toEqual(changed('one'));
  });
  it('respects a custom sync window', () => {
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSyncing, { syncWindowMs: 200 }));
    act(() => hook.result.current(event('UPDATE', changed('one'))));
    act(() => vi.advanceTimersByTime(199)); expect(cached().records[0]).toEqual(row('one'));
    act(() => vi.advanceTimersByTime(1)); expect(cached().records[0]).toEqual(changed('one'));
  });
  it.each([WatchState.WatchStateSynced, WatchState.WatchStateIdle])('uses next-frame batching in live state %s', state => {
    const writes = vi.spyOn(client, 'setQueryData');
    const hook = renderHook(() => useEventBatcher(client, queryKey, state));
    act(() => { hook.result.current(event('UPDATE', changed('one'))); hook.result.current(event('UPDATE', changed('two'))); });
    expect(cached().records).toEqual(page().records); expect(frames.size).toBe(1);
    flushFrames();
    expect(cached().records).toEqual([changed('one'), changed('two')]); expect(writes).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(500)); expect(writes).toHaveBeenCalledTimes(1);
  });
  it.each([WatchState.WatchStateSynced, WatchState.WatchStateIdle])('bounds progress when frames are withheld in state %s', state => {
    client.setQueryData(queryKey, page([row('opaque/slash/雪')]));
    const hook = renderHook(() => useEventBatcher(client, queryKey, state));
    act(() => hook.result.current(event('UPDATE', changed('opaque/slash/雪'))));
    act(() => vi.advanceTimersByTime(500));
    expect(cached().records).toEqual([changed('opaque/slash/雪')]); expect(frames.size).toBe(0);
  });
  it('bounds a live batch by the configured window', () => {
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSynced, { syncWindowMs: 200 }));
    act(() => hook.result.current(event('UPDATE', changed('one'))));
    act(() => vi.advanceTimersByTime(200)); expect(cached().records[0]).toEqual(changed('one'));
  });
  it('does not reapply a drained batch when its losing callback arrives late', () => {
    const writes = vi.spyOn(client, 'setQueryData');
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSynced));
    act(() => hook.result.current(event('UPDATE', changed('one'))));
    const late = [...frames.values()][0];
    act(() => vi.advanceTimersByTime(500)); act(() => late(0));
    expect(writes).toHaveBeenCalledTimes(1);
  });
  it.each([WatchState.WatchStateSyncing, WatchState.WatchStateSynced])('cancels pending schedules on unmount in state %s', state => {
    client.setQueryData(detailKey, row('one'));
    const writes = vi.spyOn(client, 'setQueryData');
    const hook = renderHook(() => useEventBatcher(client, queryKey, state));
    act(() => { hook.result.current(event('UPDATE', changed('one'))); hook.result.current(event('ADD', row('unseen'))); }); hook.unmount();
    expect(frames.size).toBe(0); act(() => vi.advanceTimersByTime(1000));
    expect(writes).not.toHaveBeenCalled(); expect(cached().records).toEqual(page().records);
    expect(client.getQueryData(detailKey)).toEqual(row('one'));
  });
  it('preserves buffered updates through watch-state changes', () => {
    const hook = renderHook(({ state }) => useEventBatcher(client, queryKey, state), { initialProps: { state: WatchState.WatchStateSyncing } });
    act(() => hook.result.current(event('UPDATE', changed('one'))));
    hook.rerender({ state: WatchState.WatchStateSynced });
    act(() => vi.advanceTimersByTime(500)); expect(cached().records[0]).toEqual(changed('one'));
    act(() => hook.result.current(event('UPDATE', changed('two')))); flushFrames();
    expect(cached().records).toEqual([changed('one'), changed('two')]);
  });
  it.each(['ADD', 'UPDATE'] as const)('updates only exact observed membership detail caches on %s', type => {
    client.setQueryData(detailKey, row('one')); client.setQueryData([...detailKey, 'other'], row('other'));
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSynced));
    act(() => hook.result.current(event(type, changed('one')))); flushFrames();
    expect(client.getQueryData(detailKey)).toEqual(changed('one'));
    expect(client.getQueryData([...detailKey, 'other'])).toEqual(row('other'));
  });
  it('does not create detail caches or overwrite another incarnation', () => {
    client.setQueryData(detailKey, row('one', 'new'));
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSynced));
    act(() => hook.result.current(event('ADD', row('one', 'old')))); flushFrames();
    expect(client.getQueryData(detailKey)).toEqual(row('one', 'new'));
    expect(client.getQueryData([...detailKey, 'absent'])).toBeUndefined();
    expect(cached().view?.membershipStale).toBe(true);
  });
  it('invalidates only the matching deleted membership detail and marks the page gap stale', () => {
    client.setQueryData(detailKey, row('one')); client.setQueryData([...detailKey, 'older'], row('one', 'older'));
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSynced));
    act(() => hook.result.current(event('DELETE', row('one')))); flushFrames();
    expect(cached().records).toEqual([row('two')]); expect(cached().view?.membershipStale).toBe(true);
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(client.getQueryData(detailKey)).toEqual(row('one'));
    expect(client.getQueryState([...detailKey, 'older'])?.isInvalidated).toBe(false);
  });
  it('retains only a stale indication before the first native page, not unbounded event bodies', () => {
    client.removeQueries({ queryKey });
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSyncing));
    act(() => { for (let n = 0; n < 1000; n++) hook.result.current(event('ADD', row(`unseen-${n}`))); });
    act(() => vi.advanceTimersByTime(500)); expect(client.getQueryData(queryKey)).toBeUndefined();
    act(() => client.setQueryData(queryKey, page()));
    expect(cached().records).toEqual(page().records); expect(cached().view?.membershipStale).toBe(true);
  });
  it('clears stale disclosure when a new native response replaces the advisory overlay', () => {
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSynced));
    act(() => hook.result.current(event('ADD', row('unknown')))); flushFrames();
    expect(cached().view?.membershipStale).toBe(true);
    act(() => client.setQueryData(queryKey, page([row('newly-observed')])));
    expect(cached().view).toBeUndefined(); expect(cached().records).toEqual([row('newly-observed')]);
  });
});
