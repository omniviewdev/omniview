import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- Mocks ---

// Mock useResolvedPluginId — just returns the explicit value.
vi.mock('../useResolvedPluginId', () => ({
  useResolvedPluginId: (explicit?: string) => {
    if (!explicit) throw new Error('pluginID must be provided');
    return explicit;
  },
}));

// Mock GetWatchState — controlled via mockGetWatchState.
let mockGetWatchState: vi.Mock;
vi.mock('../../wailsjs/go/resource/Client', () => ({
  get GetWatchState() { return mockGetWatchState; },
}));

// Mock EventsOn — captures the callback so tests can simulate events.
type EventCallback = (...data: any[]) => void;
let eventListeners: Map<string, EventCallback>;
let mockEventsOn: vi.Mock;
vi.mock('../../wailsjs/runtime/runtime', () => ({
  get EventsOn() { return mockEventsOn; },
}));

// Import after mocks
import { useWatchState } from './useWatchState';
import type { WatchConnectionSummary } from '../../types/watch';

// WatchState enum values (matches Wails-generated).
const IDLE = 0;
const SYNCING = 1;
const SYNCED = 2;
const ERROR = 3;
const STOPPED = 4;

// --- Helpers ---

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  });
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

/** Simulate a WatchStateEvent arriving on the event bus */
function emitStateEvent(pluginID: string, connectionID: string, resourceKey: string, state: number, resourceCount = 0) {
  const topic = `${pluginID}/${connectionID}/watch/STATE`;
  const listener = eventListeners.get(topic);
  if (!listener) throw new Error(`No listener for ${topic}`);
  listener({
    pluginId: pluginID,
    connection: connectionID,
    resourceKey,
    state,
    resourceCount,
  });
}

/** Build a mock GetWatchState result (mimics Wails WatchConnectionSummary class) */
function makeWatchResult(connectionId: string, resources: Record<string, number>, resourceCounts: Record<string, number> = {}) {
  return { connectionId, resources, resourceCounts };
}

// --- Setup/teardown ---

beforeEach(() => {
  eventListeners = new Map();
  mockEventsOn = vi.fn((eventName: string, callback: EventCallback) => {
    eventListeners.set(eventName, callback);
    return () => { eventListeners.delete(eventName); };
  });
  mockGetWatchState = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Initial data fetch
// ---------------------------------------------------------------------------

describe('useWatchState — initial data fetch', () => {
  it('fetches initial watch state and exposes summary data', async () => {
    const qc = makeQueryClient();
    mockGetWatchState.mockResolvedValue(
      makeWatchResult('conn-1', {
        'core::v1::Pod': SYNCED,
        'apps::v1::Deployment': SYNCING,
      }, {
        'core::v1::Pod': 14,
      }),
    );

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.summary.data).toBeDefined());

    const data = result.current.summary.data!;
    expect(data.totalResources).toBe(2);
    expect(data.syncedCount).toBe(1);
    expect(data.errorCount).toBe(0);
    expect(data.resources['core::v1::Pod']).toBe(SYNCED);
    expect(data.resources['apps::v1::Deployment']).toBe(SYNCING);
    expect(data.resourceCounts['core::v1::Pod']).toBe(14);
  });

  it('computes syncProgress and isFullySynced correctly', async () => {
    const qc = makeQueryClient();
    mockGetWatchState.mockResolvedValue(
      makeWatchResult('conn-1', {
        'core::v1::Pod': SYNCED,
        'apps::v1::Deployment': SYNCED,
      }),
    );

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.summary.data).toBeDefined());

    expect(result.current.syncProgress).toBe(1);
    expect(result.current.isFullySynced).toBe(true);
    expect(result.current.errorCount).toBe(0);
  });

  it('counts ERROR and STOPPED as terminal states for progress', async () => {
    const qc = makeQueryClient();
    mockGetWatchState.mockResolvedValue(
      makeWatchResult('conn-1', {
        'core::v1::Pod': SYNCED,
        'apps::v1::Deployment': ERROR,
        'core::v1::Service': STOPPED,
        'batch::v1::Job': SYNCING,
      }),
    );

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.summary.data).toBeDefined());

    // 3 terminal (SYNCED + ERROR + STOPPED) out of 4
    expect(result.current.syncProgress).toBe(0.75);
    expect(result.current.isFullySynced).toBe(false);
    expect(result.current.errorCount).toBe(1);
  });

  it('handles empty resources gracefully', async () => {
    const qc = makeQueryClient();
    mockGetWatchState.mockResolvedValue(
      makeWatchResult('conn-1', {}),
    );

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.summary.data).toBeDefined());

    expect(result.current.syncProgress).toBe(0);
    expect(result.current.isFullySynced).toBe(false);
  });

  it('handles null/undefined resources from backend', async () => {
    const qc = makeQueryClient();
    mockGetWatchState.mockResolvedValue({
      connectionId: 'conn-1',
      resources: null,
      resourceCounts: null,
    });

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.summary.data).toBeDefined());

    expect(result.current.summary.data!.totalResources).toBe(0);
    expect(result.current.syncProgress).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Live event updates (after data loaded)
// ---------------------------------------------------------------------------

describe('useWatchState — live events', () => {
  it('applies events that arrive after initial data is loaded', async () => {
    const qc = makeQueryClient();
    mockGetWatchState.mockResolvedValue(
      makeWatchResult('conn-1', {
        'core::v1::Pod': SYNCING,
        'apps::v1::Deployment': SYNCING,
      }),
    );

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.summary.data).toBeDefined());

    // Initial: 0 synced
    expect(result.current.summary.data!.syncedCount).toBe(0);

    // Emit SYNCED event
    act(() => {
      emitStateEvent('k8s', 'conn-1', 'core::v1::Pod', SYNCED, 14);
    });

    await waitFor(() =>
      expect(result.current.summary.data!.syncedCount).toBe(1),
    );

    expect(result.current.summary.data!.resources['core::v1::Pod']).toBe(SYNCED);
    expect(result.current.summary.data!.resourceCounts['core::v1::Pod']).toBe(14);
    expect(result.current.syncProgress).toBe(0.5);
  });

  it('recomputes aggregates correctly after multiple events', async () => {
    const qc = makeQueryClient();
    mockGetWatchState.mockResolvedValue(
      makeWatchResult('conn-1', {
        'core::v1::Pod': SYNCING,
        'apps::v1::Deployment': SYNCING,
        'core::v1::Service': SYNCING,
      }),
    );

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.summary.data).toBeDefined());

    act(() => {
      emitStateEvent('k8s', 'conn-1', 'core::v1::Pod', SYNCED, 14);
      emitStateEvent('k8s', 'conn-1', 'apps::v1::Deployment', ERROR);
      emitStateEvent('k8s', 'conn-1', 'core::v1::Service', SYNCED, 5);
    });

    await waitFor(() =>
      expect(result.current.isFullySynced).toBe(true),
    );

    expect(result.current.summary.data!.syncedCount).toBe(2);
    expect(result.current.summary.data!.errorCount).toBe(1);
    expect(result.current.syncProgress).toBe(1);
  });

  it('getResourceState returns correct per-resource state', async () => {
    const qc = makeQueryClient();
    mockGetWatchState.mockResolvedValue(
      makeWatchResult('conn-1', {
        'core::v1::Pod': SYNCING,
        'apps::v1::Deployment': SYNCED,
      }),
    );

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.summary.data).toBeDefined());

    expect(result.current.getResourceState('core::v1::Pod')).toBe(SYNCING);
    expect(result.current.getResourceState('apps::v1::Deployment')).toBe(SYNCED);
    expect(result.current.getResourceState('nonexistent')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Event buffering (the core race condition fix)
// ---------------------------------------------------------------------------

describe('useWatchState — event buffering', () => {
  it('buffers events arriving before initial fetch completes and replays them', async () => {
    const qc = makeQueryClient();

    // Create a controllable promise for GetWatchState.
    let resolveGetWatchState!: (value: any) => void;
    mockGetWatchState.mockReturnValue(
      new Promise(resolve => { resolveGetWatchState = resolve; }),
    );

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    // Query is in-flight, data not loaded yet.
    expect(result.current.summary.data).toBeUndefined();

    // Events arrive while fetch is in-flight — should be buffered.
    act(() => {
      emitStateEvent('k8s', 'conn-1', 'core::v1::Pod', SYNCED, 14);
      emitStateEvent('k8s', 'conn-1', 'apps::v1::Deployment', SYNCED, 3);
    });

    // Now resolve the initial fetch — returns all as SYNCING (stale snapshot).
    await act(async () => {
      resolveGetWatchState(
        makeWatchResult('conn-1', {
          'core::v1::Pod': SYNCING,
          'apps::v1::Deployment': SYNCING,
          'core::v1::Service': SYNCING,
        }),
      );
    });

    // After React Query commits data AND useEffect replays buffered events,
    // the SYNCED events should have been applied on top of the stale snapshot.
    await waitFor(() =>
      expect(result.current.summary.data!.syncedCount).toBe(2),
    );

    expect(result.current.summary.data!.resources['core::v1::Pod']).toBe(SYNCED);
    expect(result.current.summary.data!.resources['apps::v1::Deployment']).toBe(SYNCED);
    expect(result.current.summary.data!.resources['core::v1::Service']).toBe(SYNCING);
    expect(result.current.summary.data!.resourceCounts['core::v1::Pod']).toBe(14);
  });

  it('transitions from buffering to live mode after replay', async () => {
    const qc = makeQueryClient();

    let resolveGetWatchState!: (value: any) => void;
    mockGetWatchState.mockReturnValue(
      new Promise(resolve => { resolveGetWatchState = resolve; }),
    );

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    // Buffer one event.
    act(() => {
      emitStateEvent('k8s', 'conn-1', 'core::v1::Pod', SYNCED, 14);
    });

    // Resolve fetch.
    await act(async () => {
      resolveGetWatchState(
        makeWatchResult('conn-1', {
          'core::v1::Pod': SYNCING,
          'core::v1::Service': SYNCING,
        }),
      );
    });

    // Wait for buffered replay.
    await waitFor(() =>
      expect(result.current.summary.data!.resources['core::v1::Pod']).toBe(SYNCED),
    );

    // Now a NEW event arrives (live mode) — should apply immediately.
    act(() => {
      emitStateEvent('k8s', 'conn-1', 'core::v1::Service', SYNCED, 5);
    });

    await waitFor(() =>
      expect(result.current.summary.data!.resources['core::v1::Service']).toBe(SYNCED),
    );

    expect(result.current.isFullySynced).toBe(true);
  });

  it('handles many buffered events (simulates K8s 88-resource sync)', async () => {
    const qc = makeQueryClient();

    let resolveGetWatchState!: (value: any) => void;
    mockGetWatchState.mockReturnValue(
      new Promise(resolve => { resolveGetWatchState = resolve; }),
    );

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    // Buffer 88 SYNCED events while fetch is in-flight.
    const resourceKeys: string[] = [];
    act(() => {
      for (let i = 0; i < 88; i++) {
        const key = `group::v1::Kind${i}`;
        resourceKeys.push(key);
        emitStateEvent('k8s', 'conn-1', key, SYNCED, i);
      }
    });

    // Resolve fetch with all resources as SYNCING.
    const staleResources: Record<string, number> = {};
    for (const key of resourceKeys) {
      staleResources[key] = SYNCING;
    }

    await act(async () => {
      resolveGetWatchState(makeWatchResult('conn-1', staleResources));
    });

    // All 88 buffered SYNCED events should be replayed.
    await waitFor(() =>
      expect(result.current.isFullySynced).toBe(true),
    );

    expect(result.current.summary.data!.syncedCount).toBe(88);
    expect(result.current.syncProgress).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Key changes and disabled state
// ---------------------------------------------------------------------------

describe('useWatchState — key changes and disabled state', () => {
  it('does not fetch or subscribe when disabled', async () => {
    const qc = makeQueryClient();

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1', enabled: false }),
      { wrapper: makeWrapper(qc) },
    );

    // Should not fetch.
    expect(mockGetWatchState).not.toHaveBeenCalled();

    // Should not subscribe.
    expect(mockEventsOn).not.toHaveBeenCalled();

    // Should return safe defaults.
    expect(result.current.summary.data).toBeUndefined();
    expect(result.current.syncProgress).toBe(0);
    expect(result.current.isFullySynced).toBe(false);
  });

  it('cleans up event listener on unmount', async () => {
    const qc = makeQueryClient();
    mockGetWatchState.mockResolvedValue(
      makeWatchResult('conn-1', { 'core::v1::Pod': SYNCING }),
    );

    const { result, unmount } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.summary.data).toBeDefined());

    // Listener should exist.
    expect(eventListeners.has('k8s/conn-1/watch/STATE')).toBe(true);

    unmount();

    // Listener should be cleaned up.
    expect(eventListeners.has('k8s/conn-1/watch/STATE')).toBe(false);
  });

  it('resubscribes when connectionID changes', async () => {
    const qc = makeQueryClient();
    mockGetWatchState.mockResolvedValue(
      makeWatchResult('conn-1', { 'core::v1::Pod': SYNCED }),
    );

    const { result, rerender } = renderHook(
      ({ connectionID }: { connectionID: string }) =>
        useWatchState({ pluginID: 'k8s', connectionID }),
      { wrapper: makeWrapper(qc), initialProps: { connectionID: 'conn-1' } },
    );

    await waitFor(() => expect(result.current.summary.data).toBeDefined());

    // Switch connection.
    mockGetWatchState.mockResolvedValue(
      makeWatchResult('conn-2', { 'core::v1::Pod': SYNCING }),
    );

    rerender({ connectionID: 'conn-2' });

    // Should subscribe to new topic.
    await waitFor(() =>
      expect(eventListeners.has('k8s/conn-2/watch/STATE')).toBe(true),
    );

    // Old subscription should be cleaned up.
    expect(eventListeners.has('k8s/conn-1/watch/STATE')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Event ordering
// ---------------------------------------------------------------------------

describe('useWatchState — event ordering', () => {
  it('later events for the same resource overwrite earlier ones', async () => {
    const qc = makeQueryClient();
    mockGetWatchState.mockResolvedValue(
      makeWatchResult('conn-1', { 'core::v1::Pod': IDLE }),
    );

    const { result } = renderHook(
      () => useWatchState({ pluginID: 'k8s', connectionID: 'conn-1' }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.summary.data).toBeDefined());

    act(() => {
      emitStateEvent('k8s', 'conn-1', 'core::v1::Pod', SYNCING);
      emitStateEvent('k8s', 'conn-1', 'core::v1::Pod', SYNCED, 14);
    });

    await waitFor(() =>
      expect(result.current.summary.data!.resources['core::v1::Pod']).toBe(SYNCED),
    );

    expect(result.current.summary.data!.resourceCounts['core::v1::Pod']).toBe(14);
  });
});
