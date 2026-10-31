import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CancellablePromise } from '@wailsio/runtime/cancellable';
import { useResources, type AcquiredResourcePage } from './useResources';
import { useResolvedResourceTarget } from './useResolvedResourceTarget';
import type { HostEnumerateRequest, HostGetRequest, HostNativeQueryRequest, HostRecord, HostSourcePage, ResolvedResourceTarget } from '../../resource/v2/host';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { WatchState } from '../../types/watch';
import { useResource } from './useResource';
import { useResourceTypes } from './useResourceTypes';
import { useResourceGroups } from './useResourceGroups';
import { useEditorSchemas } from './useEditorSchemas';
import { useResourceSearch } from './useResourceSearch';
import { useResourceActions, useExecuteAction } from './useResourceActions';
import { useResourceMutations } from './useResourceMutations';
import { useScopeValues } from '../connection/useScopeValues';
import type { ActionRequest, MutationRequest } from '../../resource/v2/domain';

const native = vi.hoisted(() => ({
  enumerate: vi.fn(), resolveTarget: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), ensure: vi.fn(), state: vi.fn(),
  get: vi.fn(), catalog: vi.fn(), groups: vi.fn(), scopes: vi.fn(), schemas: vi.fn(), actions: vi.fn(), nativeQuery: vi.fn(), mutate: vi.fn(), action: vi.fn(), requireReady: vi.fn(), snackbar: vi.fn(),
  phase: 'connected', generation: 1, readinessListeners: new Set<() => void>(),
  listeners: new Map<string, (event: { data: unknown }) => void>(),
}));
vi.mock('../../resource/v2/client', () => ({
  Enumerate: native.enumerate, ResolveTarget: native.resolveTarget, SubscribeResource: native.subscribe, UnsubscribeResource: native.unsubscribe, EnsureResourceWatch: native.ensure, GetWatchState: native.state,
  Get: native.get, Catalog: native.catalog, GetResourceGroups: native.groups, ScopeValues: native.scopes, GetEditorSchemas: native.schemas, GetActions: native.actions, NativeQuery: native.nativeQuery, Mutate: native.mutate, Action: native.action,
}));
vi.mock('../connection/useConnectionReadiness', () => ({
  useConnectionReadiness: () => ({ phase: native.phase }),
}));
vi.mock('../../connection/connectionReadiness', () => ({
  requireConnectionReady: native.requireReady,
  getConnectionReadinessGeneration: () => native.generation,
  isConnectionReadinessCurrent: (_pluginID: string, _connectionID: string, generation: number) => native.phase === 'connected' && generation === native.generation,
  connectionReadinessStore: () => ({
    getSnapshot: () => ({ phase: native.phase }),
    subscribe: (listener: () => void) => {
      native.readinessListeners.add(listener);
      return () => { native.readinessListeners.delete(listener); };
    },
  }),
}));
vi.mock('../snackbar/useSnackbar', () => ({ useSnackbar: () => ({ showSnackbar: native.snackbar }) }));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: (id?: string) => id ?? 'provider' }));
vi.mock('@wailsio/runtime', () => ({ Events: { On: (topic: string, callback: (event: { data: unknown }) => void) => { native.listeners.set(topic, callback); return () => { if (native.listeners.get(topic) === callback) native.listeners.delete(topic); }; } } }));

const request: HostEnumerateRequest = { targetId: 'host-target', request: { target: {
  route: { connection: 'c' }, provider: 'provider', authority: 'authority', type: 'items', scope: [], representation: 'raw',
}, pageSize: 1 } };
const firstRow: HostRecord = { key: 'host-row', addressKey: 'host-address', targetId: 'host-target', route: { connection: 'c' }, record: {
  reference: { address: { provider: 'provider', authority: 'authority', type: 'items', id: 'one', scope: [] } },
  coverage: { kind: 'complete', paths: [] }, body: { kind: 'uint64', value: '18446744073709551615' }, representation: { id: 'raw', revision: 'r', schema: { state: 'absent', validation: 'none', unvalidated: [] } },
} };
const first: HostSourcePage = { records: [firstRow], sourcePage: { nextCursor: 'second', count: { kind: 'unknown' }, coverage: { kind: 'partial', paths: [] }, consistency: 'bestEffort' } };
const second: HostSourcePage = { records: [{ ...firstRow, key: 'host-row-two', addressKey: 'host-address-two', record: { ...firstRow.record, reference: { address: { ...firstRow.record.reference.address, id: 'two' } } } }], sourcePage: { ...first.sourcePage, nextCursor: 'third' } };
const nextRequest: HostEnumerateRequest = { ...request, request: { ...request.request, cursor: 'second' } };
const resolved: ResolvedResourceTarget = { targetId: request.targetId, target: request.request.target, authority: { continuity: 'connectionLocal', limitations: [] }, catalogRevision: 'catalog-1' };
interface HookProps { pluginID: string; request?: HostEnumerateRequest; live?: boolean; enabled?: boolean; collection?: boolean }

function ready<T>(value: T) { return new CancellablePromise<T>((resolve) => resolve(value)); }
function denied<T>(message: string) { return new CancellablePromise<T>((_resolve, reject) => reject(new Error(message))); }
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => { for (const callback of pending) callback(0); });
}
function setup(placeholder = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, ...(placeholder ? { placeholderData: (previous: unknown) => previous } : {}) } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}
beforeEach(() => {
  vi.clearAllMocks(); native.listeners.clear(); frames.clear(); nextFrame = 0;
  native.phase = 'connected'; native.generation = 1; native.readinessListeners.clear();
  native.requireReady.mockImplementation(async () => { if (native.phase !== 'connected') throw new Error('Connection is disconnected'); });
  native.get.mockImplementation(() => ready(firstRow));
  native.catalog.mockImplementation(() => ready({ provider: 'provider', types: [], revision: 'r', coverage: { kind: 'complete', paths: [] } }));
  for (const call of [native.groups, native.scopes, native.schemas, native.actions]) call.mockImplementation(() => ready([]));
  native.nativeQuery.mockImplementation(() => ready(first));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  native.enumerate.mockImplementation((_plugin: string, input: HostEnumerateRequest) => input.request.cursor ? denied<HostSourcePage>('later page denied') : ready(first));
  native.resolveTarget.mockImplementation(() => ready(resolved));
  native.subscribe.mockImplementation(() => ready(undefined));
  native.unsubscribe.mockImplementation(() => ready(undefined));
  native.ensure.mockImplementation(() => ready(undefined));
  native.state.mockImplementation(() => ready({ route: { connection: 'c' }, resources: { items: 2 }, resourceCounts: {}, scope: [], guarantee: 'bestEffort' }));
});
afterEach(() => vi.unstubAllGlobals());

it('merges every collection page and deduplicates canonical host keys', async () => {
  const updated = { ...firstRow, record: { ...firstRow.record, sourceRevision: 'new' } };
  native.enumerate.mockImplementation((_plugin: string, input: HostEnumerateRequest) => ready(input.request.cursor
    ? { ...second, records: [...second.records, updated], sourcePage: { ...second.sourcePage, nextCursor: undefined } }
    : first));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request: nextRequest, collection: true, live: false }), { wrapper });
  await waitFor(() => expect(hook.result.current.resources.isSuccess).toBe(true));
  expect(native.enumerate.mock.calls.map((call) => call[1].request.cursor)).toEqual([undefined, 'second']);
  expect(hook.result.current.resources.data?.records).toEqual([updated, ...second.records]);
  expect(hook.result.current.acquired?.page).toBe(hook.result.current.resources.data);
  expect(hook.result.current.acquired?.page.sourcePage.nextCursor).toBeUndefined();
  hook.unmount(); client.clear();
});

it('rejects a collection when a later source page fails without publishing partial rows', async () => {
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), { wrapper });
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
  expect(hook.result.current.resources.data).toBeUndefined();
  expect(hook.result.current.acquired).toBeUndefined();
  expect(native.subscribe).not.toHaveBeenCalled();
  hook.unmount(); client.clear();
});

it('maintains whole-collection membership from live add, update, and delete events', async () => {
  native.enumerate.mockImplementation(() => ready({ ...first, sourcePage: { ...first.sourcePage, nextCursor: undefined } }));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), { wrapper });
  await waitFor(() => expect(hook.result.current.isLive).toBe(true));
  const added = second.records[0];
  act(() => native.listeners.get('provider/c/items/ADD')?.({ data: { record: added } }));
  flushFrames();
  await waitFor(() => expect(hook.result.current.acquired?.page.records).toEqual([firstRow, added]));
  const updated = { ...added, record: { ...added.record, sourceRevision: 'new' } };
  act(() => {
    native.listeners.get('provider/c/items/UPDATE')?.({ data: { record: updated } });
    native.listeners.get('provider/c/items/DELETE')?.({ data: { targetId: request.targetId, key: firstRow.key } });
  });
  flushFrames();
  await waitFor(() => expect(hook.result.current.acquired?.page.records).toEqual([updated]));
  expect(hook.result.current.membershipStale).toBe(false);
  hook.unmount(); client.clear();
});

it('cancels a pending collection continuation on unmount', async () => {
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.enumerate.mockImplementation((_plugin: string, input: HostEnumerateRequest) => input.request.cursor
    ? Object.assign(new CancellablePromise<HostSourcePage>(() => {}), { cancel })
    : ready(first));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true, live: false }), { wrapper });
  await waitFor(() => expect(native.enumerate).toHaveBeenCalledTimes(2));
  expect(hook.result.current.acquired).toBeUndefined();
  hook.unmount();
  expect(cancel).toHaveBeenCalledTimes(1);
  client.clear();
});

it('discards collection continuation results after connection generation retirement', async () => {
  const pending = Promise.withResolvers<HostSourcePage>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.enumerate.mockImplementation((_plugin: string, input: HostEnumerateRequest) => input.request.cursor
    ? Object.assign(pending.promise, { cancel })
    : ready(first));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true, live: false }), { wrapper });
  await waitFor(() => expect(native.enumerate).toHaveBeenCalledTimes(2));
  act(() => {
    native.phase = 'disconnected';
    native.generation++;
    for (const listener of [...native.readinessListeners]) listener();
  });
  await act(async () => pending.resolve({ ...second, sourcePage: { ...second.sourcePage, nextCursor: undefined } }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(hook.result.current.acquired).toBeUndefined();
  expect(hook.result.current.resources.data).toBeUndefined();
  hook.unmount(); client.clear();
});

it('applies collection events received during refresh after all pages settle', async () => {
  native.enumerate.mockImplementation(() => ready({ ...first, sourcePage: { ...first.sourcePage, nextCursor: undefined } }));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), { wrapper });
  await waitFor(() => expect(hook.result.current.isLive).toBe(true));
  const pending = Promise.withResolvers<HostSourcePage>();
  native.enumerate.mockImplementationOnce(() => Object.assign(pending.promise, { cancel: vi.fn().mockResolvedValue(undefined) }));
  let refresh: Promise<unknown> | undefined;
  act(() => { refresh = hook.result.current.refreshAcquiredPage(); });
  act(() => native.listeners.get('provider/c/items/ADD')?.({ data: { record: second.records[0] } }));
  flushFrames();
  await act(async () => {
    pending.resolve({ ...first, sourcePage: { ...first.sourcePage, nextCursor: undefined } });
    await refresh;
  });
  await waitFor(() => expect(hook.result.current.acquired?.page.records).toEqual([firstRow, ...second.records]));
  hook.unmount(); client.clear();
});

it('retains a failed collection refresh error while applying live observations', async () => {
  native.enumerate.mockImplementation(() => ready({ ...first, sourcePage: { ...first.sourcePage, nextCursor: undefined } }));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), { wrapper });
  await waitFor(() => expect(hook.result.current.isLive).toBe(true));
  const pending = Promise.withResolvers<HostSourcePage>();
  native.enumerate.mockImplementationOnce(() => Object.assign(pending.promise, { cancel: vi.fn().mockResolvedValue(undefined) }));
  let refresh: Promise<unknown> | undefined;
  act(() => { refresh = hook.result.current.refreshAcquiredPage(); });
  act(() => native.listeners.get('provider/c/items/ADD')?.({ data: { record: second.records[0] } }));
  flushFrames();
  await act(async () => {
    pending.reject(new Error('refresh denied'));
    await refresh;
  });
  await waitFor(() => expect(hook.result.current.acquired?.page.records).toEqual([firstRow, ...second.records]));
  expect(hook.result.current.resources.isError).toBe(true);
  expect(hook.result.current.resources.error?.message).toBe('refresh denied');
  act(() => native.listeners.get('provider/c/items/DELETE')?.({ data: { key: firstRow.key, targetId: request.targetId } }));
  flushFrames();
  await waitFor(() => expect(hook.result.current.acquired?.page.records).toEqual(second.records));
  expect(hook.result.current.resources.error?.message).toBe('refresh denied');
  hook.unmount(); client.clear();
});

it('retains the actual acquired request and page after a different source cursor fails', async () => {
  const { client, wrapper } = setup(true);
  const hook = renderHook((props: HookProps) => useResources(props), { wrapper, initialProps: { pluginID: 'provider', request, live: false } });
  await waitFor(() => expect(hook.result.current.acquired?.page).toEqual(first));
  expect(hook.result.current.isAcquiredRequestCurrent).toBe(true);
  expect(native.enumerate).toHaveBeenCalledTimes(1);
  hook.rerender({ pluginID: 'provider', request: nextRequest, live: false });
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
  expect(hook.result.current.resources.error?.message).toBe('later page denied');
  expect(hook.result.current.acquired).toEqual({ request, page: first });
  expect(hook.result.current.isAcquiredRequestCurrent).toBe(false);
  expect(hook.result.current.acquired?.request.request.cursor).toBeUndefined();
  expect(hook.result.current.acquired?.page.sourcePage.nextCursor).toBe('second');
  expect(native.enumerate).toHaveBeenCalledTimes(2);
  hook.rerender({ pluginID: 'provider', request, live: false });
  await waitFor(() => expect(hook.result.current.resources.isSuccess).toBe(true));
  expect(hook.result.current.acquired?.page.records[0].record.body).toEqual({ kind: 'uint64', value: '18446744073709551615' });
  expect(native.enumerate).toHaveBeenCalledTimes(2);
  hook.unmount(); client.clear();
});

it('retains a page during a pending cursor but clears it immediately on target replacement', async () => {
  const pending = Promise.withResolvers<HostSourcePage>();
  const { client, wrapper } = setup(true);
  const hook = renderHook((props: HookProps) => useResources(props), { wrapper, initialProps: { pluginID: 'provider', request, live: false } });
  await waitFor(() => expect(hook.result.current.acquired?.page).toEqual(first));
  native.enumerate.mockReturnValueOnce(Object.assign(pending.promise, { cancel: vi.fn().mockResolvedValue(undefined) }));
  hook.rerender({ pluginID: 'provider', request: nextRequest, live: false });
  await waitFor(() => expect(native.enumerate).toHaveBeenCalledTimes(2));
  expect(hook.result.current.resources.isPending).toBe(true);
  expect(hook.result.current.acquired).toEqual({ request, page: first });
  const replacement = { ...nextRequest, targetId: 'replacement-target' };
  hook.rerender({ pluginID: 'provider', request: replacement, live: false });
  expect(hook.result.current.acquired).toBeUndefined();
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
  await act(async () => { pending.resolve(second); await pending.promise; });
  expect(hook.result.current.acquired).toBeUndefined();
  expect(hook.result.current.isAcquiredRequestCurrent).toBe(false);
  hook.unmount(); client.clear();
});

it('commits a successful retry to the acquired cursor and releases the older page', async () => {
  const { client, wrapper } = setup();
  const hook = renderHook((props: HookProps) => useResources(props), { wrapper, initialProps: { pluginID: 'provider', request, live: false } });
  await waitFor(() => expect(hook.result.current.acquired?.page).toEqual(first));
  hook.rerender({ pluginID: 'provider', request: nextRequest, live: false });
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
  native.enumerate.mockImplementation(() => ready(second));
  await act(async () => { await hook.result.current.resources.refetch(); });
  await waitFor(() => expect(hook.result.current.acquired).toEqual({ request: nextRequest, page: second }));
  expect(hook.result.current.isAcquiredRequestCurrent).toBe(true);
  expect(native.enumerate).toHaveBeenLastCalledWith('provider', nextRequest);
  await waitFor(() => expect(client.getQueryData(resourceQueryKeys.list('provider', request))).toBeUndefined());
  expect(hook.result.current.acquired?.page.sourcePage.nextCursor).toBe('third');
  hook.unmount(); client.clear();
});

it('keeps actual live updates on the displayed acquired page during attempted-page failure', async () => {
  const { client, wrapper } = setup();
  const hook = renderHook((props: HookProps) => useResources(props), { wrapper, initialProps: { pluginID: 'provider', request, live: true } });
  await waitFor(() => expect(hook.result.current.isLive).toBe(true));
  hook.rerender({ pluginID: 'provider', request: nextRequest, live: true });
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
  expect(hook.result.current.isLive).toBe(true);
  const updated = { ...firstRow, record: { ...firstRow.record, body: { kind: 'string' as const, value: 'live on acquired page' } } };
  act(() => native.listeners.get('provider/c/items/UPDATE')?.({ data: { route: firstRow.route, record: updated, metadata: {}, guarantee: 'bestEffort' } }));
  flushFrames();
  await waitFor(() => expect(hook.result.current.acquired?.page.records).toEqual([updated]));
  expect(hook.result.current.acquired?.request.request.cursor).toBeUndefined();
  expect(hook.result.current.resources.isError).toBe(true);
  const unknown = { ...updated, key: 'unseen-host-key', addressKey: 'unseen-address-key' };
  act(() => native.listeners.get('provider/c/items/ADD')?.({ data: { route: firstRow.route, record: unknown, metadata: {}, guarantee: 'bestEffort' } }));
  flushFrames();
  await waitFor(() => expect(hook.result.current.membershipStale).toBe(true));
  expect(hook.result.current.acquired?.page.records).toEqual([updated]);
  await act(async () => { await hook.result.current.refreshAcquiredPage(); });
  await waitFor(() => expect(hook.result.current.membershipStale).toBe(false));
  expect(native.enumerate).toHaveBeenLastCalledWith('provider', request);
  expect(hook.result.current.acquired?.page).toEqual(first);
  expect(hook.result.current.resources.isError).toBe(true);
  hook.unmount(); client.clear();
});

const identityChanges: { name: string; change: (props: HookProps) => HookProps }[] = [
  { name: 'plugin', change: (props) => ({ ...props, pluginID: 'other-plugin' }) },
  { name: 'targetId', change: (props) => ({ ...props, request: { ...request, targetId: 'other-host-target' } }) },
  { name: 'scope', change: (props) => ({ ...props, request: { ...request, request: { ...request.request, target: { ...request.request.target, scope: [{ dimension: 'region', match: 'oneOf', values: ['other'] }] } } } }) },
  { name: 'representation', change: (props) => ({ ...props, request: { ...request, request: { ...request.request, target: { ...request.request.target, representation: 'other' } } } }) },
  { name: 'route', change: (props) => ({ ...props, request: { ...request, request: { ...request.request, target: { ...request.request.target, route: { connection: 'other' } } } } }) },
  { name: 'authority', change: (props) => ({ ...props, request: { ...request, request: { ...request.request, target: { ...request.request.target, authority: 'other' } } } }) },
  { name: 'type', change: (props) => ({ ...props, request: { ...request, request: { ...request.request, target: { ...request.request.target, type: 'other' } } } }) },
  { name: 'undefined target', change: (props) => ({ ...props, request: undefined }) },
];
it.each(identityChanges)('clears acquired rows synchronously when $name changes', async ({ change }) => {
  const { client, wrapper } = setup();
  const seen: (AcquiredResourcePage | undefined)[] = [];
  const initial: HookProps = { pluginID: 'provider', request, live: true };
  const hook = renderHook((props: HookProps) => { const state = useResources(props); seen.push(state.acquired); return state; }, { wrapper, initialProps: initial });
  await waitFor(() => expect(hook.result.current.isLive).toBe(true));
  native.enumerate.mockImplementation(() => new CancellablePromise<HostSourcePage>(() => {}));
  const before = seen.length;
  hook.rerender(change(initial));
  expect(seen[before]).toBeUndefined();
  expect(hook.result.current.acquired).toBeUndefined();
  expect(hook.result.current.isAcquiredRequestCurrent).toBe(false);
  expect(hook.result.current.isLive).toBe(false);
  expect(hook.result.current.guarantee).toBeUndefined();
  expect(hook.result.current.membershipStale).toBe(false);
  hook.unmount(); client.clear();
});

it('does not manufacture an acquired page or live readiness after initial acquisition failure', async () => {
  native.enumerate.mockImplementation(() => denied<HostSourcePage>('first page denied'));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, live: true }), { wrapper });
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
  expect(hook.result.current.acquired).toBeUndefined();
  expect(hook.result.current.isLive).toBe(false);
  expect(native.subscribe).not.toHaveBeenCalled();
  hook.unmount(); client.clear();
});

it('does not expose an old resolved target during replacement loading, refetch, or failure', async () => {
  const { client, wrapper } = setup(true);
  const hook = renderHook(({ type }: { type: string }) => useResolvedResourceTarget({ pluginID: 'provider', route: { connection: 'c' }, type }), { wrapper, initialProps: { type: 'items' } });
  await waitFor(() => expect(hook.result.current.data).toEqual(resolved));
  let fail!: (reason: Error) => void;
  native.resolveTarget.mockImplementation(() => new CancellablePromise<ResolvedResourceTarget>((_resolve, reject) => { fail = reject; }));
  hook.rerender({ type: 'replacement' });
  expect(hook.result.current.data).toBeUndefined();
  await act(async () => { fail(new Error('new resolution denied')); });
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.data).toBeUndefined();
  native.resolveTarget.mockImplementation(() => ready(resolved));
  await act(async () => { await hook.result.current.refetch(); });
  await waitFor(() => expect(hook.result.current.data).toEqual(resolved));
  let rejectRefresh!: (reason: Error) => void;
  native.resolveTarget.mockImplementation(() => new CancellablePromise<ResolvedResourceTarget>((_resolve, reject) => { rejectRefresh = reject; }));
  let refresh!: Promise<unknown>;
  act(() => { refresh = hook.result.current.refetch(); });
  await waitFor(() => expect(hook.result.current.isFetching).toBe(true));
  expect(hook.result.current.data).toBeUndefined();
  await act(async () => { rejectRefresh(new Error('same-key refresh denied')); await refresh; });
  expect(hook.result.current.data).toBeUndefined();
  hook.unmount(); client.clear();
});

const getRequest: HostGetRequest = { targetId: request.targetId, request: { route: firstRow.route, reference: firstRow.record.reference, representation: 'raw' } };
const search: HostNativeQueryRequest = { targetId: request.targetId, request: { target: request.request.target, language: 'selector', query: { kind: 'map', value: {} }, pageSize: 1 } };
const connectionQueries = [native.enumerate, native.get, native.catalog, native.groups, native.scopes, native.schemas, native.actions, native.nativeQuery];

it('blocks canonical reads and subscriptions until connected, then releases subscriptions on disconnect', async () => {
  native.phase = 'disconnected';
  const { client, wrapper } = setup();
  const hook = renderHook(() => {
    useResource({ pluginID: 'provider', request: getRequest });
    useResourceTypes({ pluginID: 'provider', route: firstRow.route });
    useResourceGroups({ pluginID: 'provider', route: firstRow.route });
    useScopeValues({ pluginID: 'provider', route: firstRow.route, dimension: 'region' });
    useEditorSchemas({ pluginID: 'provider', route: firstRow.route });
    useResourceActions({ pluginID: 'provider', route: firstRow.route, type: 'items' });
    useResourceSearch({ pluginID: 'provider', searches: [search] });
    return useResources({ pluginID: 'provider', request });
  }, { wrapper });
  for (const query of connectionQueries) expect(query).not.toHaveBeenCalled();
  expect(native.subscribe).not.toHaveBeenCalled();
  expect(native.listeners.size).toBe(0);
  native.phase = 'connected';
  hook.rerender();
  await waitFor(() => expect(native.subscribe).toHaveBeenCalledWith('provider', { targetId: request.targetId, target: request.request.target }));
  for (const query of connectionQueries) expect(query).toHaveBeenCalled();
  native.phase = 'disconnected';
  hook.rerender();
  await waitFor(() => expect(native.unsubscribe).toHaveBeenCalledWith('provider', { targetId: request.targetId, target: request.request.target }));
  expect(native.listeners.size).toBe(0);
  expect(hook.result.current.watchState).toBe(WatchState.WatchStateIdle);
  hook.unmount(); client.clear();
});

it('keeps disabled canonical hooks inert, including manual list refetch', async () => {
  const { client, wrapper } = setup();
  const hook = renderHook(() => {
    const disabled = { pluginID: 'provider', route: firstRow.route, enabled: false };
    useResource({ ...disabled, request: getRequest });
    useResourceTypes(disabled);
    useResourceGroups(disabled);
    useScopeValues({ ...disabled, dimension: 'region' });
    useEditorSchemas(disabled);
    useResourceActions({ ...disabled, type: 'items' });
    useResourceSearch({ ...disabled, searches: [search] });
    return useResources({ pluginID: 'provider', request, enabled: false });
  }, { wrapper });
  await act(async () => { await hook.result.current.resources.refetch(); });
  for (const query of connectionQueries) expect(query).not.toHaveBeenCalled();
  expect(native.readinessListeners.size).toBe(0);
  expect(native.listeners.size).toBe(0);
  expect(native.subscribe).not.toHaveBeenCalled();
  hook.unmount(); client.clear();
});

it('waits for pending subscription cleanup before reacquiring after reconnect', async () => {
  const pending = Promise.withResolvers<void>();
  native.subscribe.mockReturnValueOnce(pending.promise);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request }), { wrapper });
  await waitFor(() => expect(native.subscribe).toHaveBeenCalledTimes(1));
  native.phase = 'disconnected';
  hook.rerender();
  expect(native.unsubscribe).not.toHaveBeenCalled();
  expect(native.listeners.size).toBe(0);
  native.phase = 'connected'; native.generation++;
  hook.rerender();
  expect(native.subscribe).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
  await waitFor(() => expect(native.subscribe).toHaveBeenCalledTimes(2));
  expect(native.unsubscribe).toHaveBeenCalledTimes(1);
  expect(native.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(native.subscribe.mock.invocationCallOrder[1]);
  hook.unmount(); client.clear();
});

it('observes same-phase generation changes before serializing subscription reacquisition', async () => {
  const pending = Promise.withResolvers<void>();
  native.subscribe.mockReturnValueOnce(pending.promise);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request }), { wrapper });
  await waitFor(() => expect(native.subscribe).toHaveBeenCalledTimes(1));
  act(() => {
    native.generation++;
    for (const listener of native.readinessListeners) listener();
  });
  expect(native.phase).toBe('connected');
  expect(native.subscribe).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
  await waitFor(() => expect(native.subscribe).toHaveBeenCalledTimes(2));
  expect(native.unsubscribe).toHaveBeenCalledTimes(1);
  expect(native.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(native.subscribe.mock.invocationCallOrder[1]);
  hook.unmount();
  expect(native.readinessListeners.size).toBe(0);
  client.clear();
});

it('does not reuse old watch readiness or buffered rows after reconnect', async () => {
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request }), { wrapper });
  await waitFor(() => expect(hook.result.current.isLive).toBe(true));
  expect(hook.result.current.isSynced).toBe(true);
  act(() => native.listeners.get('provider/c/watch/STATE')?.({ data: { route: firstRow.route, type: 'items', state: WatchState.WatchStateSyncing } }));
  const updated = { ...firstRow, record: { ...firstRow.record, body: { kind: 'string' as const, value: 'buffered' } } };
  act(() => native.listeners.get('provider/c/items/UPDATE')?.({ data: { route: firstRow.route, record: updated, metadata: {}, guarantee: 'bestEffort' } }));
  native.phase = 'disconnected';
  hook.rerender();
  flushFrames();
  expect(client.getQueryData(resourceQueryKeys.list('provider', request))).toEqual(first);
  expect(hook.result.current.watchState).toBe(WatchState.WatchStateIdle);
  native.state.mockImplementation(() => new CancellablePromise(() => {}));
  native.phase = 'connected'; native.generation++;
  hook.rerender();
  expect(hook.result.current.watchState).toBe(WatchState.WatchStateIdle);
  expect(hook.result.current.isSynced).toBe(false);
  hook.unmount(); client.clear();
});

it('discards buffered list and detail updates after a same-phase generation change', async () => {
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request }), { wrapper });
  try {
    await waitFor(() => expect(hook.result.current.isLive).toBe(true));
    expect(hook.result.current.resources.isFetching).toBe(false);
    const listKey = resourceQueryKeys.list('provider', request);
    const detailKey = resourceQueryKeys.resource('provider', getRequest);
    client.setQueryData(detailKey, firstRow);
    vi.useFakeTimers();
    act(() => native.listeners.get('provider/c/watch/STATE')?.({ data: { route: firstRow.route, type: 'items', state: WatchState.WatchStateSyncing } }));
    const updated = { ...firstRow, record: { ...firstRow.record, body: { kind: 'string' as const, value: 'buffered' } } };
    act(() => native.listeners.get('provider/c/items/UPDATE')?.({ data: { route: firstRow.route, record: updated, metadata: {}, guarantee: 'bestEffort' } }));
    await act(async () => {
      native.generation++;
      for (const listener of native.readinessListeners) listener();
    });
    expect(native.phase).toBe('connected');
    act(() => vi.advanceTimersByTime(500));
    expect(client.getQueryData(listKey)).toEqual(first);
    expect(client.getQueryData(detailKey)).toEqual(firstRow);
  } finally {
    hook.unmount();
    client.clear();
    vi.useRealTimers();
  }
});

it('lets live watch state outrank a stale initial state response', async () => {
  let resolveState!: (value: { resources: { items: WatchState } }) => void;
  native.state.mockImplementation(() => new CancellablePromise((resolve) => { resolveState = resolve; }));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request }), { wrapper });
  await waitFor(() => expect(hook.result.current.isLive).toBe(true));
  act(() => native.listeners.get('provider/c/watch/STATE')?.({ data: { route: firstRow.route, type: 'items', state: WatchState.WatchStateSyncing } }));
  await act(async () => resolveState({ resources: { items: WatchState.WatchStateSynced } }));
  expect(hook.result.current.watchState).toBe(WatchState.WatchStateSyncing);
  hook.unmount(); client.clear();
});

it('surfaces subscribe and unsubscribe failures and closes listeners', async () => {
  native.subscribe.mockImplementationOnce(() => denied<void>('Subscribe failed'));
  const firstSetup = setup();
  const failed = renderHook(() => useResources({ pluginID: 'provider', request }), firstSetup);
  await waitFor(() => expect(failed.result.current.watchError).toBeInstanceOf(Error));
  expect(native.snackbar).toHaveBeenCalled();
  expect(native.listeners.size).toBe(0);
  failed.unmount(); firstSetup.client.clear();
  native.unsubscribe.mockImplementationOnce(() => denied<void>('Unsubscribe failed'));
  const secondSetup = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request }), secondSetup);
  await waitFor(() => expect(hook.result.current.isLive).toBe(true));
  hook.unmount();
  await waitFor(() => expect(native.snackbar).toHaveBeenCalledTimes(2));
  secondSetup.client.clear();
});

it('guards independent canonical mutations and type-level actions before native calls', async () => {
  native.phase = 'disconnected';
  const { client, wrapper } = setup();
  const hook = renderHook(() => ({
    resource: useResource({ pluginID: 'provider', request: getRequest, enabled: false }),
    mutations: useResourceMutations({ pluginID: 'provider' }),
    action: useExecuteAction({ pluginID: 'provider' }),
  }), { wrapper });
  const mutation: MutationRequest = { route: firstRow.route, reference: firstRow.record.reference, operation: 'create', input: { kind: 'map', value: {} } };
  const action: ActionRequest = { route: firstRow.route, typeTarget: { provider: 'provider', authority: 'authority', type: 'items', scope: [] }, action: 'install', input: { kind: 'map', value: {} } };
  await act(async () => {
    for (const operation of [
      () => hook.result.current.resource.mutate({ operation: 'mutationUpdate', input: mutation.input }),
      ...['create', 'mutationUpdate', 'delete'].map((operation) => () => hook.result.current.mutations.mutate({ ...mutation, operation })),
      () => hook.result.current.action.executeAction(action),
    ]) await expect(operation()).rejects.toThrow('Connection is disconnected');
  });
  expect(native.requireReady).toHaveBeenCalledTimes(5);
  expect(native.mutate).not.toHaveBeenCalled();
  expect(native.action).not.toHaveBeenCalled();
  native.phase = 'connected';
  native.action.mockImplementation(() => ready({ kind: 'null' }));
  await act(async () => { await hook.result.current.action.executeAction(action); });
  expect(native.action).toHaveBeenLastCalledWith('provider', action);
  expect(native.action.mock.calls[0][1]).not.toHaveProperty('reference');
  hook.unmount(); client.clear();
});

it('separates group caches by the full opaque route identity', async () => {
  native.groups.mockImplementation((_pluginID: string, route: { connection: string }) => ready([{ id: route.connection }]));
  const { client, wrapper } = setup();
  const firstRoute = { connection: 'arn:aws:eks:region:account:cluster/team/name' };
  const secondRoute = { connection: `${firstRoute.connection}/second` };
  const hook = renderHook(() => ({
    first: useResourceGroups({ pluginID: 'provider', route: firstRoute }),
    second: useResourceGroups({ pluginID: 'provider', route: secondRoute }),
  }), { wrapper });
  await waitFor(() => expect(hook.result.current.first.groups.data).toEqual([{ id: firstRoute.connection }]));
  expect(hook.result.current.second.groups.data).toEqual([{ id: secondRoute.connection }]);
  hook.unmount(); client.clear();
});

it('cancels native reads immediately on invalidation and fences late data after reconnect', async () => {
  const pending = Promise.withResolvers<HostSourcePage>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.enumerate.mockReturnValueOnce(Object.assign(pending.promise, { cancel }));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, live: false }), { wrapper });
  await waitFor(() => expect(native.enumerate).toHaveBeenCalledTimes(1));
  act(() => {
    native.phase = 'disconnected'; native.generation++;
    for (const listener of [...native.readinessListeners]) listener();
  });
  expect(cancel).toHaveBeenCalledTimes(1);
  const key = resourceQueryKeys.list('provider', request);
  expect(client.getQueryData(key)).toBeUndefined();
  hook.rerender();
  native.enumerate.mockImplementation(() => ready(second));
  native.phase = 'connected';
  hook.rerender();
  await waitFor(() => expect(hook.result.current.resources.data).toEqual(second));
  await act(async () => pending.resolve(first));
  expect(client.getQueryData(key)).toEqual(second);
  hook.unmount(); client.clear();
});

it('cancels detached native reads and releases lifecycle listeners on unmount', async () => {
  const pending = Promise.withResolvers<HostSourcePage>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.enumerate.mockReturnValueOnce(Object.assign(pending.promise, { cancel }));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, live: false }), { wrapper });
  await waitFor(() => expect(native.enumerate).toHaveBeenCalled());
  hook.unmount();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(native.readinessListeners.size).toBe(0);
  await act(async () => pending.resolve(first));
  expect(client.getQueryData(resourceQueryKeys.list('provider', request))).toBeUndefined();
  client.clear();
});
