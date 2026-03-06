import { renderHook, act } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import {
  applyBatch,
  useEventBatcher,
  type ResourceEvent,
} from './useEventBatcher';

// WatchState enum values (matches Wails-generated enum).
const IDLE = 0;
const SYNCING = 1;
const SYNCED = 2;

// ---------------------------------------------------------------------------
// applyBatch (pure function) — no timers needed
// ---------------------------------------------------------------------------

describe('applyBatch', () => {
  const idAccessor = 'metadata.name';

  const makeItem = (name: string, extra?: Record<string, unknown>) => ({
    metadata: { name },
    ...extra,
  });

  const baseData = {
    result: [makeItem('pod-1'), makeItem('pod-2')],
    success: true,
    totalCount: 2,
  };

  it('adds a new item via ADD', () => {
    const events: ResourceEvent[] = [
      {
        type: 'ADD',
        payload: { data: makeItem('pod-3'), key: 'k', connection: 'c', id: 'pod-3', namespace: 'default' },
      },
    ];
    const result = applyBatch(baseData, events, idAccessor);
    expect(result.result).toHaveLength(3);
    expect(result.result[2].metadata.name).toBe('pod-3');
  });

  it('deduplicates ADD for an existing item', () => {
    const events: ResourceEvent[] = [
      {
        type: 'ADD',
        payload: { data: makeItem('pod-1'), key: 'k', connection: 'c', id: 'pod-1', namespace: 'default' },
      },
    ];
    const result = applyBatch(baseData, events, idAccessor);
    expect(result.result).toHaveLength(2);
  });

  it('updates an existing item via UPDATE', () => {
    const events: ResourceEvent[] = [
      {
        type: 'UPDATE',
        payload: {
          data: makeItem('pod-1', { status: 'Running' }),
          key: 'k', connection: 'c', id: 'pod-1', namespace: 'default',
        },
      },
    ];
    const result = applyBatch(baseData, events, idAccessor);
    expect(result.result).toHaveLength(2);
    expect(result.result[0].status).toBe('Running');
  });

  it('ignores UPDATE for non-existent item', () => {
    const events: ResourceEvent[] = [
      {
        type: 'UPDATE',
        payload: {
          data: makeItem('pod-999'),
          key: 'k', connection: 'c', id: 'pod-999', namespace: 'default',
        },
      },
    ];
    const result = applyBatch(baseData, events, idAccessor);
    expect(result.result).toHaveLength(2);
  });

  it('removes an item via DELETE', () => {
    const events: ResourceEvent[] = [
      {
        type: 'DELETE',
        payload: { data: makeItem('pod-1'), key: 'k', connection: 'c', id: 'pod-1', namespace: 'default' },
      },
    ];
    const result = applyBatch(baseData, events, idAccessor);
    expect(result.result).toHaveLength(1);
    expect(result.result[0].metadata.name).toBe('pod-2');
  });

  it('ignores DELETE for non-existent item', () => {
    const events: ResourceEvent[] = [
      {
        type: 'DELETE',
        payload: { data: makeItem('pod-999'), key: 'k', connection: 'c', id: 'pod-999', namespace: 'default' },
      },
    ];
    const result = applyBatch(baseData, events, idAccessor);
    expect(result.result).toHaveLength(2);
  });

  it('applies multiple events in sequence', () => {
    const events: ResourceEvent[] = [
      { type: 'ADD', payload: { data: makeItem('pod-3'), key: 'k', connection: 'c', id: 'pod-3', namespace: 'default' } },
      { type: 'UPDATE', payload: { data: makeItem('pod-1', { status: 'Running' }), key: 'k', connection: 'c', id: 'pod-1', namespace: 'default' } },
      { type: 'DELETE', payload: { data: makeItem('pod-2'), key: 'k', connection: 'c', id: 'pod-2', namespace: 'default' } },
    ];
    const result = applyBatch(baseData, events, idAccessor);
    expect(result.result).toHaveLength(2);
    expect(result.result[0].metadata.name).toBe('pod-1');
    expect(result.result[0].status).toBe('Running');
    expect(result.result[1].metadata.name).toBe('pod-3');
  });

  it('handles undefined oldData by creating a fresh structure', () => {
    const events: ResourceEvent[] = [
      { type: 'ADD', payload: { data: makeItem('pod-1'), key: 'k', connection: 'c', id: 'pod-1', namespace: 'default' } },
    ];
    const result = applyBatch(undefined, events, idAccessor);
    expect(result.result).toHaveLength(1);
    expect(result.success).toBe(true);
  });

  it('supports nested id accessor paths', () => {
    const deepAccessor = 'spec.id';
    const data = {
      result: [{ spec: { id: 'a' } }],
      success: true,
      totalCount: 1,
    };
    const events: ResourceEvent[] = [
      { type: 'UPDATE', payload: { data: { spec: { id: 'a' }, updated: true }, key: 'k', connection: 'c', id: 'a', namespace: 'default' } },
    ];
    const result = applyBatch(data, events, deepAccessor);
    expect(result.result[0].updated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useEventBatcher (hook) — adaptive batching
// ---------------------------------------------------------------------------

// Shared helpers.
const queryKey = ['resources', 'test'];
const getResourceKey = (id: string, ns: string) => ['resource', ns, id];
const idAccessor = 'metadata.name';

const makePayload = (id: string, type: 'ADD' | 'UPDATE' | 'DELETE'): ResourceEvent => ({
  type,
  payload: {
    data: { metadata: { name: id } },
    key: 'core::v1::Pod',
    connection: 'cluster-1',
    id,
    namespace: 'default',
  },
} as ResourceEvent);

function makeQueryClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(queryKey, { result: [], success: true, totalCount: 0 });
  return qc;
}

// ---------------------------------------------------------------------------
// Sync-mode tests (REQ-BATCH-2)
// ---------------------------------------------------------------------------

describe('useEventBatcher — sync mode (SYNCING)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = makeQueryClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  it('events during SYNCING buffer for 500ms before flush', () => {
    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCING as any),
    );

    act(() => {
      result.current(makePayload('pod-1', 'ADD'));
    });

    // Before 500ms — cache should still be empty.
    const cached = queryClient.getQueryData(queryKey) as any;
    expect(cached.result).toHaveLength(0);

    // At 499ms — still empty.
    act(() => { vi.advanceTimersByTime(499); });
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(0);

    // At 500ms — flushed.
    act(() => { vi.advanceTimersByTime(1); });
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(1);
  });

  it('multiple events in sync window produce single setQueryData call', () => {
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCING as any),
    );

    act(() => {
      for (let i = 0; i < 50; i++) {
        result.current(makePayload(`pod-${i}`, 'ADD'));
      }
    });

    setQueryDataSpy.mockClear();

    act(() => { vi.advanceTimersByTime(500); });

    // 1 list update + 50 individual resource updates = 51 calls total.
    expect(setQueryDataSpy).toHaveBeenCalledTimes(51);

    const cached = queryClient.getQueryData(queryKey) as any;
    expect(cached.result).toHaveLength(50);
    setQueryDataSpy.mockRestore();
  });

  it('custom syncWindowMs is respected', () => {
    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCING as any, { syncWindowMs: 200 }),
    );

    act(() => { result.current(makePayload('pod-1', 'ADD')); });

    // At 199ms — still empty.
    act(() => { vi.advanceTimersByTime(199); });
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(0);

    // At 200ms — flushed.
    act(() => { vi.advanceTimersByTime(1); });
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// RAF-mode tests (REQ-BATCH-1)
// ---------------------------------------------------------------------------

describe('useEventBatcher — RAF mode (SYNCED)', () => {
  let queryClient: QueryClient;
  let rafCallbacks: Array<FrameRequestCallback>;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = makeQueryClient();
    rafCallbacks = [];

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      // Mark as cancelled by clearing entry.
      if (id > 0 && id <= rafCallbacks.length) {
        rafCallbacks[id - 1] = () => {};
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  function flushRAF() {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    for (const cb of cbs) {
      cb(performance.now());
    }
  }

  it('events during SYNCED flush on next animation frame', () => {
    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCED as any),
    );

    act(() => {
      result.current(makePayload('pod-1', 'ADD'));
    });

    // Before RAF fires — cache should still be empty.
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(0);

    // Trigger RAF.
    act(() => { flushRAF(); });
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(1);
  });

  it('multiple events within one frame are batched into single update', () => {
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCED as any),
    );

    act(() => {
      result.current(makePayload('pod-1', 'ADD'));
      result.current(makePayload('pod-2', 'ADD'));
      result.current(makePayload('pod-3', 'ADD'));
    });

    setQueryDataSpy.mockClear();

    act(() => { flushRAF(); });

    // 1 list update + 3 individual resource updates = 4 calls.
    expect(setQueryDataSpy).toHaveBeenCalledTimes(4);
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(3);
    setQueryDataSpy.mockRestore();
  });

  it('RAF cancelled on unmount', () => {
    const { result, unmount } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCED as any),
    );

    act(() => {
      result.current(makePayload('pod-1', 'ADD'));
    });

    unmount();

    act(() => { flushRAF(); });

    // Should NOT have flushed since we unmounted.
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(0);
  });

  it('updates individual resource caches on ADD', () => {
    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCED as any),
    );

    act(() => { result.current(makePayload('pod-1', 'ADD')); });
    act(() => { flushRAF(); });

    const individual = queryClient.getQueryData(getResourceKey('pod-1', 'default')) as any;
    expect(individual.result.metadata.name).toBe('pod-1');
  });

  it('updates individual resource caches on UPDATE', () => {
    queryClient.setQueryData(queryKey, {
      result: [{ metadata: { name: 'pod-1' } }],
      success: true,
      totalCount: 1,
    });

    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCED as any),
    );

    const updateEvent: ResourceEvent = {
      type: 'UPDATE',
      payload: {
        data: { metadata: { name: 'pod-1' }, status: 'Running' },
        key: 'core::v1::Pod',
        connection: 'cluster-1',
        id: 'pod-1',
        namespace: 'default',
      },
    };

    act(() => { result.current(updateEvent); });
    act(() => { flushRAF(); });

    const individual = queryClient.getQueryData(getResourceKey('pod-1', 'default')) as any;
    expect(individual.result.status).toBe('Running');
  });

  it('does NOT set individual cache on DELETE', () => {
    queryClient.setQueryData(queryKey, {
      result: [{ metadata: { name: 'pod-1' } }],
      success: true,
      totalCount: 1,
    });

    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCED as any),
    );

    act(() => { result.current(makePayload('pod-1', 'DELETE')); });
    act(() => { flushRAF(); });

    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(0);
    const individual = queryClient.getQueryData(getResourceKey('pod-1', 'default'));
    expect(individual).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Mode transition tests
// ---------------------------------------------------------------------------

describe('useEventBatcher — mode transitions', () => {
  let queryClient: QueryClient;
  let rafCallbacks: Array<FrameRequestCallback>;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = makeQueryClient();
    rafCallbacks = [];

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      if (id > 0 && id <= rafCallbacks.length) {
        rafCallbacks[id - 1] = () => {};
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  function flushRAF() {
    const cbs = [...rafCallbacks];
    rafCallbacks = [];
    for (const cb of cbs) {
      cb(performance.now());
    }
  }

  it('SYNCING→SYNCED: pending sync timer flushes, then RAF used for new events', () => {
    // Start in SYNCING.
    const { result, rerender } = renderHook(
      ({ state }: { state: any }) =>
        useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, state),
      { initialProps: { state: SYNCING } },
    );

    // Enqueue during sync mode.
    act(() => { result.current(makePayload('pod-1', 'ADD')); });

    // Transition to SYNCED.
    rerender({ state: SYNCED });

    // The pending setTimeout should still fire.
    act(() => { vi.advanceTimersByTime(500); });
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(1);

    // New events use RAF.
    act(() => { result.current(makePayload('pod-2', 'ADD')); });

    // setTimeout should NOT cause a flush (mode changed).
    act(() => { vi.advanceTimersByTime(500); });
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(1);

    // RAF should cause flush.
    act(() => { flushRAF(); });
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(2);
  });

  it('re-renders with new watchState do not lose buffered events', () => {
    const { result, rerender } = renderHook(
      ({ state }: { state: any }) =>
        useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, state),
      { initialProps: { state: SYNCING } },
    );

    act(() => {
      result.current(makePayload('pod-1', 'ADD'));
      result.current(makePayload('pod-2', 'ADD'));
    });

    // Transition mid-batch.
    rerender({ state: SYNCED });

    // Original timer still fires and includes all buffered events.
    act(() => { vi.advanceTimersByTime(500); });
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Performance tests
// ---------------------------------------------------------------------------

describe('useEventBatcher — performance', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = makeQueryClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  it('1000 ADD events during sync: single batch application', () => {
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCING as any),
    );

    act(() => {
      for (let i = 0; i < 1000; i++) {
        result.current(makePayload(`pod-${i}`, 'ADD'));
      }
    });

    setQueryDataSpy.mockClear();

    act(() => { vi.advanceTimersByTime(500); });

    // 1 list update + 1000 individual = 1001 calls, but only 1 batch computation.
    expect(setQueryDataSpy).toHaveBeenCalledTimes(1001);
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(1000);
    setQueryDataSpy.mockRestore();
  });

  it('mixed ADD/UPDATE/DELETE preserves correctness', () => {
    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCING as any),
    );

    act(() => {
      // Add 10 pods.
      for (let i = 0; i < 10; i++) {
        result.current(makePayload(`pod-${i}`, 'ADD'));
      }
      // Update 5.
      for (let i = 0; i < 5; i++) {
        result.current({
          type: 'UPDATE',
          payload: {
            data: { metadata: { name: `pod-${i}` }, status: 'Running' },
            key: 'core::v1::Pod',
            connection: 'cluster-1',
            id: `pod-${i}`,
            namespace: 'default',
          },
        });
      }
      // Delete 3.
      for (let i = 7; i < 10; i++) {
        result.current(makePayload(`pod-${i}`, 'DELETE'));
      }
    });

    act(() => { vi.advanceTimersByTime(500); });

    const cached = queryClient.getQueryData(queryKey) as any;
    expect(cached.result).toHaveLength(7);

    // First 5 should have status: Running.
    for (let i = 0; i < 5; i++) {
      const pod = cached.result.find((p: any) => p.metadata.name === `pod-${i}`);
      expect(pod.status).toBe('Running');
    }
    // Pods 7-9 should be deleted.
    for (let i = 7; i < 10; i++) {
      const pod = cached.result.find((p: any) => p.metadata.name === `pod-${i}`);
      expect(pod).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('useEventBatcher — edge cases', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = makeQueryClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  it('skips flush when idAccessor is undefined', () => {
    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, undefined, SYNCED as any),
    );

    act(() => { result.current(makePayload('pod-1', 'ADD')); });
    act(() => { vi.advanceTimersByTime(500); });

    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(0);
  });

  it('clears timer on unmount and does not flush (sync mode)', () => {
    const { result, unmount } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCING as any),
    );

    act(() => { result.current(makePayload('pod-1', 'ADD')); });

    unmount();

    act(() => { vi.advanceTimersByTime(500); });

    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(0);
  });

  it('starts a new batch window after the previous one flushes', () => {
    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, SYNCING as any),
    );

    // First batch.
    act(() => { result.current(makePayload('pod-1', 'ADD')); });
    act(() => { vi.advanceTimersByTime(500); });
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(1);

    // Second batch.
    act(() => { result.current(makePayload('pod-2', 'ADD')); });
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(1);

    act(() => { vi.advanceTimersByTime(500); });
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(2);
  });

  it('IDLE state uses RAF mode', () => {
    let rafCalled = false;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCalled = true;
      // Execute immediately for this test.
      cb(performance.now());
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const { result } = renderHook(() =>
      useEventBatcher(queryClient, queryKey, getResourceKey, idAccessor, IDLE as any),
    );

    act(() => { result.current(makePayload('pod-1', 'ADD')); });

    expect(rafCalled).toBe(true);
    expect((queryClient.getQueryData(queryKey) as any).result).toHaveLength(1);

    vi.unstubAllGlobals();
  });
});
