import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CancellablePromise } from '@wailsio/runtime/cancellable';
import { useResources } from './useResources';
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
  getConnectionReadinessGeneration: () => native.generation,
  isConnectionReadinessCurrent: (_plugin: string, _connection: string, generation: number) =>
    native.phase === 'connected' && generation === native.generation,
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
    representation: { id: 'raw', revision: 'r', schema: { state: 'absent' } },
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
function setup(queries: { refetchOnWindowFocus?: boolean } = {}) {
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
  for (const query of client.getQueryCache().findAll({ queryKey: catalogKey })) {
    client.setQueryData(query.queryKey, query.state.data, { updatedAt: 1 });
  }
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

beforeEach(() => {
  vi.clearAllMocks();
  native.phase = 'connected';
  native.generation = 1;
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
  await waitFor(() => expect(view.close).toHaveBeenCalledTimes(1));
  client.clear();
});

it('shares a source view until its last observer unmounts', async () => {
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
  await waitFor(() => expect(view.close).toHaveBeenCalledTimes(1));
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

it('closes a view that opens after its last observer unmounts', async () => {
  const pending = Promise.withResolvers<ReturnType<typeof source>>();
  native.open.mockReturnValue(pending.promise);
  const { client, wrapper } = setup();
  const hook = renderHook(() => useResources({ pluginID: 'provider', request, collection: true }), {
    wrapper,
  });
  await waitFor(() => expect(native.open).toHaveBeenCalledTimes(1));
  hook.unmount();
  const view = source();
  pending.resolve(view);
  await waitFor(() => expect(view.close).toHaveBeenCalledTimes(1));
  client.clear();
});

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
