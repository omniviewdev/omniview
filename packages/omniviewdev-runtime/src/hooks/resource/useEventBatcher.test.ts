import { act, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { WatchState } from '../../types/watch';
import type { HostRecord, HostSourcePage } from '../../resource/v2/host';
import { applyBatch, useEventBatcher, type ResourceUpdateEvent } from './useEventBatcher';

const queryKey = ['provider', 'resource-v2', 'enumerate', 'target'];
const detailKey = ['provider', 'resource-v2', 'get', 'one'];
function row(id: string, incarnation = 'current', targetId = 'target'): HostRecord {
  return { key: `host-membership:${targetId}:${id}:${incarnation}`, addressKey: `host-address:${id}`, targetId, route: { connection: 'route' }, record: {
    reference: { address: { provider: 'provider', authority: 'host-authority', type: 'opaque/type', scope: [{ dimension: 'region', value: '雪/a' }], id }, incarnation },
    body: { kind: 'map', value: { label: { kind: 'string', value: id } } },
    representation: { id: 'native', revision: '1', schema: { state: 'unavailable', validation: 'unvalidated', unvalidated: [] } }, coverage: { kind: 'complete', paths: [] },
  } };
}
function page(records: HostRecord[] = []): HostSourcePage {
  return { records, sourcePage: { count: { kind: 'exact', value: String(records.length) }, coverage: { kind: 'complete', paths: [] }, consistency: 'bestEffort', sourceRevision: 'native-revision' } };
}
function event(type: ResourceUpdateEvent['type'], record: HostRecord): ResourceUpdateEvent {
  return type === 'DELETE' ? { type, payload: { route: record.route, reference: record.record.reference, key: record.key, addressKey: record.addressKey, targetId: record.targetId, guarantee: 'bestEffort' } } : { type, payload: { route: record.route, record, metadata: {}, guarantee: 'bestEffort' } };
}

describe('applyBatch canonical identity', () => {
  it('adds, replaces duplicate adds, updates and deletes in sequence without changing the baseline', () => {
    const baseline = page([row('one'), row('two')]);
    const changed = row('one');
    changed.record.body = { kind: 'map', value: { status: { kind: 'string', value: 'Running' } } };
    const result = applyBatch(baseline, [event('ADD', row('three')), event('ADD', row('three')), event('UPDATE', changed), event('DELETE', row('two'))])!;
    expect(result.records).toEqual([changed, row('three')]);
    expect(baseline.records).toEqual([row('one'), row('two')]);
    expect(result.sourcePage).toBe(baseline.sourcePage);
    expect(result.sourcePage.count).toEqual({ kind: 'exact', value: '2' });
    expect(result.sourcePage.sourceRevision).toBe('native-revision');
    expect(result.view).toEqual({ guarantee: 'bestEffort', count: { kind: 'unknown' } });
  });
  it('admits an update for an address not yet in this best-effort page', () => {
    expect(applyBatch(page(), [event('UPDATE', row('new'))])!.records).toEqual([row('new')]);
  });
  it('ignores a delete for an unknown membership key', () => {
    expect(applyBatch(page([row('one')]), [event('DELETE', row('other'))])!.records).toEqual([row('one')]);
  });
  it('does not manufacture a source page before native acquisition', () => {
    expect(applyBatch(undefined, [event('ADD', row('one'))])).toBeUndefined();
  });
  it('accepts non-plain page instances without losing canonical envelopes', () => {
    class NativePage { records = [row('one')]; sourcePage = page().sourcePage; }
    expect(applyBatch(new NativePage(), [event('ADD', row('two'))])!.records).toHaveLength(2);
  });
  it('uses host keys, not nested body identity or slash/unicode parsing', () => {
    const opaque = row('opaque/slash/雪');
    opaque.record.body = { kind: 'map', value: { spec: { kind: 'map', value: { id: { kind: 'string', value: 'not-the-address' } } } } };
    expect(applyBatch(page([opaque]), [event('UPDATE', opaque)])!.records).toEqual([opaque]);
  });
  it('keeps target projections separate and ignores stale-incarnation deletes', () => {
    const current = row('same', 'new');
    expect(applyBatch(page([current]), [event('DELETE', row('same', 'old')), event('ADD', row('same', 'new', 'other-target'))])!.records).toEqual([current, row('same', 'new', 'other-target')]);
  });
});

describe('useEventBatcher adaptive scheduling', () => {
  let client: QueryClient;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  const flushFrames = () => { const pending = [...frames.values()]; frames.clear(); act(() => { pending.forEach(callback => callback(0)); }); };
  const cached = () => client.getQueryData<HostSourcePage>(queryKey)!;
  beforeEach(() => {
    vi.useFakeTimers(); frames = new Map(); nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKey, page());
  });
  afterEach(() => { client.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('buffers syncing events for 500ms and applies one list batch', () => {
    const writes = vi.spyOn(client, 'setQueryData');
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSyncing));
    act(() => { for (let n = 0; n < 50; n++) hook.result.current(event('ADD', row(String(n)))); });
    act(() => vi.advanceTimersByTime(499));
    expect(cached().records).toHaveLength(0);
    expect(frames.size).toBe(0);
    act(() => vi.advanceTimersByTime(1));
    expect(cached().records).toHaveLength(50);
    expect(writes).toHaveBeenCalledTimes(1);
  });
  it('respects a custom sync window', () => {
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSyncing, { syncWindowMs: 200 }));
    act(() => hook.result.current(event('ADD', row('one'))));
    act(() => vi.advanceTimersByTime(199)); expect(cached().records).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1)); expect(cached().records).toHaveLength(1);
  });
  it.each([WatchState.WatchStateSynced, WatchState.WatchStateIdle])('uses next-frame batching in live state %s', state => {
    const writes = vi.spyOn(client, 'setQueryData');
    const hook = renderHook(() => useEventBatcher(client, queryKey, state));
    act(() => { hook.result.current(event('ADD', row('one'))); hook.result.current(event('ADD', row('two'))); });
    expect(cached().records).toHaveLength(0); expect(frames.size).toBe(1);
    flushFrames();
    expect(cached().records).toHaveLength(2); expect(writes).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(500)); expect(writes).toHaveBeenCalledTimes(1);
  });
  it.each([WatchState.WatchStateSynced, WatchState.WatchStateIdle])('bounds progress when frames are withheld in state %s', state => {
    const hook = renderHook(() => useEventBatcher(client, queryKey, state));
    act(() => hook.result.current(event('ADD', row('opaque/slash/雪'))));
    act(() => vi.advanceTimersByTime(500));
    expect(cached().records).toHaveLength(1); expect(frames.size).toBe(0);
  });
  it('bounds a live batch by the configured window', () => {
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSynced, { syncWindowMs: 200 }));
    act(() => hook.result.current(event('ADD', row('one'))));
    act(() => vi.advanceTimersByTime(200)); expect(cached().records).toHaveLength(1);
  });
  it('does not apply a drained batch again when its losing callback arrives late', () => {
    const writes = vi.spyOn(client, 'setQueryData');
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSynced));
    act(() => hook.result.current(event('ADD', row('one'))));
    const late = [...frames.values()][0];
    act(() => vi.advanceTimersByTime(500)); act(() => late(0));
    expect(writes).toHaveBeenCalledTimes(1);
  });
  it.each([WatchState.WatchStateSyncing, WatchState.WatchStateSynced])('cancels pending schedules on unmount in state %s', state => {
    client.setQueryData(detailKey, row('one'));
    const writes = vi.spyOn(client, 'setQueryData');
    const hook = renderHook(() => useEventBatcher(client, queryKey, state));
    act(() => hook.result.current(event('UPDATE', row('one')))); hook.unmount();
    expect(frames.size).toBe(0); act(() => vi.advanceTimersByTime(1000));
    expect(writes).not.toHaveBeenCalled(); expect(cached().records).toHaveLength(0);
    expect(client.getQueryData(detailKey)).toEqual(row('one'));
  });
  it('preserves buffered events through state changes and opens another batch window', () => {
    const hook = renderHook(({ state }) => useEventBatcher(client, queryKey, state), { initialProps: { state: WatchState.WatchStateSyncing } });
    act(() => hook.result.current(event('ADD', row('one'))));
    hook.rerender({ state: WatchState.WatchStateSynced });
    act(() => vi.advanceTimersByTime(500)); expect(cached().records).toHaveLength(1);
    act(() => hook.result.current(event('ADD', row('two')))); flushFrames();
    expect(cached().records).toHaveLength(2);
  });
  it('handles 1000 mixed events in a single sync batch', () => {
    const writes = vi.spyOn(client, 'setQueryData');
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSyncing));
    act(() => { for (let n = 0; n < 1000; n++) hook.result.current(event('ADD', row(String(n)))); hook.result.current(event('UPDATE', row('0', 'replacement'))); hook.result.current(event('DELETE', row('1'))); });
    act(() => vi.advanceTimersByTime(500));
    expect(cached().records).toHaveLength(999); expect(cached().records[0].key).toBe(row('0', 'replacement').key); expect(writes).toHaveBeenCalledTimes(1);
  });
  it.each(['ADD', 'UPDATE'] as const)('updates only existing matching detail caches on %s', type => {
    const original = row('one'); const updated = row('one'); updated.record.body = { kind: 'null' };
    client.setQueryData(detailKey, original); client.setQueryData([...detailKey, 'other'], row('other'));
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSynced));
    act(() => hook.result.current(event(type, updated))); flushFrames();
    expect(client.getQueryData(detailKey)).toEqual(updated);
    expect(client.getQueryData([...detailKey, 'other'])).toEqual(row('other'));
  });
  it('does not synthesize detail caches on add or overwrite a detail with another incarnation', () => {
    client.setQueryData(detailKey, row('one', 'new'));
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSynced));
    act(() => hook.result.current(event('ADD', row('one', 'old')))); flushFrames();
    expect(client.getQueryData(detailKey)).toEqual(row('one', 'new'));
    expect(client.getQueryData([...detailKey, 'absent'])).toBeUndefined();
  });
  it('deletes list membership without replacing an unrelated detail cache', () => {
    client.setQueryData(queryKey, page([row('one')])); client.setQueryData(detailKey, row('other'));
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSynced));
    act(() => hook.result.current(event('DELETE', row('one')))); flushFrames();
    expect(cached().records).toHaveLength(0); expect(client.getQueryData(detailKey)).toEqual(row('other'));
  });
  it('invalidates only the matching deleted membership detail without claiming it is absent', () => {
    client.setQueryData(queryKey, page([row('one')]));
    client.setQueryData(detailKey, row('one'));
    client.setQueryData([...detailKey, 'other-incarnation'], row('one', 'older'));
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSynced));
    act(() => hook.result.current(event('DELETE', row('one')))); flushFrames();
    expect(cached().records).toHaveLength(0);
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(client.getQueryData(detailKey)).toEqual(row('one'));
    expect(client.getQueryState([...detailKey, 'other-incarnation'])?.isInvalidated).toBe(false);
  });
  it('retains events until the real native baseline arrives instead of manufacturing a page', () => {
    client.removeQueries({ queryKey });
    const hook = renderHook(() => useEventBatcher(client, queryKey, WatchState.WatchStateSyncing));
    act(() => hook.result.current(event('ADD', row('one')))); act(() => vi.advanceTimersByTime(500));
    expect(client.getQueryData(queryKey)).toBeUndefined();
    act(() => client.setQueryData(queryKey, page()));
    expect(cached().records).toEqual([row('one')]);
  });
});
