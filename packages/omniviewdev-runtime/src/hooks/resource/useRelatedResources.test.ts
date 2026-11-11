import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WailsRuntime from '@wailsio/runtime';
import { relationshipLabel, toRelatedResources, useRelatedResources } from './useRelatedResources';
import { useDependencyTree } from './useDependencyTree';
import { useResourceGraph } from './useResourceGraph';
import {
  sameGraphNode,
  type DependencyNode,
  type GraphEdge,
  type GraphNode,
  type HostGraphObservationRequest,
  type HostGraphObservationSnapshot,
} from '../../resource/v2/graph';

const native = vi.hoisted(() => ({
  call: vi.fn(),
  check: vi.fn(),
  listeners: new Map<string, Set<(event: { data: unknown }) => void>>(),
}));
vi.mock('@wailsio/runtime', async importOriginal => ({
  ...(await importOriginal<typeof WailsRuntime>()),
  Call: { ByName: native.call },
  Events: {
    On: (topic: string, listener: (event: { data: unknown }) => void) => {
      const listeners = native.listeners.get(topic) ?? new Set();
      listeners.add(listener);
      native.listeners.set(topic, listeners);
      return () => { listeners.delete(listener); };
    },
  },
}));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper', () => ({
  CheckConnection: native.check,
  StartConnection: vi.fn(),
  StopConnection: vi.fn(),
}));

const node = (type: string, id: string, namespace = ''): GraphNode => ({
  pluginId: 'kubernetes',
  key: `host-issued:${type}:${namespace}:${id}`,
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
const config = node('k8s:/configmaps', 'config', 'default');
const secret = node('k8s:/secrets', 'credentials', 'default');
const edges: GraphEdge[] = [
  { source: rs, target: pod, type: 'owns', label: 'owned by' },
  { source: pod, target: worker, type: 'runs_on', label: 'runs on' },
  { source: pod, target: config, type: 'uses', label: 'uses' },
  { source: config, target: secret, type: 'uses', label: 'uses' },
];
const reservations = new Map<string, HostGraphObservationRequest>();
const sequences = new Map<string, bigint>();
const service = 'github.com/omniviewdev/omniview/backend/pkg/plugin/resource.GraphService';

function cancellable<T>(value: T) {
  return Object.assign(Promise.resolve(value), { cancel: vi.fn(() => Promise.resolve()) });
}

/** Native topology fixture projects actual direction/depth, rather than echoing request options. */
function project(request: HostGraphObservationRequest): Partial<HostGraphObservationSnapshot> {
  const root = [rs, pod, worker, config, secret].find(value => sameGraphNode(value, {
    pluginId: request.pluginID, reference: request.reference, route: request.route,
  }));
  if (!root) throw new Error('The native fixture requires a known root.');
  if (request.kind === 'related') {
    return { edges: edges.filter(edge => {
      if (request.relationshipType && edge.type !== request.relationshipType) return false;
      return (request.direction !== 'incoming' && sameGraphNode(edge.source, root))
        || (request.direction !== 'outgoing' && sameGraphNode(edge.target, root));
    }) };
  }
  if (request.kind === 'tree') {
    const visited = new Set([root.key]);
    const descend = (current: GraphNode, depth: number): DependencyNode[] => {
      if (depth >= (request.maxDepth ?? 3)) return [];
      return edges.filter(edge => sameGraphNode(edge.source, current) && !visited.has(edge.target.key))
        .map(edge => {
          visited.add(edge.target.key);
          return { edge, children: descend(edge.target, depth + 1) };
        });
    };
    return { tree: { root, children: descend(root, 0) } };
  }
  if (request.kind === 'subgraph') {
    const nodes = [{ node: root, depth: 0 }];
    const seen = new Set([root.key]);
    for (const [sign, limit] of [[-1, request.upDepth ?? 2], [1, request.downDepth ?? 3]] as const) {
      const queue = [{ node: root, distance: 0 }];
      for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        if (current.distance >= limit) continue;
        for (const edge of edges) {
          if (!sameGraphNode(sign < 0 ? edge.target : edge.source, current.node)) continue;
          const next = sign < 0 ? edge.source : edge.target;
          if (seen.has(next.key)) continue;
          seen.add(next.key);
          const distance = current.distance + 1;
          nodes.push({ node: next, depth: distance * sign });
          queue.push({ node: next, distance });
        }
      }
    }
    return { subgraph: {
      root, nodes, edges: edges.filter(edge => seen.has(edge.source.key) && seen.has(edge.target.key)), truncated: false,
    } };
  }
  throw new Error('This fixture has no mounted chain consumer.');
}

beforeEach(() => {
  reservations.clear();
  sequences.clear();
  native.check.mockReset().mockImplementation(() => cancellable({
    status: 'CONNECTED', connection: { id: 'c1', name: 'Cluster' }, error: '', details: '',
  }));
  native.call.mockReset().mockImplementation((method: string, argument: HostGraphObservationRequest | string) => {
    if (method === `${service}.OpenGraphObservation` && typeof argument !== 'string') {
      reservations.set(argument.clientToken, argument);
      return cancellable({ observationId: argument.clientToken, topic: `resource/graph-observation/${argument.clientToken}` });
    }
    if (method === `${service}.CloseGraphObservation` && typeof argument === 'string') {
      reservations.delete(argument);
      return cancellable(undefined);
    }
    if (method === `${service}.SyncGraphObservation` && typeof argument === 'string') {
      const request = reservations.get(argument);
      if (!request) throw new Error('Sync requires an open reservation.');
      const sequence = (sequences.get(argument) ?? 0n) + 1n;
      sequences.set(argument, sequence);
      const snapshot: HostGraphObservationSnapshot = {
        observationId: argument, generation: `opaque:${argument}`, sequence: sequence.toString(), state: 'ready',
        ...project(request),
      };
      for (const listener of native.listeners.get(`resource/graph-observation/${argument}`) ?? []) listener({ data: snapshot });
      return cancellable(undefined);
    }
    throw new Error(`Unexpected native call: ${method}`);
  });
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  native.listeners.clear();
});

describe('toRelatedResources', () => {
  it('reports the far end and the direction from the viewed resource', () => {
    const related = toRelatedResources(pod, edges.slice(0, 2));
    expect(related).toEqual([
      { resource: rs, type: 'owns', direction: 'incoming', label: 'owned by' },
      { resource: worker, type: 'runs_on', direction: 'outgoing', label: 'runs on' },
    ]);
  });

  it('ignores the access route when comparing identity', () => {
    const self = { ...worker, route: { connection: 'alternate' } };
    const [related] = toRelatedResources(self, [edges[1]]);
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
  it('maps both incoming and outgoing native edges', async () => {
    const { result } = renderHook(() => useRelatedResources({
      pluginID: 'kubernetes', reference: pod.reference, route: pod.route,
    }));
    await waitFor(() => {
      expect(result.current.related).toEqual([
        { resource: rs, type: 'owns', direction: 'incoming', label: 'owned by' },
        { resource: worker, type: 'runs_on', direction: 'outgoing', label: 'runs on' },
        { resource: config, type: 'uses', direction: 'outgoing', label: 'uses' },
      ]);
    });
    expect(result.current.edges).toEqual(edges.slice(0, 3));
  });

  it('changes visible edges for direction and relationship type filters', async () => {
    const { result, rerender } = renderHook(({ direction, relationshipType }: {
      direction: 'incoming' | 'outgoing'; relationshipType?: string;
    }) => useRelatedResources({
      pluginID: 'kubernetes', reference: pod.reference, route: pod.route, direction, relationshipType,
    }), { initialProps: { direction: 'incoming', relationshipType: undefined } });
    await waitFor(() => { expect(result.current.related.map(value => value.resource)).toEqual([rs]); });
    rerender({ direction: 'outgoing', relationshipType: 'runs_on' });
    await waitFor(() => { expect(result.current.related.map(value => value.resource)).toEqual([worker]); });
    expect(result.current.related[0].direction).toBe('outgoing');
    rerender({ direction: 'incoming', relationshipType: 'runs_on' });
    await waitFor(() => { expect(result.current.related).toEqual([]); });
    expect(result.current.error).toBeNull();
  });

  it('does not acquire demand without a resource ID', () => {
    const { result } = renderHook(() => useRelatedResources({
      pluginID: 'kubernetes', reference: node('k8s:/pods', '').reference, route: pod.route,
    }));
    expect(result.current.related).toEqual([]);
    expect(result.current.isFetching).toBe(false);
    expect(reservations.size).toBe(0);
  });
});

function treeEdges(children: DependencyNode[]): GraphEdge[] {
  return children.flatMap(child => [child.edge, ...treeEdges(child.children)]);
}

describe('useDependencyTree', () => {
  it('changes the visible descendant closure at each requested depth', async () => {
    const { result, rerender } = renderHook(({ maxDepth }) => useDependencyTree({
      pluginID: 'kubernetes', reference: rs.reference, route: rs.route, maxDepth,
    }), { initialProps: { maxDepth: 1 } });
    await waitFor(() => { expect(treeEdges(result.current.tree?.children ?? [])).toEqual([edges[0]]); });
    rerender({ maxDepth: 2 });
    await waitFor(() => { expect(treeEdges(result.current.tree?.children ?? [])).toEqual(edges.slice(0, 3)); });
    rerender({ maxDepth: 3 });
    await waitFor(() => { expect(treeEdges(result.current.tree?.children ?? [])).toEqual(edges); });
  });
});

describe('useResourceGraph', () => {
  it('uses default depths for the full neighbourhood and preserves signed distances', async () => {
    const { result } = renderHook(() => useResourceGraph({
      pluginID: 'kubernetes', reference: pod.reference, route: pod.route,
    }));
    await waitFor(() => { expect(result.current.graph?.edges).toEqual(edges); });
    expect(result.current.graph?.nodes.map(value => [value.node.reference.address.id, value.depth])).toEqual([
      ['web-1', 0], ['web-abc', -1], ['worker-1', 1], ['config', 1], ['credentials', 2],
    ]);
    expect(result.current.graph?.truncated).toBe(false);
  });

  it('changes visible upstream and downstream closure independently', async () => {
    const { result, rerender } = renderHook(({ upDepth, downDepth }) => useResourceGraph({
      pluginID: 'kubernetes', reference: pod.reference, route: pod.route, upDepth, downDepth,
    }), { initialProps: { upDepth: 0, downDepth: 1 } });
    await waitFor(() => { expect(result.current.graph?.edges).toEqual(edges.slice(1, 3)); });
    rerender({ upDepth: 1, downDepth: 0 });
    await waitFor(() => { expect(result.current.graph?.edges).toEqual([edges[0]]); });
    expect(result.current.graph?.nodes.map(value => value.depth)).toEqual([0, -1]);
    rerender({ upDepth: 0, downDepth: 0 });
    await waitFor(() => { expect(result.current.graph?.edges).toEqual([]); });
    expect(result.current.graph?.nodes).toEqual([{ node: pod, depth: 0 }]);
  });
});
