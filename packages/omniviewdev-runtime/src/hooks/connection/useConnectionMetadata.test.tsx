import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionMetadataEnvelope } from '../../connection/metadata';
import type { ReactNode } from 'react';
import { PluginContext } from '../../context/plugins/PluginContext';

const transport = vi.hoisted(() => ({ get: vi.fn(), refresh: vi.fn(), listener: undefined as undefined | ((event: { data: unknown }) => void), subscriptions: 0 }));
vi.mock('../../resource/v2/client', () => ({ GetConnectionMetadata: transport.get, RefreshConnectionMetadata: transport.refresh }));
vi.mock('@wailsio/runtime', () => ({ Events: { On: (_name: string, listener: typeof transport.listener) => {
  transport.listener = listener;
  transport.subscriptions++;
  return () => { transport.listener = undefined; };
} } }));
import { useConnectionMetadata, useConnectionMetadataConnections, useConnectionMetadataSelector } from './useConnectionMetadata';
import { readCurrentConnectionMetadataString } from '../../connection/metadata';

function envelope(revision = '1', connectionID = 'cluster', registrationID = 'one'): ConnectionMetadataEnvelope {
  return { pluginID: 'plugin', registrationID, supported: true, transportAvailable: true, snapshot: {
    connectionID, generation: 'generation', revision, active: true, refreshing: false,
    entries: { version: { state: 'current', value: revision, observedAt: '2026-10-31T00:00:00Z' } },
  } };
}
function deferred<T>() {
  return Promise.withResolvers<T>();
}
async function emit(data: ConnectionMetadataEnvelope) {
  await act(async () => { transport.listener?.({ data }); });
}
beforeEach(() => {
  transport.get.mockReset().mockResolvedValue(envelope());
  transport.refresh.mockReset().mockResolvedValue(envelope('2'));
  transport.subscriptions = 0;
});
afterEach(cleanup);

describe('connection metadata consumers', () => {
  it('shares reads and subscription without acquiring observations', async () => {
    const hook = renderHook(() => [useConnectionMetadata('plugin', 'cluster'), useConnectionMetadata('plugin', 'cluster')]);
    await waitFor(() => expect(hook.result.current[0].snapshot?.revision).toBe('1'));
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(transport.subscriptions).toBe(1);
    expect(transport.refresh).not.toHaveBeenCalled();
    expect(hook.result.current[0].snapshot).toBe(hook.result.current[1].snapshot);
    await act(async () => hook.result.current[0].refresh());
    expect(hook.result.current[1].snapshot?.revision).toBe('2');
  });

  it('rejects delayed gets behind events using lossless decimal ordering', async () => {
    const delayed = deferred<ConnectionMetadataEnvelope>();
    transport.get.mockReturnValueOnce(delayed.promise).mockResolvedValue(envelope('9007199254740993'));
    const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
    await waitFor(() => expect(transport.get).toHaveBeenCalledTimes(1));
    await emit(envelope('9007199254740993'));
    await act(async () => delayed.resolve(envelope('9007199254740992')));
    expect(hook.result.current.snapshot?.revision).toBe('9007199254740993');
    await emit(envelope('9007199254740992'));
    expect(hook.result.current.snapshot?.revision).toBe('9007199254740993');
  });

  it('fences route changes and isolates opaque plugin and connection IDs', async () => {
    const delayed = deferred<ConnectionMetadataEnvelope>();
    transport.get.mockImplementation((pluginID: string, connectionID: string) => pluginID === 'a/b' ? delayed.promise : Promise.resolve({ ...envelope('2', connectionID), pluginID }));
    const hook = renderHook(({ pluginID, connectionID }) => useConnectionMetadata(pluginID, connectionID), { initialProps: { pluginID: 'a/b', connectionID: 'c' } });
    await waitFor(() => expect(transport.get).toHaveBeenCalledTimes(1));
    hook.rerender({ pluginID: 'a', connectionID: 'b/c' });
    await waitFor(() => expect(hook.result.current.snapshot?.connectionID).toBe('b/c'));
    await act(async () => delayed.resolve({ ...envelope('99', 'c'), pluginID: 'a/b' }));
    expect(hook.result.current.snapshot?.connectionID).toBe('b/c');
    expect(hook.result.current.snapshot?.revision).toBe('2');
  });

  it('retires registrations and keeps facts display-only until reconnect resynchronizes', async () => {
    const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
    await waitFor(() => expect(hook.result.current.transportAvailable).toBe(true));
    await emit({ pluginID: 'plugin', registrationID: 'one', supported: true, transportAvailable: false });
    expect(hook.result.current.snapshot?.revision).toBe('1');
    expect(readCurrentConnectionMetadataString(hook.result.current.snapshot, hook.result.current.transportAvailable, 'version')).toBeUndefined();
    const resync = deferred<ConnectionMetadataEnvelope>();
    transport.get.mockReturnValueOnce(resync.promise);
    await emit({ pluginID: 'plugin', registrationID: 'two', supported: true, transportAvailable: true });
    expect(hook.result.current.snapshot).toBeUndefined();
    expect(hook.result.current.transportAvailable).toBe(false);
    await emit(envelope('999', 'cluster', 'one'));
    expect(hook.result.current.snapshot).toBeUndefined();
    await act(async () => resync.resolve(envelope('1', 'cluster', 'two')));
    expect(hook.result.current.transportAvailable).toBe(true);
    expect(hook.result.current.snapshot?.revision).toBe('1');
  });

  it('orders removal tombstones and preserves unchanged entry identity', async () => {
    const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
    await waitFor(() => expect(hook.result.current.snapshot).toBeDefined());
    const entry = hook.result.current.snapshot!.entries.version;
    const next = envelope('2');
    next.snapshot!.entries.version = { ...entry };
    await emit(next);
    expect(hook.result.current.snapshot!.entries.version).toBe(entry);
    await emit({ ...envelope('3'), removed: true });
    expect(hook.result.current.snapshot).toBeUndefined();
    await emit(envelope('2'));
    expect(hook.result.current.snapshot).toBeUndefined();
    await emit(envelope('4'));
    expect(hook.result.current.snapshot?.revision).toBe('4');
  });

  it('distinguishes unsupported, empty, and failed reads', async () => {
    transport.get.mockResolvedValueOnce({ pluginID: 'plugin', registrationID: 'one', supported: false, transportAvailable: true });
    const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
    await waitFor(() => expect(hook.result.current.supported).toBe(false));
    await act(async () => hook.result.current.refresh());
    expect(transport.refresh).not.toHaveBeenCalled();
    hook.unmount();
    const empty = envelope();
    empty.snapshot!.entries = {};
    transport.get.mockResolvedValueOnce(empty);
    const second = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
    await waitFor(() => expect(second.result.current.snapshot?.entries).toEqual({}));
    expect(second.result.current.supported).toBe(true);
    const failure = new Error('transport lost');
    transport.refresh.mockRejectedValueOnce(failure);
    await act(async () => second.result.current.refresh());
    expect(second.result.current.error).toBe(failure);
    expect(second.result.current.transportAvailable).toBe(true);
    expect(second.result.current.snapshot?.entries).toEqual({});
  });

  it('preserves available transport for provider-wide unsupported metadata', async () => {
    const unsupported: ConnectionMetadataEnvelope = { pluginID: 'plugin', registrationID: 'one', supported: false, transportAvailable: true };
    transport.get.mockResolvedValueOnce(unsupported);
    const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
    await waitFor(() => expect(hook.result.current.supported).toBe(false));
    await emit(unsupported);
    expect(hook.result.current.transportAvailable).toBe(true);
    expect(hook.result.current.isLoading).toBe(false);
    expect(hook.result.current.error).toBeUndefined();
    await act(async () => hook.result.current.refresh());
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(transport.refresh).not.toHaveBeenCalled();
  });

  it('ignores a pending request rejection after a newer accepted watch event', async () => {
    const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
    await waitFor(() => expect(hook.result.current.transportAvailable).toBe(true));
    const delayed = deferred<ConnectionMetadataEnvelope>();
    transport.refresh.mockReturnValueOnce(delayed.promise);
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.refresh(); });
    await waitFor(() => expect(transport.refresh).toHaveBeenCalledTimes(1));
    await emit(envelope('2'));
    await act(async () => {
      delayed.reject(new Error('late request failure'));
      await pending;
    });
    expect(hook.result.current.snapshot?.revision).toBe('2');
    expect(hook.result.current.transportAvailable).toBe(true);
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.isLoading).toBe(false);
  });

  it.each(['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED', 'UNAVAILABLE', 'CONNECTION_ERROR', 'INTERNAL'])('keeps live watch transport available after a %s unary error', async code => {
    const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
    await waitFor(() => expect(hook.result.current.transportAvailable).toBe(true));
    const snapshot = hook.result.current.snapshot;
    const failure = new Error(JSON.stringify({ code, title: 'Operation failed', message: 'Connection request failed.' }));
    transport.refresh.mockRejectedValueOnce(failure);
    await act(async () => hook.result.current.refresh());
    expect(hook.result.current.error).toBe(failure);
    expect(hook.result.current.snapshot).toBe(snapshot);
    expect(hook.result.current.transportAvailable).toBe(true);
    expect(hook.result.current.isLoading).toBe(false);
    expect(readCurrentConnectionMetadataString(hook.result.current.snapshot, hook.result.current.transportAvailable, 'version')).toBe('1');
    await emit(envelope('2'));
    expect(hook.result.current.snapshot?.revision).toBe('2');
    expect(hook.result.current.error).toBeUndefined();
    expect(hook.result.current.transportAvailable).toBe(true);
    expect(transport.get).toHaveBeenCalledTimes(1);
  });

  it('does not invoke a deferred get after the last listener leaves', async () => {
    const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
    hook.unmount();
    await act(async () => {});
    expect(transport.get).not.toHaveBeenCalled();
    expect(transport.refresh).not.toHaveBeenCalled();
  });

  it('does not invoke a deferred refresh after the last listener leaves', async () => {
    const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
    await waitFor(() => expect(hook.result.current.transportAvailable).toBe(true));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.refresh();
      hook.unmount();
    });
    await act(async () => { await pending; });
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(transport.refresh).not.toHaveBeenCalled();
  });

  it('does not invoke a deferred get from a retired transport epoch', async () => {
    const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
    act(() => {
      transport.listener?.({ data: { pluginID: 'plugin', registrationID: 'one', supported: true, transportAvailable: false } });
    });
    await act(async () => {});
    expect(transport.get).not.toHaveBeenCalled();
    expect(hook.result.current.transportAvailable).toBe(false);
    expect(hook.result.current.isLoading).toBe(false);
  });

  it('does not invoke a deferred refresh from a retired transport epoch', async () => {
    const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
    await waitFor(() => expect(hook.result.current.transportAvailable).toBe(true));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.refresh();
      transport.listener?.({ data: { pluginID: 'plugin', registrationID: 'one', supported: true, transportAvailable: false } });
    });
    await act(async () => { await pending; });
    expect(transport.refresh).not.toHaveBeenCalled();
    expect(hook.result.current.transportAvailable).toBe(false);
    expect(hook.result.current.isLoading).toBe(false);
  });
});

it('tracks changing inventories with stable shared snapshots and removes unused subscriptions', async () => {
  transport.get.mockImplementation((_plugin: string, id: string) => Promise.resolve(envelope('1', id)));
  const hook = renderHook(({ ids }) => useConnectionMetadataConnections('plugin', ids), { initialProps: { ids: ['a', 'b'] } });
  await waitFor(() => expect(hook.result.current.get('b')?.snapshot?.connectionID).toBe('b'));
  const previous = hook.result.current;
  hook.rerender({ ids: ['a', 'b'] });
  expect(hook.result.current).toBe(previous);
  hook.rerender({ ids: ['b'] });
  expect(hook.result.current.has('a')).toBe(false);
  await emit(envelope('2', 'a'));
  expect(hook.result.current.has('a')).toBe(false);
  await emit(envelope('2', 'b'));
  expect(hook.result.current.get('b')?.snapshot?.revision).toBe('2');
});

it('never interprets stale, unavailable, inactive, null, or numeric entries as current strings', () => {
  const snapshot = envelope().snapshot!;
  snapshot.entries = {
    current: { state: 'current', value: 'v1', observedAt: '2026-10-31T00:00:00Z' },
    stale: { state: 'stale', value: 'v0', observedAt: '2026-10-30T00:00:00Z' },
    unavailable: { state: 'unavailable', error: { code: 'FAILED', message: 'Unavailable.' } },
    null: { state: 'current', value: null, observedAt: '2026-10-31T00:00:00Z' },
    number: { state: 'current', value: 1, observedAt: '2026-10-31T00:00:00Z' },
  };
  expect(readCurrentConnectionMetadataString(snapshot, true, 'current')).toBe('v1');
  for (const key of ['stale', 'unavailable', 'null', 'number', 'absent']) {
    expect(readCurrentConnectionMetadataString(snapshot, true, key)).toBeUndefined();
  }
  snapshot.active = false;
  expect(readCurrentConnectionMetadataString(snapshot, true, 'current')).toBeUndefined();
});

it('makes disabled reads and retired route refresh actions inert', async () => {
  const initialProps: { id: string | undefined } = { id: undefined };
  const hook = renderHook(({ id }: { id: string | undefined }) => useConnectionMetadata('plugin', id), { initialProps });
  expect(hook.result.current.supported).toBeUndefined();
  await act(async () => hook.result.current.refresh());
  expect(transport.get).not.toHaveBeenCalled();
  expect(transport.refresh).not.toHaveBeenCalled();
  hook.rerender({ id: 'cluster' });
  await waitFor(() => expect(hook.result.current.snapshot).toBeDefined());
  const retiredRefresh = hook.result.current.refresh;
  hook.rerender({ id: undefined });
  await act(async () => retiredRefresh());
  expect(transport.refresh).not.toHaveBeenCalled();
  expect(hook.result.current.snapshot).toBeUndefined();
});

it('does not rerender a selected entry when unrelated metadata changes', async () => {
  let renders = 0;
  const hook = renderHook(() => {
    renders++;
    return useConnectionMetadataSelector('plugin', 'cluster', state => state.snapshot?.entries.version);
  });
  await waitFor(() => expect(hook.result.current?.state).toBe('current'));
  const count = renders;
  const selected = hook.result.current;
  const unrelated = envelope('2');
  unrelated.snapshot!.entries.version = { ...envelope().snapshot!.entries.version };
  unrelated.snapshot!.entries.platform = { state: 'current', value: 'linux/arm64', observedAt: '2026-10-31T00:00:00Z' };
  await emit(unrelated);
  expect(hook.result.current).toBe(selected);
  expect(renders).toBe(count);
  await emit(envelope('3'));
  expect(hook.result.current).not.toBe(selected);
  expect(renders).toBeGreaterThan(count);
});

it('uses plugin context identity instead of an explicit upstream plugin name', async () => {
  transport.get.mockImplementation((pluginID: string, id: string) => Promise.resolve({ ...envelope('1', id), pluginID }));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PluginContext.Provider value={{ pluginId: 'plugin-dev', meta: {} as never, settings: {} }}>{children}</PluginContext.Provider>
  );
  const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'), { wrapper });
  await waitFor(() => expect(hook.result.current.snapshot).toBeDefined());
  expect(transport.get).toHaveBeenCalledWith('plugin-dev', 'cluster');
});

it('recovers equal-revision replay only after a connection-scoped read resynchronizes', async () => {
  const hook = renderHook(() => useConnectionMetadata('plugin', 'cluster'));
  await waitFor(() => expect(hook.result.current.transportAvailable).toBe(true));
  const snapshot = hook.result.current.snapshot;
  await emit({ pluginID: 'plugin', registrationID: 'one', supported: true, transportAvailable: false });
  const resync = deferred<ConnectionMetadataEnvelope>();
  transport.get.mockReturnValueOnce(resync.promise);
  await emit(envelope('1'));
  expect(hook.result.current.transportAvailable).toBe(false);
  expect(hook.result.current.snapshot).toBe(snapshot);
  await act(async () => resync.resolve(envelope('1')));
  expect(hook.result.current.transportAvailable).toBe(true);
  expect(hook.result.current.snapshot).toBe(snapshot);
  expect(transport.refresh).not.toHaveBeenCalled();
});

it('updates a selector without losing shared entry identity', async () => {
  const initial = envelope();
  initial.snapshot!.entries.platform = { state: 'current', value: 'linux/arm64', observedAt: '2026-10-31T00:00:00Z' };
  transport.get.mockResolvedValueOnce(initial);
  const hook = renderHook(({ entry }) => useConnectionMetadataSelector('plugin', 'cluster', state => state.snapshot?.entries[entry]), {
    initialProps: { entry: 'version' },
  });
  await waitFor(() => expect(hook.result.current?.state).toBe('current'));
  const version = hook.result.current;
  hook.rerender({ entry: 'platform' });
  expect(hook.result.current).toBe(initial.snapshot!.entries.platform);
  const platform = hook.result.current;
  hook.rerender({ entry: 'platform' });
  expect(hook.result.current).toBe(platform);
  hook.rerender({ entry: 'version' });
  expect(hook.result.current).toBe(version);
  expect(transport.get).toHaveBeenCalledTimes(1);
});
