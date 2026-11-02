import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CancellablePromise } from '@wailsio/runtime/cancellable';
import { useResources } from './useResources';
import { useResolvedResourceTarget } from './useResolvedResourceTarget';
import { useResource } from './useResource';
import { useResourceGroups } from './useResourceGroups';
import { useResourceMutations } from './useResourceMutations';
import { useExecuteAction } from './useResourceActions';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import type { ActionRequest, MutationRequest } from '../../resource/v2/domain';
import type { HostEnumerateRequest, HostRecord, HostSourceStatus, HostSourcePage, ResourceView, ResolvedResourceTarget } from '../../resource/v2/host';
const native = vi.hoisted(() => ({
  enumerate: vi.fn(), open: vi.fn(), phase: 'connected', generation: 1,
  listeners: new Set<() => void>(),
  resolveTarget: vi.fn(), get: vi.fn(), groups: vi.fn(), mutate: vi.fn(), action: vi.fn(), requireReady: vi.fn(),
}));
vi.mock('../../resource/v2/client', () => ({ Enumerate: native.enumerate, ResolveTarget: native.resolveTarget,
  Get: native.get, GetResourceGroups: native.groups, Mutate: native.mutate, Action: native.action }));
vi.mock('../../resource/v2/sourceView', () => ({ openSourceView: native.open }));
vi.mock('../snackbar/useSnackbar', () => ({ useSnackbar: () => ({ showSnackbar: vi.fn() }) }));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: (id?: string) => id ?? 'provider' }));
vi.mock('../connection/useConnectionReadiness', () => ({ useConnectionReadiness: () => ({ phase: native.phase }) }));
vi.mock('../../connection/connectionReadiness', () => ({
  requireConnectionReady: native.requireReady,
  getConnectionReadinessGeneration: () => native.generation,
  isConnectionReadinessCurrent: (_plugin: string, _connection: string, generation: number) => native.phase === 'connected' && generation === native.generation,
  connectionReadinessStore: () => ({ subscribe: (listener: () => void) => {
    native.listeners.add(listener);
    return () => { native.listeners.delete(listener); };
  } }),
}));

const request: HostEnumerateRequest = { targetId: 'target', request: { target: {
  route: { connection: 'c' }, provider: 'provider', authority: 'authority', type: 'items', scope: [], representation: 'raw',
}, pageSize: 1 } };
const row: HostRecord = { key: 'one', addressKey: 'one', targetId: 'target', route: { connection: 'c' }, record: {
  reference: { address: { provider: 'provider', authority: 'authority', type: 'items', id: 'one', scope: [] } },
  coverage: { kind: 'complete', paths: [] }, body: { kind: 'uint64', value: '18446744073709551615' }, representation: { id: 'raw', revision: 'r', schema: { state: 'absent' } },
} };
const page: ResourceView = { records: [row], sourcePage: { nextCursor: 'next', count: { kind: 'unknown' }, coverage: { kind: 'partial', paths: [] }, consistency: 'bestEffort' } };
const next = { ...request, request: { ...request.request, cursor: 'next' } };
const status = (state: HostSourceStatus['state']): HostSourceStatus => ({ state, mode: 'snapshotAndUpdates', continuity: 'bestEffort', count: { kind: 'exact', value: '1' } });

function source() {
  let snapshot: { viewGeneration?: string; records: ReadonlyMap<string, HostRecord>; status?: HostSourceStatus; complete: boolean } = {
    records: new Map(), status: status('opening'), complete: false,
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: vi.fn().mockResolvedValue(undefined), close: vi.fn(),
    publish(nextSnapshot: typeof snapshot) { snapshot = nextSnapshot; for (const listener of listeners) listener(); },
  };
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return { client, wrapper: ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children) };
}
function ready<T>(value: T) { return new CancellablePromise<T>((resolve) => resolve(value)); }
function denied<T>(message: string) { return new CancellablePromise<T>((_resolve, reject) => reject(new Error(message))); }

beforeEach(() => {
  vi.clearAllMocks(); native.phase = 'connected'; native.generation = 1; native.listeners.clear();
  native.enumerate.mockImplementation((_plugin: string, input: HostEnumerateRequest) => input.request.cursor ? denied('denied') : ready(page));
  native.requireReady.mockImplementation(async () => { if (native.phase !== 'connected') throw new Error('Connection is disconnected'); });
  native.get.mockImplementation(() => ready(row));
  native.groups.mockImplementation(() => ready([]));
  native.resolveTarget.mockImplementation(() => ready({ targetId: request.targetId, target: request.request.target, authority: { continuity: 'connectionLocal', limitations: [] }, catalogRevision: 'catalog-1' }));
});

it('waits for a complete collection snapshot, then applies source changes', async () => {
  const view = source(); native.open.mockResolvedValue(view);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), { wrapper });
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  expect(native.open).toHaveBeenCalledWith('provider', { targetId: 'target', target: request.request.target, updates: 'ifSupported' });
  expect(hook.result.current.resources.isPending).toBe(true);
  expect(native.enumerate).not.toHaveBeenCalled();
  act(() => view.publish({ viewGeneration: 'g1', records: new Map([['one', row]]), status: status('following'), complete: true }));
  await waitFor(() => expect(hook.result.current.acquired?.page.records).toEqual([row]));
  expect(hook.result.current.isLive).toBe(true);
  expect(hook.result.current.isSynced).toBe(true);
  expect(hook.result.current.view?.viewGeneration).toBe('g1');
  const changed = { ...row, key: 'two' };
  act(() => view.publish({ viewGeneration: 'g1', records: new Map([['two', changed]]), status: status('following'), complete: true }));
  await waitFor(() => expect(hook.result.current.resources.data?.records).toEqual([changed]));
  await act(async () => { await hook.result.current.resources.refetch(); await hook.result.current.refreshAcquiredPage(); });
  expect(view.refresh).toHaveBeenCalledTimes(2);
  hook.unmount(); await waitFor(() => expect(view.close).toHaveBeenCalledTimes(1)); client.clear();
});

it('shares a source view until its last observer unmounts', async () => {
  const view = source(); native.open.mockResolvedValue(view);
  const { client, wrapper } = setup();
  const a = renderHook(() => useResources({ pluginID: 'provider', request, collection: true, live: false }), { wrapper });
  const b = renderHook(() => useResources({ pluginID: 'provider', request, collection: true, live: false }), { wrapper });
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  expect(native.open.mock.calls[0][1].updates).toBe('none');
  act(() => view.publish({ viewGeneration: 'g', records: new Map([['one', row]]), status: status('finished'), complete: true }));
  await waitFor(() => expect(b.result.current.isSynced).toBe(true));
  expect(b.result.current.isLive).toBe(false);
  a.unmount(); expect(view.close).not.toHaveBeenCalled();
  b.unmount(); await waitFor(() => expect(view.close).toHaveBeenCalledTimes(1)); client.clear();
});

it('surfaces a failed source view open as a query error', async () => {
  native.open.mockRejectedValue(new Error('Plugin does not support source sessions.'));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), { wrapper });
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
  expect(hook.result.current.resources.error?.message).toBe('Plugin does not support source sessions.');
  expect(hook.result.current.isLive).toBe(false);
  hook.unmount(); client.clear();
});

it('closes a view that opens after its last observer unmounts', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof source>>(); native.open.mockReturnValue(pending.promise);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), { wrapper });
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  hook.unmount(); const view = source(); pending.resolve(view);
  await waitFor(() => expect(view.close).toHaveBeenCalledTimes(1)); client.clear();
});

it.each(['failed', 'closed'] as const)('rejects a complete initial snapshot with %s status', async (state) => {
  const view = source(); native.open.mockResolvedValue(view);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), { wrapper });
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  act(() => view.publish({ viewGeneration: 'g', records: new Map(), status: status(state), complete: true }));
  await waitFor(() => expect(hook.result.current.source?.state).toBe(state));
  expect(hook.result.current.sourceError).toBe(state === 'failed');
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
  expect(hook.result.current.acquired).toBeUndefined();
  hook.unmount(); client.clear();
});

it('uses one finite enumeration for explicit pages and retains the acquired page on failure', async () => {
  const { client, wrapper } = setup();
  const hook = renderHook((input: HostEnumerateRequest) => useResources({ pluginID: 'provider', request: input, live: true }), { wrapper, initialProps: request });
  await waitFor(() => expect(hook.result.current.acquired?.page).toEqual(page));
  expect(native.enumerate).toHaveBeenCalledTimes(1);
  expect(native.open).not.toHaveBeenCalled();
  hook.rerender(next);
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
  expect(hook.result.current.acquired).toEqual({ request, page });
  expect(hook.result.current.isAcquiredRequestCurrent).toBe(false);
  expect(hook.result.current.isLive).toBe(false);
  await act(async () => { await hook.result.current.refreshAcquiredPage(); });
  expect(native.enumerate).toHaveBeenLastCalledWith('provider', request);
  hook.unmount(); client.clear();
});

it('does not acquire while disabled or disconnected, and closes on retirement', async () => {
  const view = source(); native.open.mockResolvedValue(view); native.phase = 'disconnected';
  const { client, wrapper } = setup();
  const hook = renderHook(({ enabled }: { enabled: boolean }) => useResources({ pluginID: 'provider', request, collection: true, enabled }), { wrapper, initialProps: { enabled: true } });
  expect(native.open).not.toHaveBeenCalled();
  native.phase = 'connected'; hook.rerender({ enabled: false });
  expect(native.open).not.toHaveBeenCalled();
  hook.rerender({ enabled: true });
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  native.phase = 'disconnected'; native.generation++;
  act(() => { for (const listener of native.listeners) listener(); });
  hook.rerender({ enabled: true });
  await waitFor(() => expect(view.close).toHaveBeenCalledTimes(1));
  expect(hook.result.current.isLive).toBe(false);
  hook.unmount(); client.clear();
});

it('fences a cancelled page after reconnect', async () => {
  const pending = Promise.withResolvers<HostSourcePage>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.enumerate.mockReturnValueOnce(Object.assign(pending.promise, { cancel }));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request }), { wrapper });
  await waitFor(() => expect(native.enumerate).toHaveBeenCalledTimes(1));
  act(() => { native.phase = 'disconnected'; native.generation++; for (const listener of [...native.listeners]) listener(); });
  expect(cancel).toHaveBeenCalledTimes(1);
  hook.rerender();
  native.phase = 'connected'; hook.rerender();
  await waitFor(() => expect(hook.result.current.resources.data).toEqual(page));
  await act(async () => pending.resolve({ ...page, records: [] }));
  expect(client.getQueryData(resourceQueryKeys.list('provider', request))).toEqual(page);
  hook.unmount(); client.clear();
});

it('cancels an in-flight page on unmount', async () => {
  const pending = Promise.withResolvers<HostSourcePage>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.enumerate.mockReturnValueOnce(Object.assign(pending.promise, { cancel }));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request }), { wrapper });
  await waitFor(() => expect(native.enumerate).toHaveBeenCalledTimes(1));
  hook.unmount();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(native.listeners.size).toBe(0);
  await act(async () => pending.resolve(page));
  expect(client.getQueryData(resourceQueryKeys.list('provider', request))).toBeUndefined();
  client.clear();
});

it('keeps resolved targets hidden while replacement resolution fails', async () => {
  const { client, wrapper } = setup();
  const hook = renderHook(({ type }: { type: string }) => useResolvedResourceTarget({ pluginID: 'provider', route: { connection: 'c' }, type }), { wrapper, initialProps: { type: 'items' } });
  await waitFor(() => expect(hook.result.current.data?.targetId).toBe('target'));
  const pending = Promise.withResolvers<ResolvedResourceTarget>();
  native.resolveTarget.mockReturnValue(Object.assign(pending.promise, { cancel: vi.fn() }));
  hook.rerender({ type: 'other' });
  expect(hook.result.current.data).toBeUndefined();
  await act(async () => pending.reject(new Error('denied')));
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.data).toBeUndefined();
  hook.unmount(); client.clear();
});

it('guards mutations and actions while disconnected', async () => {
  native.phase = 'disconnected';
  const { client, wrapper } = setup();
  const getRequest = { targetId: request.targetId, request: { route: row.route, reference: row.record.reference, representation: 'raw' } };
  const hook = renderHook(() => ({
    resource: useResource({ pluginID: 'provider', request: getRequest, enabled: false }),
    mutations: useResourceMutations({ pluginID: 'provider' }),
    action: useExecuteAction({ pluginID: 'provider' }),
  }), { wrapper });
  const mutation: MutationRequest = { route: row.route, reference: row.record.reference, operation: 'create', input: { kind: 'map', value: {} } };
  const action: ActionRequest = { route: row.route, typeTarget: { provider: 'provider', authority: 'authority', type: 'items', scope: [] }, action: 'install', input: { kind: 'map', value: {} } };
  await act(async () => {
    await expect(hook.result.current.resource.mutate({ operation: 'mutationUpdate', input: mutation.input })).rejects.toThrow('Connection is disconnected');
    await expect(hook.result.current.mutations.mutate(mutation)).rejects.toThrow('Connection is disconnected');
    await expect(hook.result.current.action.executeAction(action)).rejects.toThrow('Connection is disconnected');
  });
  expect(native.mutate).not.toHaveBeenCalled();
  expect(native.action).not.toHaveBeenCalled();
  hook.unmount(); client.clear();
});

it('separates group caches by opaque route', async () => {
  native.groups.mockImplementation((_plugin: string, route: { connection: string }) => ready([{ id: route.connection }]));
  const { client, wrapper } = setup();
  const first = { connection: 'arn:aws:eks:region:account:cluster/team/name' };
  const second = { connection: `${first.connection}/second` };
  const hook = renderHook(() => ({
    first: useResourceGroups({ pluginID: 'provider', route: first }),
    second: useResourceGroups({ pluginID: 'provider', route: second }),
  }), { wrapper });
  await waitFor(() => expect(hook.result.current.first.groups.data).toEqual([{ id: first.connection }]));
  expect(hook.result.current.second.groups.data).toEqual([{ id: second.connection }]);
  hook.unmount(); client.clear();
});
