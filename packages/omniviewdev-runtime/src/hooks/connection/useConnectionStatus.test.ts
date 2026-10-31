import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WailsRuntime from '@wailsio/runtime';
import { Connection } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
import type { NativeConnectionReadiness, HostConnectionState } from '../../resource/v2/host';
import { WatchState } from '../../types/watch';
import { useConnectionStatus } from './useConnectionStatus';

const native = vi.hoisted(() => ({
  states: vi.fn(), list: vi.fn(), stop: vi.fn(), catalog: vi.fn(), resolve: vi.fn(), watch: vi.fn(),
  listeners: new Map<string, (event: { data: unknown }) => void>(),
}));
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof WailsRuntime>();
  return {
    ...actual,
    Events: {
      ...actual.Events,
      On(name: string, handler: (event: { data: unknown }) => void) {
        native.listeners.set(name, handler);
        return () => { native.listeners.delete(name); };
      },
    },
  };
});
vi.mock('../../resource/v2/client', () => ({
  GetAllConnectionStates: native.states, ListAllConnections: native.list, StopConnection: native.stop,
  Catalog: native.catalog, ResolveTarget: native.resolve, StartConnectionWatch: native.watch,
}));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/servicewrapper', () => ({ RetryFailedPlugin: vi.fn() }));

function snapshot(readiness: NativeConnectionReadiness): HostConnectionState {
  return { connection: Connection.createFrom({ id: readiness, name: readiness }), readiness,
    resources: { pods: WatchState.WatchStateSynced }, resourceCounts: {}, totalResources: 0, syncedCount: 0, errorCount: 0 };
}
function emit(status: string, connectionID = 'UNKNOWN') {
  native.listeners.get('connection/status')?.({ data: { pluginID: 'cloud', connectionID, status } });
}
beforeEach(() => {
  vi.clearAllMocks();
  native.listeners.clear();
  native.list.mockResolvedValue({});
});

describe('connection readiness', () => {
  it('keeps newer event metadata when older requests finish last', async () => {
    native.states.mockResolvedValueOnce({ cloud: [snapshot('CONNECTED')] });
    const hook = renderHook(() => useConnectionStatus());
    await waitFor(() => expect(hook.result.current.connectedCount).toBe(1));
    const older = Promise.withResolvers<Record<string, Connection[]>>();
    const newer = Promise.withResolvers<Record<string, Connection[]>>();
    native.list.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    act(() => { emit('PENDING', 'CONNECTED'); });
    act(() => { emit('CONNECTED', 'CONNECTED'); });
    await act(async () => {
      newer.resolve({ cloud: [Connection.createFrom({ id: 'CONNECTED', name: 'Latest' })] });
    });
    await act(async () => {
      older.resolve({ cloud: [Connection.createFrom({ id: 'CONNECTED', name: 'Retired' })] });
    });
    expect(hook.result.current.entries[0].name).toBe('Latest');
    expect(hook.result.current.connectedCount).toBe(1);
    hook.unmount();
  });

  it('preserves terminal watch events received while a refresh snapshot is pending', async () => {
    const syncing = snapshot('CONNECTED');
    syncing.resources.pods = WatchState.WatchStateSyncing;
    native.states.mockResolvedValueOnce({ cloud: [syncing] });
    const hook = renderHook(() => useConnectionStatus());
    await waitFor(() => expect(hook.result.current.entries[0]?.isSyncing).toBe(true));
    const pending = Promise.withResolvers<Record<string, HostConnectionState[]>>();
    native.states.mockReturnValueOnce(pending.promise);
    let refresh: Promise<void>;
    act(() => { refresh = hook.result.current.refresh(); });
    act(() => {
      native.listeners.get('watch/STATE')?.({ data: {
        pluginID: 'cloud', route: { connection: 'CONNECTED' }, type: 'pods',
        state: WatchState.WatchStateSynced, guarantee: 'bestEffort',
      } });
    });
    expect(hook.result.current.entries[0].isSyncing).toBe(false);
    await act(async () => {
      pending.resolve({ cloud: [syncing] });
      await refresh!;
    });
    expect(hook.result.current.entries[0].isSyncing).toBe(false);
    expect(hook.result.current.entries[0].hasErrors).toBe(false);
    expect(hook.result.current.entries[0].readiness).toBe('CONNECTED');
    hook.unmount();
  });

  it('does not restore watch events discarded by a disconnect during refresh', async () => {
    native.states.mockResolvedValueOnce({ cloud: [snapshot('CONNECTED')] });
    const hook = renderHook(() => useConnectionStatus());
    await waitFor(() => expect(hook.result.current.connectedCount).toBe(1));
    const pending = Promise.withResolvers<Record<string, HostConnectionState[]>>();
    native.states.mockReturnValueOnce(pending.promise);
    let refresh: Promise<void>;
    act(() => { refresh = hook.result.current.refresh(); });
    act(() => {
      native.listeners.get('watch/STATE')?.({ data: {
        pluginID: 'cloud', route: { connection: 'CONNECTED' }, type: 'pods',
        state: WatchState.WatchStateSyncing, guarantee: 'bestEffort',
      } });
      emit('DISCONNECTED', 'CONNECTED');
    });
    await act(async () => {
      pending.resolve({ cloud: [snapshot('CONNECTED')] });
      await refresh!;
    });
    expect(hook.result.current.entries[0].readiness).toBe('DISCONNECTED');
    expect(hook.result.current.entries[0].sync).toBeUndefined();
    hook.unmount();
  });

  it('exposes bootstrap denial without retry and recovers only after explicit refresh', async () => {
    const denied = { type: 'omniview:resource/forbidden', title: 'Access denied', detail: 'Access denied.',
      status: 403, code: 'FORBIDDEN', recovery: 'none' };
    native.states.mockRejectedValueOnce(denied);
    const hook = renderHook(() => useConnectionStatus());
    expect(hook.result.current.isLoading).toBe(true);
    await waitFor(() => expect(hook.result.current.error?.code).toBe('FORBIDDEN'));
    expect(hook.result.current.isLoading).toBe(false);
    expect(hook.result.current.entries).toEqual([]);
    expect(native.states).toHaveBeenCalledTimes(1);
    act(() => { emit('CONNECTED'); });
    expect(hook.result.current.error?.code).toBe('FORBIDDEN');
    expect(native.states).toHaveBeenCalledTimes(1);
    native.states.mockResolvedValueOnce({ cloud: [snapshot('DISCONNECTED')] });
    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.entries[0].readiness).toBe('DISCONNECTED');
    expect(hook.result.current.connectedCount).toBe(0);
    hook.unmount();
  });

  it('accepts a refreshed snapshot over events preceding that refresh', async () => {
    native.states.mockResolvedValueOnce({ cloud: [snapshot('CONNECTED')] });
    const hook = renderHook(() => useConnectionStatus());
    await waitFor(() => expect(hook.result.current.connectedCount).toBe(1));
    act(() => { emit('FAILED', 'CONNECTED'); });
    native.states.mockResolvedValueOnce({ cloud: [snapshot('CONNECTED')] });
    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.result.current.connectedCount).toBe(1);
    hook.unmount();
  });

  it('ignores an older overlapping refresh response', async () => {
    const older = Promise.withResolvers<Record<string, HostConnectionState[]>>();
    native.states.mockReturnValueOnce(older.promise);
    const hook = renderHook(() => useConnectionStatus());
    native.states.mockResolvedValueOnce({ cloud: [snapshot('DISCONNECTED')] });
    await act(async () => { await hook.result.current.refresh(); });
    await act(async () => { older.resolve({ cloud: [snapshot('CONNECTED')] }); });
    expect(hook.result.current.entries[0].readiness).toBe('DISCONNECTED');
    expect(hook.result.current.connectedCount).toBe(0);
    hook.unmount();
  });

  it('keeps every readiness visible and counts only registered clients', async () => {
    const states = (['UNKNOWN', 'DISCONNECTED', 'PENDING', 'CONNECTED', 'FAILED'] as const).map(snapshot);
    states[0].readinessError = { type: 'omniview:not-implemented', title: 'Unsupported', detail: 'Readiness unavailable', status: 501, code: 'UNSUPPORTED' };
    native.states.mockResolvedValue({ cloud: states });
    const hook = renderHook(() => useConnectionStatus());
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(5));
    expect(hook.result.current.connectedCount).toBe(1);
    expect(hook.result.current.entries.map((entry) => entry.readiness)).toEqual(states.map((state) => state.readiness));
    expect(hook.result.current.entries[0].readinessError?.code).toBe('UNSUPPORTED');
    for (const entry of hook.result.current.entries) {
      if (entry.readiness !== 'CONNECTED') expect(entry.sync).toBeUndefined();
    }
    hook.unmount();
  });

  it('never promotes pending, failed, or watch activity to connected', async () => {
    native.states.mockResolvedValue({ cloud: [snapshot('UNKNOWN')] });
    const hook = renderHook(() => useConnectionStatus());
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(1));
    for (const status of ['PENDING', 'FAILED', 'DISCONNECTED', 'UNKNOWN']) {
      act(() => { emit(status); });
      expect(hook.result.current.entries[0].readiness).toBe(status);
      expect(hook.result.current.connectedCount).toBe(0);
      act(() => { native.listeners.get('watch/STATE')?.({ data: { pluginID: 'cloud', route: { connection: 'UNKNOWN' }, type: 'pods', state: WatchState.WatchStateSynced, guarantee: 'bestEffort' } }); });
      expect(hook.result.current.entries[0].sync).toBeUndefined();
      await act(async () => { await hook.result.current.retryWatch('cloud', 'UNKNOWN'); });
      expect(native.catalog).not.toHaveBeenCalled();
    }
    act(() => { emit('CONNECTED'); });
    expect(hook.result.current.connectedCount).toBe(1);
    act(() => { emit('PENDING'); });
    expect(hook.result.current.connectedCount).toBe(0);
    hook.unmount();
  });

  it('does not let an older aggregate overwrite a newer lifecycle event', async () => {
    const { promise, resolve } = Promise.withResolvers<Record<string, HostConnectionState[]>>();
    native.states.mockReturnValue(promise);
    const hook = renderHook(() => useConnectionStatus());
    act(() => { emit('FAILED', 'CONNECTED'); });
    await act(async () => { resolve({ cloud: [snapshot('CONNECTED')] }); });
    expect(hook.result.current.entries[0].readiness).toBe('FAILED');
    expect(hook.result.current.connectedCount).toBe(0);
    expect(hook.result.current.entries[0].sync).toBeUndefined();
    hook.unmount();
  });
});
