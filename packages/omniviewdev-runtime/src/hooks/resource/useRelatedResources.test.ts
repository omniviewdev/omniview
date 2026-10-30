import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Mock } from 'vitest';

vi.mock('../useResolvedPluginId', () => ({
  useResolvedPluginId: (explicit?: string) => explicit ?? 'kubernetes',
}));

let connectionPhase = 'connected';
vi.mock('../connection/useConnectionReadiness', () => ({
  useConnectionReadiness: () => ({ phase: connectionPhase }),
}));
vi.mock('../../connection/connectionReadiness', () => ({
  getConnectionReadinessGeneration: () => 1,
  isConnectionReadinessCurrent: () => connectionPhase === 'connected',
  connectionReadinessStore: () => ({ subscribe: () => () => {} }),
}));

let mockGetRelated: Mock;
let mockGetDependencyTree: Mock;
let mockGetSubgraph: Mock;
vi.mock('../../resource/v2/graph-client', () => ({
  get GetRelated() {
    return mockGetRelated;
  },
  get GetDependencyTree() {
    return mockGetDependencyTree;
  },
  get GetSubgraph() {
    return mockGetSubgraph;
  },
}));

// Capture Events.On listeners so tests can fire host events.
const listeners = new Map<string, Set<() => void>>();
vi.mock('@wailsio/runtime', () => ({
  Events: {
    On: (name: string, cb: () => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(cb);
      listeners.set(name, set);
      return () => set.delete(cb);
    },
  },
}));

function emit(name: string) {
  for (const cb of listeners.get(name) ?? []) {
    cb();
  }
}

import { relationshipLabel, toRelatedResources, useRelatedResources } from './useRelatedResources';
import { useDependencyTree } from './useDependencyTree';
import { useResourceGraph } from './useResourceGraph';
import { sameGraphNode } from '../../resource/v2/graph';

const node = (type: string, id: string, namespace = '') => ({
  pluginId: 'kubernetes',
  key: 'host-issued-test-key',
  route: { connection: 'c1' },
  reference: {
    address: {
      provider: 'kubernetes', authority: 'host-issued-authority', type, id,
      scope: namespace ? [{ dimension: 'namespace', value: namespace }] : [],
    },
  },
});

const pod = node('k8s:/pods', 'web-1', 'default');
const rs = node('k8s:apps/replicasets', 'web-abc', 'default');
const worker = node('k8s:/nodes', 'worker-1');

function wrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  mockGetRelated = vi.fn();
  mockGetDependencyTree = vi.fn();
  mockGetSubgraph = vi.fn();
  listeners.clear();
  connectionPhase = 'connected';
});

describe('toRelatedResources', () => {
  it('reports the far end and the direction from the viewed resource', () => {
    const related = toRelatedResources(pod, [
      { source: pod, target: worker, type: 'runs_on', label: 'runs on' },
      // Declared by the Pod, so labelled from its side.
      { source: rs, target: pod, type: 'owns', label: 'owned by' },
    ] as any);

    expect(related).toEqual([
      { resource: worker, type: 'runs_on', direction: 'outgoing', label: 'runs on' },
      { resource: rs, type: 'owns', direction: 'incoming', label: 'owned by' },
    ]);
  });

  it('ignores the access route when comparing identity', () => {
    const self = { ...worker, route: { connection: 'alternate' } };
    const [related] = toRelatedResources(self as any, [
      { source: pod, target: worker, type: 'runs_on', label: 'runs on' },
    ] as any);
    expect(related.direction).toBe('incoming');
  });

  it('compares scope dimensions independent of order and includes incarnation', () => {
    const scope = [
      { dimension: 'cluster', value: 'cluster-a' },
      { dimension: 'namespace', value: 'default' },
    ];
    const first = {
      ...pod,
      reference: { ...pod.reference, incarnation: 'first', address: { ...pod.reference.address, scope } },
    };
    const reordered = {
      ...first,
      reference: { ...first.reference, address: { ...first.reference.address, scope: [...scope].reverse() } },
    };
    expect(sameGraphNode(first, reordered)).toBe(true);
    expect(sameGraphNode(first, { ...reordered, reference: { ...reordered.reference, incarnation: 'second' } })).toBe(false);
  });
});

describe('relationshipLabel', () => {
  it('names known types from either side', () => {
    expect(relationshipLabel('owns', 'outgoing')).toBe('Owns');
    expect(relationshipLabel('owns', 'incoming')).toBe('Owned by');
    expect(relationshipLabel('runs_on', 'incoming')).toBe('Running here');
  });

  it('falls back to the type name', () => {
    expect(relationshipLabel('peers_with', 'outgoing')).toBe('peers with');
    expect(relationshipLabel('peers_with', 'incoming')).toBe('peers with (incoming)');
  });
});

describe('useRelatedResources', () => {
  it('queries both directions and maps the edges', async () => {
    mockGetRelated.mockResolvedValue([{ source: pod, target: worker, type: 'runs_on', label: 'runs on' }]);

    const { result } = renderHook(() => useRelatedResources({
      reference: pod.reference, route: pod.route,
    }), { wrapper });

    await waitFor(() => {
      expect(result.current.related).toHaveLength(1);
    });
    expect(mockGetRelated).toHaveBeenCalledWith('kubernetes', pod.reference, pod.route, 'both', null);
    expect(result.current.related[0]).toMatchObject({ resource: worker, direction: 'outgoing' });
  });

  it('passes direction and type filters through', async () => {
    mockGetRelated.mockResolvedValue([]);

    renderHook(() => useRelatedResources({
      pluginID: 'other', reference: worker.reference, route: worker.route,
      direction: 'incoming', relationshipType: 'runs_on',
    }), { wrapper });

    await waitFor(() => {
      expect(mockGetRelated).toHaveBeenCalled();
    });
    expect(mockGetRelated).toHaveBeenCalledWith('other', worker.reference, worker.route, 'incoming', 'runs_on');
  });

  it('does not query without a resource ID', () => {
    const { result } = renderHook(() => useRelatedResources({
      reference: node('k8s:/pods', '').reference, route: pod.route,
    }), { wrapper });

    expect(mockGetRelated).not.toHaveBeenCalled();
    expect(result.current.related).toEqual([]);
  });

  it('blocks disconnected queries and graph listeners, then resumes and cleans up on disconnect', async () => {
    connectionPhase = 'disconnected';
    mockGetRelated.mockResolvedValue([]);
    const { rerender } = renderHook(() => useRelatedResources({
      pluginID: 'kubernetes', reference: pod.reference, route: pod.route,
    }), { wrapper });

    expect(mockGetRelated).not.toHaveBeenCalled();
    expect(listeners.get('kubernetes/c1/graph/CHANGED')?.size ?? 0).toBe(0);

    connectionPhase = 'connected';
    rerender();
    await waitFor(() => expect(mockGetRelated).toHaveBeenCalledTimes(1));
    expect(listeners.get('kubernetes/c1/graph/CHANGED')?.size).toBe(1);

    connectionPhase = 'disconnected';
    rerender();
    expect(listeners.get('kubernetes/c1/graph/CHANGED')?.size).toBe(0);
    act(() => emit('kubernetes/c1/graph/CHANGED'));
    expect(mockGetRelated).toHaveBeenCalledTimes(1);
  });
});

describe('graph change events', () => {
  it('refetches related resources when the connection graph changes', async () => {
    mockGetRelated.mockResolvedValueOnce([]).mockResolvedValue([{ source: pod, target: worker, type: 'runs_on', label: 'runs on' }]);

    const { result } = renderHook(() => useRelatedResources({
      reference: pod.reference, route: pod.route,
    }), { wrapper });

    await waitFor(() => {
      expect(mockGetRelated).toHaveBeenCalledTimes(1);
    });
    expect(result.current.related).toEqual([]);

    // Another connection's change is ignored.
    act(() => {
      emit('kubernetes/c2/graph/CHANGED');
    });
    act(() => {
      emit('kubernetes/c1/graph/CHANGED');
    });

    await waitFor(() => {
      expect(result.current.related).toHaveLength(1);
    });
    expect(mockGetRelated).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes on unmount and when disabled', () => {
    mockGetRelated.mockResolvedValue([]);

    const { unmount } = renderHook(() => useRelatedResources({
      reference: pod.reference, route: pod.route,
    }), { wrapper });

    expect(listeners.get('kubernetes/c1/graph/CHANGED')?.size).toBe(1);
    unmount();
    expect(listeners.get('kubernetes/c1/graph/CHANGED')?.size).toBe(0);

    renderHook(() => useRelatedResources({
      reference: pod.reference, route: pod.route, enabled: false,
    }), { wrapper });
    expect(listeners.get('kubernetes/c1/graph/CHANGED')?.size ?? 0).toBe(0);
  });

  it('refetches the dependency tree when the connection graph changes', async () => {
    mockGetDependencyTree.mockResolvedValue({ root: rs, children: [] });

    renderHook(() => useDependencyTree({
      reference: rs.reference, route: rs.route,
    }), { wrapper });

    await waitFor(() => {
      expect(mockGetDependencyTree).toHaveBeenCalledTimes(1);
    });
    act(() => {
      emit('kubernetes/c1/graph/CHANGED');
    });
    await waitFor(() => {
      expect(mockGetDependencyTree).toHaveBeenCalledTimes(2);
    });
  });
});

describe('useDependencyTree', () => {
  it('fetches the tree with the requested depth', async () => {
    const tree = { root: rs, children: [] };
    mockGetDependencyTree.mockResolvedValue(tree);

    const { result } = renderHook(() => useDependencyTree({
      reference: rs.reference, route: rs.route, maxDepth: 2,
    }), { wrapper });

    await waitFor(() => {
      expect(result.current.tree).toEqual(tree);
    });
    expect(mockGetDependencyTree).toHaveBeenCalledWith('kubernetes', rs.reference, rs.route, 2);
  });
});

describe('useResourceGraph', () => {
  it('fetches the subgraph with default depths and refetches on graph changes', async () => {
    const sg = { root: pod, nodes: [{ node: pod, depth: 0 }], edges: [], truncated: false };
    mockGetSubgraph.mockResolvedValue(sg);

    const { result } = renderHook(() => useResourceGraph({
      reference: pod.reference, route: pod.route,
    }), { wrapper });

    await waitFor(() => {
      expect(result.current.graph).toEqual(sg);
    });
    expect(mockGetSubgraph).toHaveBeenCalledWith('kubernetes', pod.reference, pod.route, 2, 3);

    act(() => {
      emit('kubernetes/c1/graph/CHANGED');
    });
    await waitFor(() => {
      expect(mockGetSubgraph).toHaveBeenCalledTimes(2);
    });
  });
});
