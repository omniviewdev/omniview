import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { connectionListQueryKey } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import type * as RuntimeAPI from '@omniviewdev/runtime/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reloadConnections } from './commands';

const native = vi.hoisted(() => ({ load: vi.fn(), list: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeAPI>();
  return {
    ...actual,
    ResourceClient: { ...actual.ResourceClient, LoadConnections: native.load, ListConnections: native.list },
  };
});

afterEach(() => {
  native.load.mockReset();
  native.list.mockReset();
});

describe('closed reload-connections existing query integration', () => {
  it('refreshes the actual active useConnections key from the merged host list without dropping user-created connections', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const key = connectionListQueryKey('probe');
    const other = connectionListQueryKey('other');
    client.setQueryData(key, [{ id: 'created', name: 'User-created connection' }]);
    client.setQueryData(other, [{ id: 'unrelated' }]);
    native.load.mockResolvedValue([{ id: 'local', name: 'Private native tasks' }]);
    native.list.mockResolvedValue([
      { id: 'created', name: 'User-created connection' },
      { id: 'local', name: 'Private native tasks' },
    ]);
    const observed: unknown[] = [];
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => ResourceClient.ListConnections('probe'),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe((result) => observed.push(result.data));
    await reloadConnections(client, 'probe');
    expect(native.load).toHaveBeenCalledExactlyOnceWith('probe');
    expect(native.list).toHaveBeenCalledExactlyOnceWith('probe');
    expect(client.getQueryData(key)).toEqual([
      { id: 'created', name: 'User-created connection' },
      { id: 'local', name: 'Private native tasks' },
    ]);
    expect(observed.length).toBeGreaterThan(0);
    expect(
      observed.every((data) => Array.isArray(data) && data.some((connection) => connection.id === 'created')),
    ).toBe(true);
    expect(client.getQueryData(other)).toEqual([{ id: 'unrelated' }]);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    unsubscribe();
    client.clear();
  });

  it('invalidates an inactive list for its next consumer without replacing it with a discovery-only subset', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const key = connectionListQueryKey('probe');
    client.setQueryData(key, [{ id: 'created' }]);
    native.load.mockResolvedValue([{ id: 'local' }]);
    await reloadConnections(client, 'probe');
    expect(client.getQueryData(key)).toEqual([{ id: 'created' }]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(native.list).not.toHaveBeenCalled();
    client.clear();
  });

  it('preserves a real native rejection without clearing or presenting a successful frontend list', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const key = connectionListQueryKey('probe');
    client.setQueryData(key, [{ id: 'existing' }]);
    const denied = new Error('native service denial');
    native.load.mockRejectedValue(denied);
    await expect(reloadConnections(client, 'probe')).rejects.toBe(denied);
    expect(client.getQueryData(key)).toEqual([{ id: 'existing' }]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    client.clear();
  });
});
