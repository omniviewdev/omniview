import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
import type { ConnectionReadiness, HostConnectionState } from '../../resource/v2/host';
import { WatchState } from '../../types/watch';
import { useConnectionStatus } from './useConnectionStatus';

const native = vi.hoisted(() => ({
  states: vi.fn(), list: vi.fn(), stop: vi.fn(), catalog: vi.fn(), resolve: vi.fn(), watch: vi.fn(),
  listeners: new Map<string, (event: { data: unknown }) => void>(),
}));
vi.mock('@wailsio/runtime', () => ({ Events: { On: (name: string, handler: (event: { data: unknown }) => void) => {
  native.listeners.set(name, handler);
  return () => { native.listeners.delete(name); };
} } }));
vi.mock('../../resource/v2/client', () => ({
  GetAllConnectionStates: native.states, ListAllConnections: native.list, StopConnection: native.stop,
  Catalog: native.catalog, ResolveTarget: native.resolve, StartConnectionWatch: native.watch,
}));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/servicewrapper', () => ({ RetryFailedPlugin: vi.fn() }));

function snapshot(readiness: ConnectionReadiness): HostConnectionState {
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
