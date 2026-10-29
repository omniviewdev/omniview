import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { WatchState } from '../../types/watch';
import type * as WailsRuntime from '@wailsio/runtime';

const mocks = vi.hoisted(() => ({
  phase: 'disconnected',
  generation: 1,
  readinessListeners: new Set<() => void>(),
  readiness: vi.fn(),
  requireReady: vi.fn(),
  list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  types: vi.fn(), groups: vi.fn(), namespaces: vi.fn(), schemas: vi.fn(), actions: vi.fn(), execute: vi.fn(),
  subscribe: vi.fn(), unsubscribe: vi.fn(), snackbar: vi.fn(),
  listeners: new Map<string, Set<(event: { data: unknown }) => void>>(),
}));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: (explicit?: string) => explicit ?? 'kubernetes' }));
vi.mock('../connection/useConnectionReadiness', () => ({
  useConnectionReadiness: (options: unknown) => { mocks.readiness(options); return { phase: mocks.phase }; },
}));
vi.mock('../../connection/connectionReadiness', () => ({
  requireConnectionReady: mocks.requireReady,
  getConnectionReadinessGeneration: () => mocks.generation,
  isConnectionReadinessCurrent: (_pluginID: string, _connectionID: string, generation: number) =>
    mocks.phase === 'connected' && generation === mocks.generation,
  connectionReadinessStore: () => ({
    subscribe: (listener: () => void) => {
      mocks.readinessListeners.add(listener);
      return () => { mocks.readinessListeners.delete(listener); };
    },
  }),
}));
vi.mock('../snackbar/useSnackbar', () => ({ useSnackbar: () => ({ showSnackbar: mocks.snackbar }) }));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper', () => ({
  List: mocks.list, Get: mocks.get, Create: mocks.create, Update: mocks.update, Delete: mocks.remove,
  GetResourceTypes: mocks.types, GetResourceGroups: mocks.groups, GetConnectionNamespaces: mocks.namespaces,
  GetEditorSchemas: mocks.schemas, GetActions: mocks.actions, ExecuteAction: mocks.execute,
  SubscribeResource: mocks.subscribe, UnsubscribeResource: mocks.unsubscribe,
}));
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof WailsRuntime>();
  return { ...actual, Events: {
    On: (name: string, callback: (event: { data: unknown }) => void) => {
      const callbacks = mocks.listeners.get(name) ?? new Set();
      callbacks.add(callback);
      mocks.listeners.set(name, callbacks);
      return () => { callbacks.delete(callback); };
    },
  } };
});

import { useResources } from './useResources';
import { useResource } from './useResource';
import { useResourceTypes } from './useResourceTypes';
import { useResourceGroups } from './useResourceGroups';
import { useEditorSchemas } from './useEditorSchemas';
import { useResourceSearch } from './useResourceSearch';
import { useResourceActions, useExecuteAction } from './useResourceActions';
import { useResourceMutations } from './useResourceMutations';
import { useConnectionNamespaces } from '../connection/useConnectionNamespaces';

const options = { pluginID: 'kubernetes', connectionID: 'arn:aws:eks:us-east-1:123:cluster/team/name', resourceKey: 'core::v1::Pod' };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return {
    client,
    wrapper: ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.phase = 'disconnected';
  mocks.listeners.clear();
  mocks.generation = 1;
  mocks.readinessListeners.clear();
  mocks.requireReady.mockImplementation(async () => {
    if (mocks.phase !== 'connected') throw new Error('Connection is disconnected');
  });
  mocks.list.mockResolvedValue({ result: [] });
  mocks.get.mockResolvedValue({ result: {} });
  for (const mock of [mocks.types, mocks.groups, mocks.namespaces, mocks.schemas, mocks.actions]) mock.mockResolvedValue([]);
  mocks.subscribe.mockResolvedValue(undefined);
  mocks.unsubscribe.mockResolvedValue(undefined);
});

afterEach(() => { vi.useRealTimers(); });

it('blocks connection queries and subscriptions until connected, then releases subscriptions on disconnect', async () => {
  const { wrapper } = setup();
  const { rerender } = renderHook(() => {
    useResource({ ...options, resourceID: 'pod' });
    useResourceTypes(options);
    useResourceGroups(options);
    useConnectionNamespaces(options);
    useEditorSchemas(options);
    useResourceActions(options);
    useResourceSearch({ ...options, searches: [{ key: 'apps::v1::Deployment', namespaces: [] }] });
    return useResources({ ...options, idAccessor: 'metadata.name' });
  }, { wrapper });
  const queries = [mocks.list, mocks.get, mocks.types, mocks.groups, mocks.namespaces, mocks.schemas, mocks.actions];
  for (const query of queries) expect(query).not.toHaveBeenCalled();
  expect(mocks.subscribe).not.toHaveBeenCalled();
  expect(mocks.listeners.size).toBe(0);

  mocks.phase = 'connected';
  rerender();
  await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledWith(options.pluginID, options.connectionID, options.resourceKey));
  for (const query of queries) expect(query).toHaveBeenCalled();
  expect(mocks.readiness).toHaveBeenCalledWith({ pluginID: options.pluginID, connectionID: options.connectionID, enabled: true });

  mocks.phase = 'disconnected';
  rerender();
  await waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalledWith(options.pluginID, options.connectionID, options.resourceKey));
  for (const callbacks of mocks.listeners.values()) expect(callbacks.size).toBe(0);
});

it('does not reuse a previous watch sync state after reconnecting', () => {
  mocks.phase = 'connected';
  const { wrapper } = setup();
  const { result, rerender } = renderHook(() => useResources(options), { wrapper });
  act(() => {
    for (const listener of mocks.listeners.get(`${options.pluginID}/${options.connectionID}/watch/STATE`) ?? []) {
      listener({ data: { resourceKey: options.resourceKey, state: WatchState.WatchStateSynced } });
    }
  });
  expect(result.current.isSynced).toBe(true);
  mocks.phase = 'disconnected';
  rerender();
  expect(result.current.watchState).toBe(WatchState.WatchStateIdle);
  mocks.phase = 'connected';
  rerender();
  expect(result.current.watchState).toBe(WatchState.WatchStateIdle);
  expect(result.current.isSynced).toBe(false);
});

it('keeps explicitly disabled hooks out of readiness and subscription work even when connected', async () => {
  mocks.phase = 'connected';
  const { wrapper } = setup();
  const { result } = renderHook(() => {
    const disabled = { ...options, enabled: false };
    useResource({ ...disabled, resourceID: 'pod' });
    useResourceTypes(disabled);
    useResourceGroups(disabled);
    useConnectionNamespaces(disabled);
    useEditorSchemas(disabled);
    useResourceActions(disabled);
    useResourceSearch({ ...disabled, searches: [{ key: 'apps::v1::Deployment', namespaces: [] }] });
    return useResources({ ...disabled, idAccessor: 'metadata.name' });
  }, { wrapper });
  expect(mocks.readiness.mock.calls.every(([value]) => value.enabled === false)).toBe(true);
  expect(mocks.subscribe).not.toHaveBeenCalled();
  expect(mocks.listeners.size).toBe(0);
  // Manual refetch cannot bypass the disabled query function.
  await act(async () => { await result.current.resources.refetch(); });
  for (const query of [mocks.list, mocks.get, mocks.types, mocks.groups, mocks.namespaces, mocks.schemas, mocks.actions]) {
    expect(query).not.toHaveBeenCalled();
  }
});

it('waits for a pending subscription before cleanup and reacquisition', async () => {
  mocks.phase = 'connected';
  const { promise, resolve: subscribed } = Promise.withResolvers<void>();
  mocks.subscribe.mockReturnValueOnce(promise);
  const { wrapper } = setup();
  const { rerender } = renderHook(() => useResources({ ...options, idAccessor: 'metadata.name' }), { wrapper });
  await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(1));
  mocks.phase = 'disconnected';
  rerender();
  expect(mocks.unsubscribe).not.toHaveBeenCalled();
  for (const callbacks of mocks.listeners.values()) expect(callbacks.size).toBe(0);
  mocks.phase = 'connected';
  rerender();
  expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  await act(async () => { subscribed(); });
  await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(2));
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  expect(mocks.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(mocks.subscribe.mock.invocationCallOrder[1]);
});

it('discards buffered watch updates when disconnected', async () => {
  mocks.phase = 'connected';
  const { wrapper, client } = setup();
  const { rerender } = renderHook(() => useResources({ ...options, idAccessor: 'metadata.name' }), { wrapper });
  await waitFor(() => expect(mocks.subscribe).toHaveBeenCalled());
  const key = resourceQueryKeys.list(options.pluginID, options.connectionID, options.resourceKey, []);
  await waitFor(() => expect(client.getQueryData(key)).toEqual({ result: [] }));
  act(() => {
    for (const callback of mocks.listeners.get(`${options.pluginID}/${options.connectionID}/watch/STATE`) ?? []) {
      callback({ data: { resourceKey: options.resourceKey, state: 1 } });
    }
  });
  vi.useFakeTimers();
  act(() => {
    for (const callback of mocks.listeners.get(`${options.pluginID}/${options.connectionID}/${options.resourceKey}/ADD`) ?? []) {
      callback({ data: { id: 'late-pod', namespace: 'default', data: { metadata: { name: 'late-pod' } } } });
    }
  });
  mocks.phase = 'disconnected';
  rerender();
  act(() => { vi.advanceTimersByTime(1000); });
  expect(client.getQueryData(key)).toEqual({ result: [] });
});

it('surfaces subscribe and unsubscribe failures instead of leaving unhandled rejections', async () => {
  mocks.phase = 'connected';
  mocks.subscribe.mockRejectedValueOnce(new Error('Subscribe failed'));
  const first = renderHook(() => useResources({ ...options, idAccessor: 'metadata.name' }), setup());
  await waitFor(() => expect(first.result.current.watchError).toBe(true));
  expect(mocks.snackbar).toHaveBeenCalled();
  expect(mocks.listeners.get(`${options.pluginID}/${options.connectionID}/${options.resourceKey}/ADD`)?.size).toBe(0);
  expect(mocks.listeners.get(`${options.pluginID}/${options.connectionID}/${options.resourceKey}/UPDATE`)?.size).toBe(0);
  expect(mocks.listeners.get(`${options.pluginID}/${options.connectionID}/${options.resourceKey}/DELETE`)?.size).toBe(0);
  first.unmount();
  mocks.unsubscribe.mockRejectedValueOnce(new Error('Unsubscribe failed'));
  const second = renderHook(() => useResources({ ...options, idAccessor: 'metadata.name' }), setup());
  await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(2));
  second.unmount();
  await waitFor(() => expect(mocks.snackbar).toHaveBeenCalledTimes(2));
});

it('guards every resource mutation before sending backend calls', async () => {
  const { wrapper } = setup();
  const { result } = renderHook(() => ({
    list: useResources({ ...options, enabled: false }),
    resource: useResource({ ...options, resourceID: 'pod', enabled: false }),
    mutations: useResourceMutations({ pluginID: options.pluginID }),
    action: useExecuteAction(options),
  }), { wrapper });
  const opts = { connectionID: options.connectionID, resourceKey: options.resourceKey, resourceID: 'pod' };
  await act(async () => {
    for (const mutation of [
      () => result.current.list.create({ input: {} }),
      () => result.current.resource.update({ input: {} }),
      () => result.current.resource.remove({}),
      () => result.current.mutations.create({ opts, input: { input: {} } }),
      () => result.current.mutations.update({ opts, input: { input: {} } }),
      () => result.current.mutations.remove({ opts, input: {} }),
      () => result.current.action.executeAction({ actionID: 'restart' }),
    ]) await expect(mutation()).rejects.toThrow('Connection is disconnected');
  });
  expect(mocks.requireReady).toHaveBeenCalledTimes(7);
  expect(mocks.requireReady).toHaveBeenCalledWith(options.pluginID, options.connectionID);
  for (const mutation of [mocks.create, mocks.update, mocks.remove, mocks.execute]) expect(mutation).not.toHaveBeenCalled();
});

it('separates resource-group caches by full connection ID', async () => {
  mocks.phase = 'connected';
  mocks.groups.mockImplementation((_pluginID: string, connectionID: string) => Promise.resolve([{ id: connectionID }]));
  const { result } = renderHook(() => ({
    first: useResourceGroups(options),
    second: useResourceGroups({ ...options, connectionID: `${options.connectionID}/second` }),
  }), setup());
  await waitFor(() => expect(result.current.first.groups.data).toEqual([{ id: options.connectionID }]));
  expect(result.current.second.groups.data).toEqual([{ id: `${options.connectionID}/second` }]);
});

it('cancels detached in-flight reads immediately and rejects late data after reconnect', async () => {
  mocks.phase = 'connected';
  const { promise, resolve } = Promise.withResolvers<{ result: string[] }>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  mocks.list.mockReturnValueOnce(Object.assign(promise, { cancel }));
  const { wrapper, client } = setup();
  const { result, rerender } = renderHook(() => useResources(options), { wrapper });
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
  expect(mocks.readinessListeners.size).toBe(1);

  act(() => {
    mocks.phase = 'disconnected';
    mocks.generation++;
    for (const listener of mocks.readinessListeners) listener();
  });
  // Cancellation happens in the lifecycle listener, before a React rerender.
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(mocks.readinessListeners.size).toBe(0);
  const key = resourceQueryKeys.list(options.pluginID, options.connectionID, options.resourceKey, []);
  expect(client.getQueryData(key)).toBeUndefined();
  rerender();

  mocks.list.mockResolvedValue({ result: ['fresh'] });
  mocks.phase = 'connected';
  rerender();
  await waitFor(() => expect(result.current.resources.data).toEqual({ result: ['fresh'] }));
  await act(async () => { resolve({ result: ['stale'] }); });
  expect(client.getQueryData(key)).toEqual({ result: ['fresh'] });
});

it('cancels native reads and releases lifecycle listeners when detached consumers unmount', async () => {
  mocks.phase = 'connected';
  const { promise, resolve } = Promise.withResolvers<{ result: string[] }>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  mocks.list.mockReturnValueOnce(Object.assign(promise, { cancel }));
  const { wrapper, client } = setup();
  const { unmount } = renderHook(() => useResources(options), { wrapper });
  await waitFor(() => expect(mocks.list).toHaveBeenCalled());
  unmount();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(mocks.readinessListeners.size).toBe(0);
  await act(async () => { resolve({ result: ['stale'] }); });
  expect(client.getQueryData(resourceQueryKeys.list(options.pluginID, options.connectionID, options.resourceKey, []))).toBeUndefined();
});
