import type { HostRecord } from '@omniviewdev/runtime/ui/v1';
import * as runtime from '@omniviewdev/runtime/ui/v1';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PodSort } from './sort';
import { hostRecord } from './testing';
import { usePods, type PodsView } from './usePods';

// `usePods` is the seam: it must drive the same fenced read chain the old screens use (catalog -> resolved target -> collection source
// view), unchanged, and add the first explicit page beside the collection (docs/ui-next/status/1a.2.md, "E10: the mechanism").
vi.mock('@omniviewdev/runtime/ui/v1', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return {
    ...actual,
    useConnectionReadiness: vi.fn(),
    useResourceTypes: vi.fn(),
    useResolvedResourceTarget: vi.fn(),
    useResources: vi.fn(),
  };
});

const readiness = vi.mocked(runtime.useConnectionReadiness);
const resourceTypes = vi.mocked(runtime.useResourceTypes);
const resolvedTarget = vi.mocked(runtime.useResolvedResourceTarget);
const resources = vi.mocked(runtime.useResources);

const target = { route: { connection: 'kind-a' }, provider: 'kubernetes', authority: 'local:a', type: 'k8s:/pods', scope: [], representation: 'kubernetes.object.v1/v1' };
const request = { targetId: 'target-1', request: { target, pageSize: 256 } };

const pod = (name: string, namespace = 'checkout', phase = 'Running') => hostRecord({ metadata: { name, namespace }, status: { phase } }, `row:${namespace}/${name}`);
const names = (rows: ReadonlyArray<{ readonly name: string }>) => rows.map((row) => row.name);

const connect = vi.fn(async () => undefined);
const retry = vi.fn(async () => undefined);
const refetchCollection = vi.fn(async () => undefined);
const refetchCatalog = vi.fn(async () => undefined);
const refetchTarget = vi.fn(async () => undefined);

type Answer = {
  readonly phase?: string;
  readonly message?: string;
  readonly types?: ReadonlyArray<{ readonly type: string; readonly operations?: readonly string[] }>;
  readonly catalogError?: unknown;
  readonly target?: boolean;
  readonly targetError?: unknown;
  /** The collection: records once its snapshot is complete. */
  readonly collection?: readonly HostRecord[];
  readonly collectionError?: unknown;
  readonly count?: { readonly kind: string; readonly value?: string };
  readonly source?: Record<string, unknown>;
  readonly fetching?: boolean;
  readonly live?: boolean;
  readonly syncing?: boolean;
  /** The first explicit page. */
  readonly page?: readonly HostRecord[];
};

const podType = { type: 'k8s:/pods', operations: ['enumerate', 'sourceUpdates'] };

function answer({ phase = 'connected', message, types = [podType], catalogError = null, target: targetReady = true, targetError = null, collection, collectionError = null, count, source, fetching = false, live = false, syncing = false, page }: Answer = {}) {
  readiness.mockReturnValue({ phase, message, connect, retry } as never);
  resourceTypes.mockReturnValue({
    resourceTypes: {
      data: catalogError === null ? types.map(({ type, operations = [] }) => ({ type, capabilities: operations.map((operation) => ({ operation, scope: [] })) })) : undefined,
      error: catalogError,
      refetch: refetchCatalog,
    },
  } as never);
  resolvedTarget.mockReturnValue({ data: targetReady ? { targetId: 'target-1', target } : undefined, error: targetError, refetch: refetchTarget } as never);
  resources.mockImplementation(((options: { collection?: boolean }) => options.collection
    ? {
      resources: { data: collection ? { records: collection } : undefined, error: collectionError, isFetching: fetching, refetch: refetchCollection },
      view: collection && count ? { count } : undefined,
      source,
      isLive: live,
      isSyncing: syncing,
    }
    : { resources: { data: page ? { records: page } : undefined, error: null } }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

type Props = {
  readonly sort?: PodSort;
};

const render = (sort?: PodSort) => renderHook<PodsView, Props>((props) => usePods({ connectionID: 'kind-a', ...props }), { initialProps: { sort } });

describe('the read chain: the old table\'s arguments, unchanged', () => {
  it('asks the catalog, resolves the target, then reads the collection live, with the first page beside it', () => {
    answer({ types: [{ type: 'k8s:/pods', operations: ['enumerate', 'sourceUpdates'] }] });

    render();

    expect(readiness).toHaveBeenCalledWith({ pluginID: 'kubernetes', connectionID: 'kind-a' });
    expect(resourceTypes).toHaveBeenCalledWith({ pluginID: 'kubernetes', route: { connection: 'kind-a' } });
    expect(resolvedTarget).toHaveBeenCalledWith({ pluginID: 'kubernetes', route: { connection: 'kind-a' }, type: 'k8s:/pods', enabled: true });
    expect(resources).toHaveBeenCalledWith({ pluginID: 'kubernetes', request, collection: true, live: true });
    expect(resources).toHaveBeenCalledWith({ pluginID: 'kubernetes', request, collection: false });
  });

  it('follows the source live only when the Pod type advertises sourceUpdates', () => {
    answer({ types: [{ type: 'k8s:/pods', operations: ['enumerate'] }] });

    render();

    expect(resources).toHaveBeenCalledWith(expect.objectContaining({ collection: true, live: false }));
  });

  it('does not resolve a target until the catalog lists the Pod type, and reads nothing before the target answers', () => {
    answer({ types: [{ type: 'k8s:apps/deployments', operations: ['enumerate'] }], target: false });

    render();

    expect(resolvedTarget).toHaveBeenCalledWith(expect.objectContaining({ type: 'k8s:/pods', enabled: false }));
    for (const call of resources.mock.calls) {
      expect(call[0]).toMatchObject({ request: undefined });
    }
  });

  it('stops reading the first page as soon as the collection is complete', () => {
    answer({ collection: [pod('a')], page: [pod('a')] });

    render();

    const pageCalls = resources.mock.calls.filter(([options]) => options.collection !== true);
    expect(pageCalls.at(-1)?.[0]).toMatchObject({ collection: false, request: undefined });
  });
});

describe('the bounded first set (owner decision A10)', () => {
  it('shows the first page before the collection completes: the rows, how many, and that the set is not complete', () => {
    answer({ page: [pod('zeta'), pod('alpha'), pod('mid')] });

    const { result } = render();

    expect(names(result.current.rows)).toEqual(['alpha', 'mid', 'zeta']);
    expect(result.current).toMatchObject({ loaded: 3, complete: false, count: { kind: 'unknown', loaded: '3' }, state: { kind: 'loaded' } });
  });

  it('hands over to the collection when it completes: the whole set, an exact count, the same keys', () => {
    const first = [pod('alpha'), pod('mid')];
    answer({ page: first });
    const { result, rerender } = render();
    const before = result.current.rows;

    answer({ page: first, collection: [...first, pod('zeta'), pod('beta')], count: { kind: 'exact', value: '4' } });
    rerender({});

    expect(names(result.current.rows)).toEqual(['alpha', 'beta', 'mid', 'zeta']);
    expect(result.current).toMatchObject({ loaded: 4, complete: true, count: { kind: 'exact', value: '4' } });
    expect(result.current.rows.find((row) => row.name === 'alpha')).toBe(before.find((row) => row.name === 'alpha'));
  });

  it('keeps the order of the first set while it is provisional, whatever else the page says', () => {
    const page = [pod('zeta'), pod('alpha'), pod('mid')];
    answer({ page });
    const { result, rerender } = render();
    const first = result.current.rows;

    answer({ page, fetching: true });
    rerender({});

    expect(result.current.rows).toBe(first);
  });

  it('re-sorts the rows it holds when the user changes the sort, and only then', () => {
    answer({ page: [pod('zeta'), pod('alpha'), pod('mid')] });
    const { result, rerender } = render({ id: 'name', direction: 'asc' });

    rerender({ sort: { id: 'name', direction: 'desc' } });

    expect(names(result.current.rows)).toEqual(['zeta', 'mid', 'alpha']);
  });

  it('sorts the complete set once it arrives, and follows the sort while it is live', () => {
    answer({ page: [pod('b')], collection: [pod('b'), pod('d')] });
    const { result, rerender } = render();
    expect(names(result.current.rows)).toEqual(['b', 'd']);

    answer({ collection: [pod('b'), pod('d'), pod('a'), pod('c')] });
    rerender({});

    expect(names(result.current.rows)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('gives the same rows array while nothing changed, so an unrelated update re-renders nothing', () => {
    const collection = [pod('a'), pod('b')];
    answer({ collection });
    const { result, rerender } = render();
    const rows = result.current.rows;

    answer({ collection, live: true });
    rerender({});

    expect(result.current.rows).toBe(rows);
  });

  it('counts a complete set by its records', () => {
    answer({ collection: [pod('a'), pod('b')] });

    expect(render().result.current.count).toEqual({ kind: 'exact', value: '2' });
  });

  it('does not trust the count of the source view: it is not kept live (captured on the real host: after a Pod was added the source still said 5025 with 5026 rows held)', () => {
    answer({ collection: [pod('a'), pod('b'), pod('c')], count: { kind: 'exact', value: '2' } });

    expect(render().result.current.count).toEqual({ kind: 'exact', value: '3' });
  });
});

describe('the states', () => {
  it('shows no row of a connection that is not connected, whatever the hooks still hold', () => {
    answer({ phase: 'disconnected', collection: [pod('a')], page: [pod('a')] });

    const { result } = render();

    expect(result.current).toMatchObject({ state: { kind: 'disconnected' }, rows: [], loaded: 0, complete: false });
  });

  it('is loading until the first rows arrive, then empty only for a complete empty set', () => {
    answer();
    expect(render().result.current.state).toEqual({ kind: 'loading' });

    cleanup();
    answer({ collection: [] });
    expect(render().result.current.state).toEqual({ kind: 'empty' });
  });

  it('files a failed read as denied when no row came, and keeps the rows when they did', () => {
    const forbidden = { code: 'FORBIDDEN', title: '', message: 'Source session failed.' };

    answer({ collectionError: forbidden });
    expect(render().result.current).toMatchObject({ state: { kind: 'denied' }, rows: [], failure: undefined });

    cleanup();
    answer({ collectionError: forbidden, page: [pod('a'), pod('b')] });
    expect(render().result.current).toMatchObject({ state: { kind: 'loaded' }, loaded: 2, failure: { kind: 'denied' } });
  });

  it('files a catalog that fails, and a cluster that does not serve Pods', () => {
    answer({ catalogError: { type: 'omniview:resource/forbidden', title: 'x', status: 403, detail: 'y' }, target: false });
    expect(render().result.current.state).toMatchObject({ kind: 'denied' });

    cleanup();
    answer({ types: [{ type: 'k8s:apps/deployments' }], target: false });
    expect(render().result.current.state).toEqual({ kind: 'unsupported' });
  });

  it('reports a live source, and a refresh that is running on a complete set', () => {
    answer({ collection: [pod('a')], live: true, fetching: true });

    const { result } = render();

    expect(result.current).toMatchObject({ live: true, refreshing: true });
  });

  it('is not refreshing while the first set is still loading', () => {
    answer({ page: [pod('a')], fetching: true });

    expect(render().result.current.refreshing).toBe(false);
  });
});

describe('the commands: explicit, and each does one thing', () => {
  it('connect starts the connection; nothing starts it by itself', async () => {
    answer({ phase: 'disconnected' });
    const { result } = render();
    expect(connect).not.toHaveBeenCalled();

    await act(async () => result.current.connect());

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('retry checks the connection again when it is not connected', async () => {
    answer({ phase: 'error', message: 'resource operation failed' });
    const { result } = render();

    await act(async () => result.current.retry());

    expect(retry).toHaveBeenCalledTimes(1);
    expect(refetchCollection).not.toHaveBeenCalled();
  });

  it('retry asks again for what failed: the catalog, then the target, then the collection', async () => {
    const broken = { type: 'omniview:internal', title: 'x', status: 500, detail: 'y' };

    answer({ catalogError: broken });
    const catalog = render();
    await act(async () => catalog.result.current.retry());
    expect(refetchCatalog).toHaveBeenCalledTimes(1);
    cleanup();

    answer({ targetError: broken });
    const targeted = render();
    await act(async () => targeted.result.current.retry());
    expect(refetchTarget).toHaveBeenCalledTimes(1);
    cleanup();

    answer({ collectionError: broken });
    const collected = render();
    await act(async () => collected.result.current.retry());
    expect(refetchCollection).toHaveBeenCalledTimes(1);
  });

  it('refresh refreshes the collection, and a failure is the state, not an exception', async () => {
    refetchCollection.mockRejectedValueOnce(new Error('refresh failed'));
    answer({ collection: [pod('a')] });
    const { result } = render();

    await act(async () => result.current.refresh());

    expect(refetchCollection).toHaveBeenCalledTimes(1);
  });
});

// The data-layer items of docs/ui-next/optimisations.md that this hook touches (2.1, 11.2). Each is a guard the inventory asks for.
describe('must not regress: the data layer (optimisations.md MNR-D1, D3, D5, D6)', () => {
  it('MNR-D1: one source view, the collection; the first page is a finite read, not a second view', () => {
    answer({ page: [pod('a')] });

    render();

    expect(resources.mock.calls.filter(([options]) => options.collection === true)).toHaveLength(1);
    expect(resources.mock.calls.filter(([options]) => options.collection !== true)).toHaveLength(1);
  });

  it('MNR-D5: every page request asks for at most 256 records, and for no tiny page', () => {
    answer({ page: [pod('a')] });

    render();

    for (const [options] of resources.mock.calls) {
      const pageSize = options.request?.request.pageSize ?? 0;
      expect(pageSize).toBeLessThanOrEqual(256);
      expect(pageSize).toBeGreaterThanOrEqual(64);
    }
  });

  it('MNR-D3: the order of the rows does not depend on the order the host delivers them in', () => {
    const names = ['pod-10', 'pod-2', 'alpha', 'pod-1', 'Zeta', 'mid'];
    const records = names.map((name) => pod(name));
    const shuffled = [4, 0, 5, 2, 1, 3].map((index) => records[index]);

    answer({ collection: records });
    const sorted = render().result.current.rows.map((row) => row.key);
    cleanup();
    answer({ collection: shuffled });

    expect(render().result.current.rows.map((row) => row.key)).toEqual(sorted);
  });

  it('MNR-D3: a connection that leaves `connected` clears the rows: nothing is applied across a generation', () => {
    answer({ collection: [pod('a'), pod('b')] });
    const { result, rerender } = render();
    expect(result.current.loaded).toBe(2);

    answer({ phase: 'checking', collection: [pod('a'), pod('b')] });
    rerender({});

    expect(result.current).toMatchObject({ rows: [], loaded: 0, complete: false, state: { kind: 'connecting' } });
  });

  it('MNR-D6: a failed read is shown once and never asked for again by the hook', () => {
    const forbidden = { code: 'FORBIDDEN', title: '', message: 'Source session failed.' };
    answer({ collectionError: forbidden });

    const { rerender } = render();
    rerender({});
    rerender({});

    for (const refetch of [refetchCollection, refetchCatalog, refetchTarget, retry, connect]) {
      expect(refetch).not.toHaveBeenCalled();
    }
  });
});
