import { jsonToValue, type HostRecord } from '@omniviewdev/runtime';
import * as runtime from '@omniviewdev/runtime';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PodsSkeleton } from './PodsSkeleton';

// The runtime is the seam under test: the skeleton must drive the same read chain the old screens use, unchanged
// (catalog -> resolved target -> collection source view), and must not read before each step has answered.
vi.mock('@omniviewdev/runtime', async (importActual) => {
  const actual = await importActual<typeof runtime>();
  return {
    ...actual,
    ActivityProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useConnections: vi.fn(),
    useConnectionReadiness: vi.fn(),
    useResourceTypes: vi.fn(),
    useResolvedResourceTarget: vi.fn(),
    useResources: vi.fn(),
  };
});

const connections = vi.mocked(runtime.useConnections);
const readiness = vi.mocked(runtime.useConnectionReadiness);
const resourceTypes = vi.mocked(runtime.useResourceTypes);
const resolvedTarget = vi.mocked(runtime.useResolvedResourceTarget);
const resources = vi.mocked(runtime.useResources);

const target = { route: { connection: 'kind-a' }, provider: 'kubernetes', authority: 'local:a', type: 'k8s:/pods', scope: [], representation: 'kubernetes.object.v1/v1' };
const cartApi: HostRecord = {
  key: 'row:1',
  addressKey: 'address:1',
  targetId: 'target-1',
  route: { connection: 'kind-a' },
  record: {
    reference: { address: { provider: 'kubernetes', authority: 'local:a', type: 'k8s:/pods', scope: [{ dimension: 'namespace', value: 'checkout' }], id: 'cart-api-1' } },
    body: jsonToValue({ metadata: { name: 'cart-api-1', namespace: 'checkout' } }),
    representation: { id: 'kubernetes.object.v1/v1', revision: 'kubernetes.object.v1/v1' },
    coverage: { kind: 'complete', paths: [] },
  },
};
const connect = vi.fn(async () => undefined);

// The hooks return react-query results; only the fields the skeleton reads are given.
type TypeAnswer = { readonly type: string; readonly operations?: readonly string[] };
const podType: TypeAnswer = { type: 'k8s:/pods', operations: ['enumerate', 'sourceUpdates'] };

function answer({ phase = 'connected', types = [podType], targetReady = true }: { phase?: string; types?: readonly TypeAnswer[]; targetReady?: boolean } = {}) {
  connections.mockReturnValue({ connections: { data: [{ id: 'kind-a' }, { id: 'kind-b' }], isPending: false } } as never);
  readiness.mockReturnValue({ phase, connect, retry: vi.fn() } as never);
  resourceTypes.mockReturnValue({
    resourceTypes: { data: types.map(({ type, operations = [] }) => ({ type, capabilities: operations.map((operation) => ({ operation, scope: [] })) })) },
  } as never);
  resolvedTarget.mockReturnValue({ data: targetReady ? { targetId: 'target-1', target } : undefined } as never);
  resources.mockReturnValue({ resources: { data: { records: [cartApi] } }, isLive: true } as never);
}

beforeEach(() => {
  window.history.replaceState(null, '', '/?screen=pods');
  connect.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PodsSkeleton', () => {
  it('reads the Pod collection live through the resolved target and shows each name', () => {
    answer();

    render(<PodsSkeleton />);

    expect(resourceTypes).toHaveBeenCalledWith({ pluginID: 'kubernetes', route: { connection: 'kind-a' } });
    expect(resolvedTarget).toHaveBeenCalledWith({ pluginID: 'kubernetes', route: { connection: 'kind-a' }, type: 'k8s:/pods', enabled: true });
    expect(resources).toHaveBeenLastCalledWith({
      pluginID: 'kubernetes',
      request: { targetId: 'target-1', request: { target, pageSize: 256 } },
      collection: true,
      live: true,
    });
    expect(screen.getAllByTestId('pod-name').map((node) => node.textContent)).toEqual(['checkout/cart-api-1']);
    expect(screen.getByTestId('pods-status')).toHaveTextContent('kind-a · connected · live · 1 pods');
  });

  it('follows the source live only when the Pod type advertises sourceUpdates, as the old table does', () => {
    answer({ types: [{ type: 'k8s:/pods', operations: ['enumerate'] }] });

    render(<PodsSkeleton />);

    expect(resources).toHaveBeenLastCalledWith(expect.objectContaining({ collection: true, live: false }));
  });

  it('does not resolve a target until the catalog lists the Pod type, and acquires nothing before the target answers', () => {
    answer({ types: [{ type: 'k8s:apps/deployments', operations: ['enumerate', 'sourceUpdates'] }], targetReady: false });

    render(<PodsSkeleton />);

    expect(resolvedTarget).toHaveBeenCalledWith(expect.objectContaining({ type: 'k8s:/pods', enabled: false }));
    expect(resources).toHaveBeenLastCalledWith(expect.objectContaining({ request: undefined, collection: true }));
  });

  it('starts a disconnected connection once, and never starts one that is not', () => {
    answer({ phase: 'disconnected' });
    const { rerender } = render(<PodsSkeleton />);
    rerender(<PodsSkeleton />);
    expect(connect).toHaveBeenCalledTimes(1);

    cleanup();
    connect.mockClear();
    answer({ phase: 'connecting' });
    render(<PodsSkeleton />);
    expect(connect).not.toHaveBeenCalled();
  });

  it('opens the connection named in the URL, else the first one', () => {
    answer();
    window.history.replaceState(null, '', '/?screen=pods&connection=kind-b');
    render(<PodsSkeleton />);
    expect(screen.getByTestId('pods-status')).toHaveTextContent('kind-b · connected');

    cleanup();
    window.history.replaceState(null, '', '/?screen=pods&connection=missing');
    render(<PodsSkeleton />);
    expect(screen.getByTestId('pods-status')).toHaveTextContent('kind-a · connected');
  });
});
