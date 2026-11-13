import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CancellablePromise } from '@wailsio/runtime/cancellable';
import { MAX_LINGERING_VIEWS, VIEW_LINGER_MS } from '../../resource/v2/sourceViewLimits';
import { useResources, type AcquiredResourcePage } from './useResources';
import { useResolvedResourceTarget } from './useResolvedResourceTarget';
import { useResource } from './useResource';
import { useResourceGroups } from './useResourceGroups';
import { useResourceTypes } from './useResourceTypes';
import { useResourceType } from './useResourceType';
import { useResourceMutations } from './useResourceMutations';
import { useExecuteAction } from './useResourceActions';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import type { ActionRequest, MutationRequest } from '../../resource/v2/domain';
import type {
  HostEnumerateRequest,
  HostRecord,
  HostSourceStatus,
  HostSourcePage,
  ResourceView,
  ResolvedResourceTarget,
} from '../../resource/v2/host';
const native = vi.hoisted(() => ({
  enumerate: vi.fn(),
  open: vi.fn(),
  phase: 'connected',
  generation: 1,
  // Connections whose generation moved on alone, by connection ID. Every other connection follows `generation`.
  generations: new Map<string, number>(),
  listeners: new Set<() => void>(),
  resolveTarget: vi.fn(),
  get: vi.fn(),
  groups: vi.fn(),
  catalog: vi.fn(),
  mutate: vi.fn(),
  action: vi.fn(),
  requireReady: vi.fn(),
}));
vi.mock('../../resource/v2/client', () => ({
  Enumerate: native.enumerate,
  ResolveTarget: native.resolveTarget,
  Get: native.get,
  GetResourceGroups: native.groups,
  Catalog: native.catalog,
  Mutate: native.mutate,
  Action: native.action,
}));
vi.mock('../../resource/v2/sourceView', () => ({ openSourceView: native.open }));
vi.mock('../../activity/context', () => ({ useNotifications: () => ({ notify: vi.fn() }) }));
vi.mock('../useResolvedPluginId', () => ({
  useResolvedPluginId: (id?: string) => id ?? 'provider',
}));
vi.mock('../connection/useConnectionReadiness', () => ({
  useConnectionReadiness: () => ({ phase: native.phase }),
}));
vi.mock('../../connection/connectionReadiness', () => ({
  requireConnectionReady: native.requireReady,
  getConnectionReadinessGeneration: (_plugin: string, connection: string) =>
    native.generations.get(connection) ?? native.generation,
  isConnectionReadinessCurrent: (_plugin: string, connection: string, generation: number) =>
    native.phase === 'connected' &&
    generation === (native.generations.get(connection) ?? native.generation),
  connectionReadinessStore: () => ({
    subscribe: (listener: () => void) => {
      native.listeners.add(listener);
      return () => {
        native.listeners.delete(listener);
      };
    },
  }),
}));

const request: HostEnumerateRequest = {
  targetId: 'target',
  request: {
    target: {
      route: { connection: 'c' },
      provider: 'provider',
      authority: 'authority',
      type: 'items',
      scope: [],
      representation: 'raw',
    },
    pageSize: 1,
  },
};
const row: HostRecord = {
  key: 'one',
  addressKey: 'one',
  targetId: 'target',
  route: { connection: 'c' },
  record: {
    reference: {
      address: {
        provider: 'provider',
        authority: 'authority',
        type: 'items',
        id: 'one',
        scope: [],
      },
    },
    coverage: { kind: 'complete', paths: [] },
    body: { kind: 'uint64', value: '18446744073709551615' },
    representation: { id: 'raw', revision: 'r' },
  },
};
const page: ResourceView = {
  records: [row],
  sourcePage: {
    nextCursor: 'next',
    count: { kind: 'unknown' },
    coverage: { kind: 'partial', paths: [] },
    consistency: 'bestEffort',
  },
};
const next = { ...request, request: { ...request.request, cursor: 'next' } };
const status = (state: HostSourceStatus['state']): HostSourceStatus => ({
  state,
  mode: 'snapshotAndUpdates',
  continuity: 'bestEffort',
  count: { kind: 'exact', value: '1' },
});

function source() {
  let snapshot: {
    viewGeneration?: string;
    records: ReadonlyMap<string, HostRecord>;
    status?: HostSourceStatus;
    complete: boolean;
  } = {
    records: new Map(),
    status: status('opening'),
    complete: false,
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    publish(nextSnapshot: typeof snapshot) {
      snapshot = nextSnapshot;
      for (const listener of listeners) listener();
    },
  };
}
type Wrapper = (props: { children: React.ReactNode }) => React.ReactElement;
function setup(queries: { refetchOnWindowFocus?: boolean; staleTime?: number } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, ...queries } },
  });
  const wrapper: Wrapper = ({ children }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}
function ready<T>(value: T) {
  return new CancellablePromise<T>((resolve) => resolve(value));
}
function denied<T>(message: string) {
  return new CancellablePromise<T>((_resolve, reject) => reject(new Error(message)));
}

const podsRoute = { connection: 'c' };
const catalogKey = ['provider', 'resource-v2', 'catalog', podsRoute];
const catalogOf = (label: string, revision = 'ovc1.binding.native') => ({
  provider: 'provider',
  revision,
  types: [{ type: 'pods', displayName: label }],
});
const openScreen = (wrapper: Wrapper) =>
  renderHook(() => useResourceTypes({ pluginID: 'provider', route: podsRoute }), { wrapper });
const mountCell = (wrapper: Wrapper) =>
  renderHook(() => useResourceType({ pluginID: 'provider', route: podsRoute, type: 'pods' }), { wrapper });
const mountTarget = (wrapper: Wrapper) =>
  renderHook(() => useResolvedResourceTarget({ pluginID: 'provider', route: podsRoute, type: 'items' }), { wrapper });
function failed<T>(reason: unknown) {
  return new CancellablePromise<T>((_resolve, reject) => reject(reason));
}
const hostError = (code: string, status: number) => ({ type: `omniview:resource/${code}`, title: code, status, detail: code, code });
const resetRequired = hostError('RESET_REQUIRED', 409);
const timedOut = hostError('TIMEOUT', 408);
const targetOf = (targetId: string) => ({
  targetId,
  target: request.request.target,
  authority: { continuity: 'connectionLocal', limitations: [] },
  catalogRevision: 'catalog-1',
});
/** A long-lived screen outlives the catalog's 30 second freshness window. */
function ageCatalog(client: QueryClient) {
  act(() => {
    for (const query of client.getQueryCache().findAll({ queryKey: catalogKey })) {
      client.setQueryData(query.queryKey, query.state.data, { updatedAt: 1 });
    }
  });
}
/**
 * Deliver the window-focus signal to every cached query. The app's QueryClient disables
 * window-focus refetching, so each observer decides for itself whether to refresh.
 */
function refocus(client: QueryClient) {
  act(() => {
    client.getQueryCache().onFocus();
  });
}

const collectionKey = [...resourceQueryKeys.list('provider', request), 'collection', 'ifSupported'];
/** A complete snapshot of the collection's one row. */
const complete = () => ({
  viewGeneration: 'g1',
  records: new Map([['one', row]]),
  status: status('following'),
  complete: true,
});
/** Move the clock, letting the promises and timers it releases run. */
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const settle = () => advance(0);
const mountCollection = (wrapper: Wrapper, input: HostEnumerateRequest = request) =>
  renderHook(() => useResources({ pluginID: 'provider', request: input, collection: true }), {
    wrapper,
  });
/** A collection on another connection, so that its generation can move on alone. */
const requestOn = (connection: string): HostEnumerateRequest => ({
  ...request,
  request: { ...request.request, target: { ...request.request.target, route: { connection } } },
});
/** Every open yields a new view. The returned list holds the views in the order they were opened. */
function openFreshViews() {
  const opened: Array<ReturnType<typeof source>> = [];
  native.open.mockImplementation(async () => {
    const view = source();
    opened.push(view);
    return view;
  });
  return opened;
}
type Committed = { resources: { isSuccess: boolean }; acquired?: AcquiredResourcePage };
/** Mount a collection, keeping what every committed render returned. */
function mountRecorded(wrapper: Wrapper) {
  const commits: Committed[] = [];
  const hook = renderHook(
    () => {
      const result = useResources({ pluginID: 'provider', request, collection: true });
      React.useLayoutEffect(() => {
        commits.push(result);
      });
      return result;
    },
    { wrapper },
  );
  return { hook, commits };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  native.phase = 'connected';
  native.generation = 1;
  native.generations.clear();
  native.listeners.clear();
  native.enumerate.mockImplementation((_plugin: string, input: HostEnumerateRequest) =>
    input.request.cursor ? denied('denied') : ready(page),
  );
  native.requireReady.mockImplementation(async () => {
    if (native.phase !== 'connected') throw new Error('Connection is disconnected');
  });
  native.get.mockImplementation(() => ready(row));
  native.groups.mockImplementation(() => ready([]));
  native.catalog.mockReset();
  native.catalog.mockImplementation(() => ready(catalogOf('Pods')));
  native.resolveTarget.mockReset();
  native.resolveTarget.mockImplementation(() => ready(targetOf(request.targetId)));
});

afterEach(async () => {
  cleanup();
  // A released view lingers. Closing every one here keeps the next test from reusing it.
  await vi.advanceTimersByTimeAsync(VIEW_LINGER_MS + 1);
  vi.useRealTimers();
});

it('waits for a complete collection snapshot, then applies source changes', async () => {
  const view = source();
  native.open.mockResolvedValue(view);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), {
    wrapper,
  });
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  expect(native.open).toHaveBeenCalledWith('provider', {
    targetId: 'target',
    target: request.request.target,
    updates: 'ifSupported',
  });
  expect(hook.result.current.resources.isPending).toBe(true);
  expect(native.enumerate).not.toHaveBeenCalled();
  act(() =>
    view.publish({
      viewGeneration: 'g1',
      records: new Map([['one', row]]),
      status: status('following'),
      complete: true,
    }),
  );
  await waitFor(() => expect(hook.result.current.acquired?.page.records).toEqual([row]));
  expect(hook.result.current.isLive).toBe(true);
  expect(hook.result.current.isSynced).toBe(true);
  expect(hook.result.current.view?.viewGeneration).toBe('g1');
  const changed = { ...row, key: 'two' };
  act(() =>
    view.publish({
      viewGeneration: 'g1',
      records: new Map([['two', changed]]),
      status: status('following'),
      complete: true,
    }),
  );
  await waitFor(() => expect(hook.result.current.resources.data?.records).toEqual([changed]));
  await act(async () => {
    await hook.result.current.resources.refetch();
    await hook.result.current.refreshAcquiredPage();
  });
  expect(view.refresh).toHaveBeenCalledTimes(2);
  hook.unmount();
  // The released view lingers for a quick return, then closes once.
  await settle();
  expect(view.close).not.toHaveBeenCalled();
  await advance(VIEW_LINGER_MS);
  expect(view.close).toHaveBeenCalledTimes(1);
  client.clear();
});

it('shares a source view until its last observer unmounts and its linger ends', async () => {
  const view = source();
  native.open.mockResolvedValue(view);
  const { client, wrapper } = setup();
  const a = renderHook(
    () => useResources({ pluginID: 'provider', request, collection: true, live: false }),
    { wrapper },
  );
  const b = renderHook(
    () => useResources({ pluginID: 'provider', request, collection: true, live: false }),
    { wrapper },
  );
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  expect(native.open.mock.calls[0][1].updates).toBe('none');
  act(() =>
    view.publish({
      viewGeneration: 'g',
      records: new Map([['one', row]]),
      status: status('finished'),
      complete: true,
    }),
  );
  await waitFor(() => expect(b.result.current.isSynced).toBe(true));
  expect(b.result.current.isLive).toBe(false);
  a.unmount();
  expect(view.close).not.toHaveBeenCalled();
  b.unmount();
  await settle();
  expect(view.close).not.toHaveBeenCalled();
  await advance(VIEW_LINGER_MS);
  expect(view.close).toHaveBeenCalledTimes(1);
  client.clear();
});

it('writes the page and re-renders only when a notification changed something a consumer can see', async () => {
  const view = source();
  native.open.mockResolvedValue(view);
  const { client, wrapper } = setup();
  let renders = 0;
  const hook = renderHook(() => {
    renders++;
    return useResources({ pluginID: 'provider', request, collection: true });
  }, { wrapper });
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  const complete = { viewGeneration: 'g1', records: new Map([['one', row]]), status: status('following'), complete: true };
  act(() => view.publish(complete));
  await waitFor(() => expect(hook.result.current.acquired?.page.records).toEqual([row]));
  await waitFor(() => expect(hook.result.current.resources.isFetching).toBe(false));
  await act(async () => {});
  const { page } = hook.result.current.acquired!;
  const write = vi.spyOn(client, 'setQueryData');
  const settled = renders;
  // The same records under the same status are the same state, however many times they are announced.
  act(() => view.publish({ ...complete }));
  act(() => view.publish({ ...complete }));
  expect(write).not.toHaveBeenCalled();
  expect(renders).toBe(settled);
  expect(hook.result.current.acquired?.page).toBe(page);
  // A changed count is a changed page, but the records it describes are still the same list.
  act(() => view.publish({ ...complete, status: { ...status('following'), count: { kind: 'exact', value: '2' } } }));
  await waitFor(() => expect(hook.result.current.acquired?.page.view?.count).toEqual({ kind: 'exact', value: '2' }));
  expect(hook.result.current.acquired?.page).not.toBe(page);
  expect(hook.result.current.acquired?.page.records).toBe(page.records);
  hook.unmount();
  client.clear();
});

it('keeps the records after a delete as the very objects the source view holds', async () => {
  const view = source();
  native.open.mockResolvedValue(view);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), { wrapper });
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  const named = (key: string): HostRecord => ({ ...row, key, addressKey: key });
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(named);
  const snapshotOf = (...held: HostRecord[]) => ({
    viewGeneration: 'g1', records: new Map(held.map((item) => [item.key, item])), status: status('following'), complete: true,
  });
  act(() => view.publish(snapshotOf(a, b, c, d)));
  await waitFor(() => expect(hook.result.current.acquired?.page.records).toHaveLength(4));
  // b leaves the middle of the list and the records after it move up one place. None of them is replaced.
  act(() => view.publish(snapshotOf(a, c, d)));
  await waitFor(() => expect(hook.result.current.acquired?.page.records).toHaveLength(3));
  const records = hook.result.current.acquired!.page.records;
  expect(records[0]).toBe(a);
  expect(records[1]).toBe(c);
  expect(records[2]).toBe(d);
  hook.unmount();
  client.clear();
});

it('clears a failed refresh once the source recovers, even when its records did not change', async () => {
  const view = source();
  native.open.mockResolvedValue(view);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), { wrapper });
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  const records = new Map([['one', row]]);
  act(() => view.publish({ viewGeneration: 'g1', records, status: status('following'), complete: true }));
  await waitFor(() => expect(hook.result.current.resources.isSuccess).toBe(true));
  act(() => view.publish({ viewGeneration: 'g1', records, status: status('failed'), complete: true }));
  await act(async () => {
    await hook.result.current.resources.refetch();
  });
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
  // The last acquired page stays on screen while the source is down.
  expect(hook.result.current.acquired?.page.records).toEqual([row]);
  act(() => view.publish({ viewGeneration: 'g1', records, status: status('following'), complete: true }));
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(false));
  expect(hook.result.current.acquired?.page.records).toEqual([row]);
  hook.unmount();
  client.clear();
});

it('surfaces a failed source view open as a query error', async () => {
  native.open.mockRejectedValue(new Error('Plugin does not support source sessions.'));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), {
    wrapper,
  });
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
  expect(hook.result.current.resources.error?.message).toBe(
    'Plugin does not support source sessions.',
  );
  expect(hook.result.current.isLive).toBe(false);
  hook.unmount();
  client.clear();
});

it('closes a view that opens while it lingers once its linger ends', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof source>>();
  native.open.mockReturnValue(pending.promise);
  const { client, wrapper } = setup();
  const hook = mountCollection(wrapper);
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  hook.unmount();
  const view = source();
  pending.resolve(view);
  await settle();
  expect(view.close).not.toHaveBeenCalled();
  await advance(VIEW_LINGER_MS);
  expect(view.close).toHaveBeenCalledTimes(1);
  client.clear();
});

it('closes a view that opens after its linger ended as soon as it opens', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof source>>();
  native.open.mockReturnValue(pending.promise);
  const { client, wrapper } = setup();
  const hook = mountCollection(wrapper);
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  hook.unmount();
  await advance(VIEW_LINGER_MS);
  const view = source();
  pending.resolve(view);
  await settle();
  expect(view.close).toHaveBeenCalledTimes(1);
  client.clear();
});

it('renders the rows a released view still holds in the first commit of a remount, without opening it again', async () => {
  const view = source();
  native.open.mockResolvedValue(view);
  const { client, wrapper } = setup();
  const first = mountCollection(wrapper);
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  act(() => view.publish(complete()));
  await waitFor(() => expect(first.result.current.acquired?.page.records).toEqual([row]));
  const records = first.result.current.acquired!.page.records;
  first.unmount();
  // The query cache does not outlive its observer, so only the view can supply what the remount renders.
  await advance(VIEW_LINGER_MS / 2);
  expect(client.getQueryData(collectionKey)).toBeUndefined();
  expect(view.close).not.toHaveBeenCalled();
  const write = vi.spyOn(client, 'setQueryData');
  const { hook: second, commits } = mountRecorded(wrapper);
  expect(commits[0].resources.isSuccess).toBe(true);
  expect(commits[0].acquired?.page.records).toBe(records);
  expect(second.result.current.acquired?.page.records).toBe(records);
  await waitFor(() => expect(second.result.current.isLive).toBe(true));
  expect(native.open).toHaveBeenCalledTimes(1);
  expect(view.close).not.toHaveBeenCalled();
  // The page the view holds is the page rendered: nothing is written back, and it keeps its identity.
  expect(write).not.toHaveBeenCalled();
  expect(second.result.current.acquired?.page).toBe(commits[0].acquired?.page);
  // The reused view is the shared owner: a refetch refreshes it instead of opening another.
  await act(async () => {
    await second.result.current.resources.refetch();
  });
  expect(view.refresh).toHaveBeenCalledTimes(1);
  expect(native.open).toHaveBeenCalledTimes(1);
  second.unmount();
  client.clear();
});

it('does not hand the rows of a lingering view to a disabled mount', async () => {
  const view = source();
  native.open.mockResolvedValue(view);
  const { client, wrapper } = setup();
  const first = mountCollection(wrapper);
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  act(() => view.publish(complete()));
  await waitFor(() => expect(first.result.current.acquired?.page.records).toEqual([row]));
  first.unmount();
  await advance(1_000);
  const second = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useResources({ pluginID: 'provider', request, collection: true, enabled }),
    { wrapper, initialProps: { enabled: false } },
  );
  expect(second.result.current.resources.data).toBeUndefined();
  expect(second.result.current.acquired).toBeUndefined();
  // Once enabled it takes the lingering view over, without opening another.
  second.rerender({ enabled: true });
  await waitFor(() => expect(second.result.current.acquired?.page.records).toEqual([row]));
  expect(native.open).toHaveBeenCalledTimes(1);
  second.unmount();
  client.clear();
});

it('closes a released view once after the linger, and a later mount opens a new one', async () => {
  const view = source();
  native.open.mockResolvedValue(view);
  const { client, wrapper } = setup();
  const first = mountCollection(wrapper);
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  act(() => view.publish(complete()));
  await waitFor(() => expect(first.result.current.isSynced).toBe(true));
  first.unmount();
  await advance(VIEW_LINGER_MS - 1_000);
  expect(view.close).not.toHaveBeenCalled();
  await advance(1_000);
  expect(view.close).toHaveBeenCalledTimes(1);
  await advance(VIEW_LINGER_MS);
  expect(view.close).toHaveBeenCalledTimes(1);
  native.open.mockResolvedValue(source());
  const second = mountCollection(wrapper);
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(2));
  // Nothing of the closed view is served.
  expect(second.result.current.resources.isPending).toBe(true);
  second.unmount();
  client.clear();
});

it('keeps a view released again from the moment of its latest release', async () => {
  const view = source();
  native.open.mockResolvedValue(view);
  const { client, wrapper } = setup();
  const first = mountCollection(wrapper);
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  act(() => view.publish(complete()));
  await waitFor(() => expect(first.result.current.isSynced).toBe(true));
  first.unmount();
  await advance(VIEW_LINGER_MS - 1_000);
  const second = mountCollection(wrapper);
  await settle();
  // The first release's deadline passes while the view is in use again.
  await advance(VIEW_LINGER_MS);
  expect(view.close).not.toHaveBeenCalled();
  second.unmount();
  await advance(VIEW_LINGER_MS - 1_000);
  expect(view.close).not.toHaveBeenCalled();
  await advance(1_000);
  expect(view.close).toHaveBeenCalledTimes(1);
  expect(native.open).toHaveBeenCalledTimes(1);
  client.clear();
});

it('closes the view released longest ago as soon as more than MAX_LINGERING_VIEWS linger', async () => {
  const opened = openFreshViews();
  const { client, wrapper } = setup();
  const inputs = Array.from({ length: MAX_LINGERING_VIEWS + 1 }, (_, index) => ({
    ...request,
    targetId: `target-${index}`,
  }));
  for (const [index, input] of inputs.entries()) {
    const hook = mountCollection(wrapper, input);
    await settle();
    hook.unmount();
    await settle();
    expect(opened).toHaveLength(index + 1);
    // Only the release that exceeds the cap closes a view, and it closes the one released first.
    expect(opened[0].close).toHaveBeenCalledTimes(index < MAX_LINGERING_VIEWS ? 0 : 1);
  }
  for (const view of opened.slice(1)) expect(view.close).not.toHaveBeenCalled();
  // The newest is still there to return to. The one that was closed has to be opened again.
  const newest = mountCollection(wrapper, inputs[MAX_LINGERING_VIEWS]);
  await settle();
  expect(opened).toHaveLength(MAX_LINGERING_VIEWS + 1);
  const evicted = mountCollection(wrapper, inputs[0]);
  await settle();
  expect(opened).toHaveLength(MAX_LINGERING_VIEWS + 2);
  evicted.unmount();
  newest.unmount();
  await advance(VIEW_LINGER_MS);
  // Each opened view closed exactly once.
  for (const view of opened) expect(view.close).toHaveBeenCalledTimes(1);
  client.clear();
});

it('closes the view that started lingering first, not the one opened first', async () => {
  const opened = openFreshViews();
  const { client, wrapper } = setup();
  const hooks = Array.from({ length: MAX_LINGERING_VIEWS + 1 }, (_, index) =>
    mountCollection(wrapper, { ...request, targetId: `target-${index}` }),
  );
  await settle();
  expect(opened).toHaveLength(MAX_LINGERING_VIEWS + 1);
  // The view opened last is released first and the one opened first is released last.
  for (const hook of hooks.slice(1).reverse()) hook.unmount();
  await settle();
  for (const view of opened) expect(view.close).not.toHaveBeenCalled();
  hooks[0].unmount();
  await settle();
  expect(opened[MAX_LINGERING_VIEWS].close).toHaveBeenCalledTimes(1);
  for (const view of opened.slice(0, MAX_LINGERING_VIEWS)) expect(view.close).not.toHaveBeenCalled();
  client.clear();
});

it('does not keep a failed open for a later mount', async () => {
  const view = source();
  native.open
    .mockRejectedValueOnce(new Error('Plugin does not support source sessions.'))
    .mockResolvedValue(view);
  const { client, wrapper } = setup();
  const failed = mountCollection(wrapper);
  await waitFor(() => expect(failed.result.current.resources.isError).toBe(true));
  failed.unmount();
  await advance(1_000);
  // The next mount opens afresh instead of being served the failure.
  const retried = mountCollection(wrapper);
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(2));
  act(() => view.publish(complete()));
  await waitFor(() => expect(retried.result.current.acquired?.page.records).toEqual([row]));
  expect(retried.result.current.resources.isError).toBe(false);
  // A view that opened is kept, which is what the failed one was not.
  retried.unmount();
  await settle();
  expect(view.close).not.toHaveBeenCalled();
  client.clear();
});

it('drops a lingering open that fails, so a later mount opens afresh', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof source>>();
  const view = source();
  native.open.mockReturnValueOnce(pending.promise).mockResolvedValue(view);
  const { client, wrapper } = setup();
  const first = mountCollection(wrapper);
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  first.unmount();
  pending.reject(new Error('Plugin does not support source sessions.'));
  await settle();
  const second = mountCollection(wrapper);
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(2));
  act(() => view.publish(complete()));
  await waitFor(() => expect(second.result.current.acquired?.page.records).toEqual([row]));
  expect(second.result.current.resources.isError).toBe(false);
  second.unmount();
  client.clear();
});

it('closes a view at once when it is released after its connection generation changed', async () => {
  const first = source();
  const second = source();
  native.open.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const { client, wrapper } = setup();
  const hook = mountCollection(wrapper);
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  act(() => first.publish(complete()));
  await waitFor(() => expect(hook.result.current.isSynced).toBe(true));
  // The connection was replaced, and this observer has not rendered the new generation yet.
  native.generation++;
  hook.unmount();
  await settle();
  expect(first.close).toHaveBeenCalledTimes(1);
  // A view released under the current generation lingers.
  const later = mountCollection(wrapper);
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(2));
  later.unmount();
  await settle();
  expect(second.close).not.toHaveBeenCalled();
  client.clear();
});

it('closes a lingering view whose connection generation moved on as soon as another view is released', async () => {
  const opened = openFreshViews();
  const { client, wrapper } = setup();
  const lingering = mountCollection(wrapper, requestOn('a'));
  const other = mountCollection(wrapper, requestOn('b'));
  await settle();
  lingering.unmount();
  await settle();
  // The connection of the lingering view was replaced, but nothing has been released since, so nothing knows.
  native.generations.set('a', 2);
  await advance(1_000);
  expect(opened[0].close).not.toHaveBeenCalled();
  // The next release finds it out, without waiting for the view's own timer.
  other.unmount();
  await settle();
  expect(opened[0].close).toHaveBeenCalledTimes(1);
  expect(opened[1].close).not.toHaveBeenCalled();
  // Its timer is gone with it: each view closes exactly once.
  await advance(VIEW_LINGER_MS);
  expect(opened[0].close).toHaveBeenCalledTimes(1);
  expect(opened[1].close).toHaveBeenCalledTimes(1);
  client.clear();
});

it('finds a stale lingering view when the view that is released is itself of a replaced generation', async () => {
  const opened = openFreshViews();
  const { client, wrapper } = setup();
  const lingering = mountCollection(wrapper, requestOn('a'));
  const released = mountCollection(wrapper, requestOn('b'));
  await settle();
  lingering.unmount();
  await settle();
  // Both connections were replaced, and the observer still mounted has not rendered the new generation yet.
  native.generation++;
  released.unmount();
  await settle();
  expect(opened[0].close).toHaveBeenCalledTimes(1);
  expect(opened[1].close).toHaveBeenCalledTimes(1);
  client.clear();
});

it('does not count a lingering view of a replaced generation toward the cap', async () => {
  const opened = openFreshViews();
  const { client, wrapper } = setup();
  // Connection a is opened second, and released second.
  const hooks = ['b1', 'a', 'b2', 'b3', 'b4'].map((connection) =>
    mountCollection(wrapper, requestOn(connection)),
  );
  await settle();
  for (const hook of hooks.slice(0, MAX_LINGERING_VIEWS)) hook.unmount();
  await settle();
  for (const view of opened) expect(view.close).not.toHaveBeenCalled();
  native.generations.set('a', 2);
  // Without a, the fifth release leaves exactly MAX_LINGERING_VIEWS views lingering.
  hooks[MAX_LINGERING_VIEWS].unmount();
  await settle();
  expect(opened[1].close).toHaveBeenCalledTimes(1);
  // The cap would otherwise have closed b1, which was released longest ago and is still live.
  expect(opened[0].close).not.toHaveBeenCalled();
  for (const view of opened.slice(2)) expect(view.close).not.toHaveBeenCalled();
  client.clear();
});

it.each(['failed', 'closed'] as const)(
  'closes a view at once when its last observer leaves while its source is %s',
  async (state) => {
    const opened = openFreshViews();
    const { client, wrapper } = setup();
    const hook = mountCollection(wrapper);
    await settle();
    act(() => opened[0].publish(complete()));
    await waitFor(() => expect(hook.result.current.isSynced).toBe(true));
    act(() => opened[0].publish({ ...complete(), status: status(state) }));
    await waitFor(() => expect(hook.result.current.source?.state).toBe(state));
    hook.unmount();
    await settle();
    // A source that is down leaves nothing to return to, so its view does not linger.
    expect(opened[0].close).toHaveBeenCalledTimes(1);
    // The next mount opens afresh instead of being served the failure.
    const returned = mountCollection(wrapper);
    await settle();
    expect(opened).toHaveLength(2);
    returned.unmount();
    client.clear();
  },
);

it.each(['failed', 'closed'] as const)(
  'opens afresh when the source of a lingering view went %s before the return',
  async (state) => {
    const opened = openFreshViews();
    const { client, wrapper } = setup();
    const first = mountCollection(wrapper);
    await settle();
    act(() => opened[0].publish(complete()));
    await waitFor(() => expect(first.result.current.isSynced).toBe(true));
    first.unmount();
    await settle();
    expect(opened[0].close).not.toHaveBeenCalled();
    // Its source goes down while nobody watches.
    opened[0].publish({ ...complete(), status: status(state) });
    await advance(VIEW_LINGER_MS / 2);
    expect(opened[0].close).not.toHaveBeenCalled();
    const { hook: returned, commits } = mountRecorded(wrapper);
    await settle();
    // The return closes it and opens another, and serves nothing of the old one.
    expect(opened).toHaveLength(2);
    expect(opened[0].close).toHaveBeenCalledTimes(1);
    expect(commits[0].acquired).toBeUndefined();
    act(() => opened[1].publish(complete()));
    await waitFor(() => expect(returned.result.current.acquired?.page.records).toEqual([row]));
    // The old view's deadline passes while the new one is in use: the old closes once, the new not at all.
    await advance(VIEW_LINGER_MS);
    expect(opened[0].close).toHaveBeenCalledTimes(1);
    expect(opened[1].close).not.toHaveBeenCalled();
    returned.unmount();
    client.clear();
  },
);

it.each(['failed', 'closed'] as const)(
  'rejects a complete initial snapshot with %s status',
  async (state) => {
    const view = source();
    native.open.mockResolvedValue(view);
    const { client, wrapper } = setup();
    const hook = renderHook(
      () => useResources({ pluginID: 'provider', request, collection: true }),
      { wrapper },
    );
    await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
    act(() =>
      view.publish({
        viewGeneration: 'g',
        records: new Map(),
        status: status(state),
        complete: true,
      }),
    );
    await waitFor(() => expect(hook.result.current.source?.state).toBe(state));
    expect(hook.result.current.sourceError).toBe(state === 'failed');
    await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
    expect(hook.result.current.acquired).toBeUndefined();
    hook.unmount();
    client.clear();
  },
);

it('uses one finite enumeration for explicit pages and retains the acquired page on failure', async () => {
  const { client, wrapper } = setup();
  const hook = renderHook(
    (input: HostEnumerateRequest) =>
      useResources({ pluginID: 'provider', request: input, live: true }),
    { wrapper, initialProps: request },
  );
  await waitFor(() => expect(hook.result.current.acquired?.page).toEqual(page));
  expect(native.enumerate).toHaveBeenCalledTimes(1);
  expect(native.open).not.toHaveBeenCalled();
  hook.rerender(next);
  await waitFor(() => expect(hook.result.current.resources.isError).toBe(true));
  expect(hook.result.current.acquired).toEqual({ request, page });
  expect(hook.result.current.isAcquiredRequestCurrent).toBe(false);
  expect(hook.result.current.isLive).toBe(false);
  await act(async () => {
    await hook.result.current.refreshAcquiredPage();
  });
  expect(native.enumerate).toHaveBeenLastCalledWith('provider', request);
  hook.unmount();
  client.clear();
});

it('does not acquire while disabled or disconnected, and closes on retirement', async () => {
  const view = source();
  native.open.mockResolvedValue(view);
  native.phase = 'disconnected';
  const { client, wrapper } = setup();
  const hook = renderHook(
    ({ enabled }: { enabled: boolean }) =>
      useResources({ pluginID: 'provider', request, collection: true, enabled }),
    { wrapper, initialProps: { enabled: true } },
  );
  expect(native.open).not.toHaveBeenCalled();
  native.phase = 'connected';
  hook.rerender({ enabled: false });
  expect(native.open).not.toHaveBeenCalled();
  hook.rerender({ enabled: true });
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  native.phase = 'disconnected';
  native.generation++;
  act(() => {
    for (const listener of native.listeners) listener();
  });
  hook.rerender({ enabled: true });
  await waitFor(() => expect(view.close).toHaveBeenCalledTimes(1));
  expect(hook.result.current.isLive).toBe(false);
  hook.unmount();
  client.clear();
});

it('fences a cancelled page after reconnect', async () => {
  const pending = Promise.withResolvers<HostSourcePage>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.enumerate.mockReturnValueOnce(Object.assign(pending.promise, { cancel }));
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request }), { wrapper });
  await waitFor(() => expect(native.enumerate).toHaveBeenCalledTimes(1));
  act(() => {
    native.phase = 'disconnected';
    native.generation++;
    for (const listener of [...native.listeners]) listener();
  });
  expect(cancel).toHaveBeenCalledTimes(1);
  hook.rerender();
  native.phase = 'connected';
  hook.rerender();
  await waitFor(() => expect(hook.result.current.resources.data).toEqual(page));
  await act(async () => pending.resolve({ ...page, records: [] }));
  expect(client.getQueryData(resourceQueryKeys.list('provider', request))).toEqual(page);
  hook.unmount();
  client.clear();
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
  const hook = renderHook(
    ({ type }: { type: string }) =>
      useResolvedResourceTarget({ pluginID: 'provider', route: { connection: 'c' }, type }),
    { wrapper, initialProps: { type: 'items' } },
  );
  await waitFor(() => expect(hook.result.current.data?.targetId).toBe('target'));
  const pending = Promise.withResolvers<ResolvedResourceTarget>();
  native.resolveTarget.mockReturnValue(Object.assign(pending.promise, { cancel: vi.fn() }));
  hook.rerender({ type: 'other' });
  expect(hook.result.current.data).toBeUndefined();
  await act(async () => pending.reject(new Error('denied')));
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.data).toBeUndefined();
  hook.unmount();
  client.clear();
});

it('guards mutations and actions while disconnected', async () => {
  native.phase = 'disconnected';
  const { client, wrapper } = setup();
  const getRequest = {
    targetId: request.targetId,
    request: { route: row.route, reference: row.record.reference, representation: 'raw' },
  };
  const hook = renderHook(
    () => ({
      resource: useResource({ pluginID: 'provider', request: getRequest, enabled: false }),
      mutations: useResourceMutations({ pluginID: 'provider' }),
      action: useExecuteAction({ pluginID: 'provider' }),
    }),
    { wrapper },
  );
  const mutation: MutationRequest = {
    route: row.route,
    reference: row.record.reference,
    operation: 'create',
    input: { kind: 'map', value: {} },
  };
  const action: ActionRequest = {
    route: row.route,
    typeTarget: { provider: 'provider', authority: 'authority', type: 'items', scope: [] },
    action: 'install',
    input: { kind: 'map', value: {} },
  };
  await act(async () => {
    await expect(
      hook.result.current.resource.mutate({ operation: 'mutationUpdate', input: mutation.input }),
    ).rejects.toThrow('Connection is disconnected');
    await expect(hook.result.current.mutations.mutate(mutation)).rejects.toThrow(
      'Connection is disconnected',
    );
    await expect(hook.result.current.action.executeAction(action)).rejects.toThrow(
      'Connection is disconnected',
    );
  });
  expect(native.mutate).not.toHaveBeenCalled();
  expect(native.action).not.toHaveBeenCalled();
  hook.unmount();
  client.clear();
});

it('separates group caches by opaque route', async () => {
  native.groups.mockImplementation((_plugin: string, route: { connection: string }) =>
    ready([{ id: route.connection }]),
  );
  const { client, wrapper } = setup();
  const first = { connection: 'arn:aws:eks:region:account:cluster/team/name' };
  const second = { connection: `${first.connection}/second` };
  const hook = renderHook(
    () => ({
      first: useResourceGroups({ pluginID: 'provider', route: first }),
      second: useResourceGroups({ pluginID: 'provider', route: second }),
    }),
    { wrapper },
  );
  await waitFor(() =>
    expect(hook.result.current.first.groups.data).toEqual([{ id: first.connection }]),
  );
  expect(hook.result.current.second.groups.data).toEqual([{ id: second.connection }]);
  hook.unmount();
  client.clear();
});

const staleCauses: [string, (client: QueryClient) => Promise<void>][] = [
  ['time', (client) => { ageCatalog(client); return Promise.resolve(); }],
  ['invalidation while no screen was open', (client) => client.invalidateQueries({ queryKey: catalogKey })],
];

it.each(staleCauses)(
  'refreshes a catalog gone stale by %s when a screen reopens, but not when rows mount',
  async (_cause, makeStale) => {
    const { client, wrapper } = setup();
    const first = openScreen(wrapper);
    await waitFor(() => expect(first.result.current.resourceTypes.data?.[0].displayName).toBe('Pods'));
    first.unmount();
    await act(async () => {
      await makeStale(client);
    });
    native.catalog.mockImplementation(() => ready(catalogOf('Updated pods')));
    // Rows mount into the stale catalog while no screen is open. Scrolling is not a refresh.
    for (let index = 0; index < 3; index++) {
      const cell = mountCell(wrapper);
      expect(cell.result.current.resourceType.data?.displayName).toBe('Pods');
      cell.unmount();
    }
    await act(async () => {});
    expect(native.catalog).toHaveBeenCalledTimes(1);
    // Reopening the screen is intentional, so it refreshes the catalog once.
    const reopened = openScreen(wrapper);
    await waitFor(() =>
      expect(reopened.result.current.resourceTypes.data?.[0].displayName).toBe('Updated pods'),
    );
    expect(native.catalog).toHaveBeenCalledTimes(2);
    reopened.unmount();
    client.clear();
  },
);

it('refreshes a stale catalog on focus for screens only, although the app disables focus refetching', async () => {
  const { client, wrapper } = setup({ refetchOnWindowFocus: false });
  const cell = mountCell(wrapper);
  const page = openScreen(wrapper);
  await waitFor(() => expect(page.result.current.resourceTypes.data?.[0].displayName).toBe('Pods'));
  expect(native.catalog).toHaveBeenCalledTimes(1);
  ageCatalog(client);
  native.catalog.mockImplementation(() => ready(catalogOf('Updated pods')));
  refocus(client);
  await waitFor(() => expect(cell.result.current.resourceType.data?.displayName).toBe('Updated pods'));
  // One refresh of the shared query, not one per observer.
  expect(native.catalog).toHaveBeenCalledTimes(2);

  page.unmount();
  ageCatalog(client);
  native.catalog.mockImplementation(() => ready(catalogOf('Not requested')));
  refocus(client);
  expect(native.catalog).toHaveBeenCalledTimes(2);
  expect(cell.result.current.resourceType.data?.displayName).toBe('Updated pods');
  cell.unmount();
  client.clear();
});

it('does not retry a failed catalog when rows mount, and recovers when a screen reopens', async () => {
  native.catalog.mockImplementationOnce(() => denied('catalog timed out'));
  const { client, wrapper } = setup();
  const first = mountCell(wrapper);
  await waitFor(() => expect(first.result.current.resourceType.isError).toBe(true));
  expect(native.catalog).toHaveBeenCalledTimes(1);
  // Scrolling mounts many rows into a catalog with no data. None may retry it.
  for (let index = 0; index < 5; index++) {
    mountCell(wrapper).unmount();
  }
  await act(async () => {});
  expect(native.catalog).toHaveBeenCalledTimes(1);
  // Reopening a screen retries once, and the mounted row shares the recovered catalog.
  const page = openScreen(wrapper);
  await waitFor(() => expect(page.result.current.resourceTypes.data?.[0].displayName).toBe('Pods'));
  expect(first.result.current.resourceType.data?.displayName).toBe('Pods');
  expect(native.catalog).toHaveBeenCalledTimes(2);
  page.unmount();
  first.unmount();
  client.clear();
});

it('recovers a failed catalog on focus while a screen stays open', async () => {
  native.catalog.mockImplementationOnce(() => denied('catalog timed out'));
  const { client, wrapper } = setup({ refetchOnWindowFocus: false });
  const page = openScreen(wrapper);
  await waitFor(() => expect(page.result.current.resourceTypes.isError).toBe(true));
  refocus(client);
  await waitFor(() => expect(page.result.current.resourceTypes.data?.[0].displayName).toBe('Pods'));
  expect(native.catalog).toHaveBeenCalledTimes(2);
  page.unmount();
  client.clear();
});

it('requests no catalog until the connection is ready, then loads it once', async () => {
  native.phase = 'disconnected';
  const { client, wrapper } = setup();
  const page = openScreen(wrapper);
  const cell = mountCell(wrapper);
  await act(async () => {});
  expect(native.catalog).not.toHaveBeenCalled();
  expect(page.result.current.resourceTypes.data).toBeUndefined();
  native.phase = 'connected';
  page.rerender();
  cell.rerender();
  await waitFor(() => expect(page.result.current.resourceTypes.data?.[0].displayName).toBe('Pods'));
  expect(cell.result.current.resourceType.data?.displayName).toBe('Pods');
  expect(native.catalog).toHaveBeenCalledTimes(1);
  page.unmount();
  cell.unmount();
  client.clear();
});

it('keeps mounted consumers stable across an unchanged refresh and updates their labels when the catalog changed', async () => {
  const { client, wrapper } = setup();
  const view = renderHook(
    () => ({
      page: useResourceTypes({ pluginID: 'provider', route: podsRoute }).resourceTypes,
      cell: useResourceType({ pluginID: 'provider', route: podsRoute, type: 'pods' }).resourceType,
    }),
    { wrapper },
  );
  await waitFor(() => expect(view.result.current.cell.data?.displayName).toBe('Pods'));
  const before = view.result.current.cell.data;
  // An explicit refresh that returns an equivalent catalog changes nothing for a mounted cell.
  await act(async () => {
    await client.invalidateQueries({ queryKey: catalogKey });
  });
  expect(native.catalog).toHaveBeenCalledTimes(2);
  expect(view.result.current.cell.data).toBe(before);
  // A changed catalog reaches the still-mounted cell and screen without remounting either.
  native.catalog.mockImplementation(() => ready(catalogOf('Updated pods', 'ovc1.binding.changed')));
  await act(async () => {
    await client.invalidateQueries({ queryKey: catalogKey });
  });
  await waitFor(() => expect(view.result.current.cell.data?.displayName).toBe('Updated pods'));
  expect(view.result.current.page.data?.[0].displayName).toBe('Updated pods');
  expect(native.catalog).toHaveBeenCalledTimes(3);
  view.unmount();
  client.clear();
});

it('scopes the catalog to the connection generation, so a replaced target is never served under the same connection ID', async () => {
  const { client, wrapper } = setup();
  const page = openScreen(wrapper);
  const cell = mountCell(wrapper);
  await waitFor(() => expect(cell.result.current.resourceType.data?.displayName).toBe('Pods'));
  const before = cell.result.current.resourceType.data;
  expect(native.catalog).toHaveBeenCalledTimes(1);
  // A readiness publication without a new generation, such as a background check, is the same target.
  act(() => {
    for (const listener of [...native.listeners]) listener();
  });
  expect(native.catalog).toHaveBeenCalledTimes(1);
  expect(cell.result.current.resourceType.data).toBe(before);
  // The connection ID now reaches a different target.
  native.catalog.mockImplementation(() => ready(catalogOf('Replacement pods', 'ovc1.replacement.native')));
  act(() => {
    native.generation++;
    for (const listener of [...native.listeners]) listener();
  });
  expect(cell.result.current.resourceType.data).toBeUndefined();
  expect(page.result.current.resourceTypes.data).toBeUndefined();
  await waitFor(() => expect(cell.result.current.resourceType.data?.displayName).toBe('Replacement pods'));
  expect(page.result.current.resourceTypes.data?.[0].displayName).toBe('Replacement pods');
  // One load per generation, shared by both observers.
  expect(native.catalog).toHaveBeenCalledTimes(2);
  page.unmount();
  cell.unmount();
  client.clear();
});

it('rejects a catalog response that arrives after the connection generation changed', async () => {
  const stale = Promise.withResolvers<unknown>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.catalog.mockReturnValueOnce(Object.assign(stale.promise, { cancel }));
  const { client, wrapper } = setup();
  const cell = mountCell(wrapper);
  await waitFor(() => expect(native.catalog).toHaveBeenCalledTimes(1));
  native.catalog.mockImplementation(() => ready(catalogOf('Replacement pods', 'ovc1.replacement.native')));
  act(() => {
    native.generation++;
    for (const listener of [...native.listeners]) listener();
  });
  expect(cancel).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(cell.result.current.resourceType.data?.displayName).toBe('Replacement pods'));
  await act(async () => stale.resolve(catalogOf('Previous target pods', 'ovc1.previous.native')));
  expect(cell.result.current.resourceType.data?.displayName).toBe('Replacement pods');
  expect(client.getQueryData([...catalogKey, 1])).toBeUndefined();
  expect(native.catalog).toHaveBeenCalledTimes(2);
  cell.unmount();
  client.clear();
});

it('reacquires a target once when the host rejects the first resolution after a source replacement', async () => {
  native.resolveTarget
    .mockImplementationOnce(() => failed(resetRequired))
    .mockImplementationOnce(() => ready(targetOf('replacement-target')));
  const { client, wrapper } = setup();
  const screen = openScreen(wrapper);
  const cell = mountCell(wrapper);
  await waitFor(() => expect(cell.result.current.resourceType.data?.displayName).toBe('Pods'));
  native.catalog.mockImplementation(() => ready(catalogOf('Replacement pods')));
  const errors: boolean[] = [];
  const hook = renderHook(
    () => {
      const target = useResolvedResourceTarget({ pluginID: 'provider', route: podsRoute, type: 'items' });
      errors.push(target.isError);
      return target;
    },
    { wrapper },
  );
  await waitFor(() => expect(hook.result.current.data?.targetId).toBe('replacement-target'));
  expect(native.resolveTarget).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(cell.result.current.resourceType.data?.displayName).toBe('Replacement pods'));
  expect(native.catalog).toHaveBeenCalledTimes(2);
  // The restart belongs to the same acquisition, so the rejection is never shown as an error.
  expect(errors).not.toContain(true);
  hook.unmount();
  cell.unmount();
  screen.unmount();
  client.clear();
});

const targetFailures: [string, unknown[], number, string][] = [
  ['a second RESET_REQUIRED', [resetRequired, resetRequired], 2, 'RESET_REQUIRED'],
  ['another error after RESET_REQUIRED', [resetRequired, timedOut], 2, 'TIMEOUT'],
  ['an error that is not RESET_REQUIRED, without a second request', [timedOut], 1, 'TIMEOUT'],
];

it.each(targetFailures)('surfaces %s as the target error', async (_name, failures, calls, code) => {
  for (const failure of failures) native.resolveTarget.mockImplementationOnce(() => failed(failure));
  const { client, wrapper } = setup();
  const hook = mountTarget(wrapper);
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.error).toMatchObject({ code });
  expect(hook.result.current.data).toBeUndefined();
  expect(native.resolveTarget).toHaveBeenCalledTimes(calls);
  hook.unmount();
  client.clear();
});

it('re-resolves after a generation change and never exposes the previous target', async () => {
  native.resolveTarget.mockImplementationOnce(() => ready(targetOf('first-target')));
  const { client, wrapper } = setup();
  const hook = mountTarget(wrapper);
  await waitFor(() => expect(hook.result.current.data?.targetId).toBe('first-target'));
  const replacement = Promise.withResolvers<unknown>();
  native.resolveTarget.mockReturnValueOnce(Object.assign(replacement.promise, { cancel: vi.fn() }));
  // The connection ID now reaches a different target.
  act(() => {
    native.generation++;
    for (const listener of [...native.listeners]) listener();
  });
  expect(native.resolveTarget).toHaveBeenCalledTimes(2);
  expect(hook.result.current.data).toBeUndefined();
  await act(async () => replacement.resolve(targetOf('replacement-target')));
  await waitFor(() => expect(hook.result.current.data?.targetId).toBe('replacement-target'));
  expect(native.resolveTarget).toHaveBeenCalledTimes(2);
  hook.unmount();
  client.clear();
});

it('shares one catalog and one target resolution across mounts while the generation is unchanged', async () => {
  const { client, wrapper } = setup();
  const useConsumers = () => ({
    page: useResourceTypes({ pluginID: 'provider', route: podsRoute }).resourceTypes,
    cell: useResourceType({ pluginID: 'provider', route: podsRoute, type: 'pods' }).resourceType,
    target: useResolvedResourceTarget({ pluginID: 'provider', route: podsRoute, type: 'items' }),
  });
  const view = renderHook(useConsumers, { wrapper });
  await waitFor(() => expect(view.result.current.target.data?.targetId).toBe('target'));
  await waitFor(() => expect(view.result.current.page.data?.[0].displayName).toBe('Pods'));
  expect(native.catalog).toHaveBeenCalledTimes(1);
  expect(native.resolveTarget).toHaveBeenCalledTimes(1);
  // Rows come and go while the connection generation stays the same.
  for (let index = 0; index < 5; index++) {
    const row = renderHook(useConsumers, { wrapper });
    expect(row.result.current.cell.data?.displayName).toBe('Pods');
    expect(row.result.current.target.data?.targetId).toBe('target');
    row.unmount();
  }
  // A readiness publication without a new generation changes nothing.
  act(() => {
    for (const listener of [...native.listeners]) listener();
  });
  await act(async () => {});
  expect(native.catalog).toHaveBeenCalledTimes(1);
  expect(native.resolveTarget).toHaveBeenCalledTimes(1);
  // A new generation loads each once, shared by every observer.
  act(() => {
    native.generation++;
    for (const listener of [...native.listeners]) listener();
  });
  await waitFor(() => expect(view.result.current.target.data?.targetId).toBe('target'));
  await waitFor(() => expect(view.result.current.cell.data?.displayName).toBe('Pods'));
  expect(native.catalog).toHaveBeenCalledTimes(2);
  expect(native.resolveTarget).toHaveBeenCalledTimes(2);
  view.unmount();
  client.clear();
});

it('reuses a target admission across remounts within five minutes of resolving it, then resolves it again', async () => {
  // The app's queries are stale at once, so only the hook's own freshness window can spare the second resolution.
  const { client, wrapper } = setup({ staleTime: 0 });
  const first = mountTarget(wrapper);
  await waitFor(() => expect(first.result.current.data?.targetId).toBe('target'));
  first.unmount();
  await advance(4 * 60_000);
  const second = mountTarget(wrapper);
  expect(second.result.current.data?.targetId).toBe('target');
  await settle();
  expect(native.resolveTarget).toHaveBeenCalledTimes(1);
  second.unmount();
  await advance(90_000);
  const third = mountTarget(wrapper);
  // An admission past its window is hidden while it resolves again.
  expect(third.result.current.data).toBeUndefined();
  await waitFor(() => expect(third.result.current.data?.targetId).toBe('target'));
  expect(native.resolveTarget).toHaveBeenCalledTimes(2);
  third.unmount();
  client.clear();
});
