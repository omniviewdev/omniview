import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CancellablePromise } from '@wailsio/runtime/cancellable';
import { useResources, type AcquiredResourcePage } from './useResources';
import { useResolvedResourceTarget } from './useResolvedResourceTarget';
import type { HostEnumerateRequest, HostRecord, HostSourcePage, ResolvedResourceTarget } from '../../resource/v2/host';
import { resourceQueryKeys } from '../../resourceQueryKeys';

const native = vi.hoisted(() => ({ enumerate: vi.fn(), resolveTarget: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), ensure: vi.fn(), state: vi.fn(), listeners: new Map<string, (event: { data: unknown }) => void>() }));
vi.mock('../../resource/v2/client', () => ({ Enumerate: native.enumerate, ResolveTarget: native.resolveTarget, SubscribeResource: native.subscribe, UnsubscribeResource: native.unsubscribe, EnsureResourceWatch: native.ensure, GetWatchState: native.state }));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: (id?: string) => id ?? 'provider' }));
vi.mock('@wailsio/runtime', () => ({ Events: { On: (topic: string, callback: (event: { data: unknown }) => void) => { native.listeners.set(topic, callback); return () => native.listeners.delete(topic); } } }));

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
interface HookProps { pluginID: string; request?: HostEnumerateRequest; live?: boolean }

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
