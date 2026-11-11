import React, { type ComponentType } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as WailsRuntime from '@wailsio/runtime';
import type { AccessRoute, ResourceReference } from '../../resource/v2/domain';
import type { DependencyNode, DependencyTree, GraphEdge, GraphNode, RelatedRequest, Subgraph } from '../../resource/v2/graph';
import { useRelatedResources } from './useRelatedResources';
import { useDependencyTree } from './useDependencyTree';
import { useResourceGraph } from './useResourceGraph';
import { GetDependencyTree, GetRelated, GetRelationshipChain, GetSubgraph } from '../../resource/v2/graph-client';

const native = vi.hoisted(() => ({
  call: vi.fn(),
  check: vi.fn(),
  listeners: new Map<string, Set<(event: { data: unknown }) => void>>(),
}));

vi.mock('@wailsio/runtime', async (importOriginal) => ({
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

type GraphKind = 'related' | 'tree' | 'subgraph';

// Native wire fixtures follow graph-demand-public-contract.md. Production clients and hooks are real.
interface ObservationRequest {
  clientToken: string;
  pluginID: string;
  reference: ResourceReference;
  route: AccessRoute;
  kind: GraphKind;
  direction?: string;
  relationshipType?: string | null;
  maxDepth?: number;
  upDepth?: number;
  downDepth?: number;
}
interface ObservationOpened { observationId: string; topic: string }
interface ObservationSnapshot {
  observationId: string;
  generation: string;
  sequence: string;
  state: 'pending' | 'ready' | 'failed';
  edges?: GraphEdge[];
  tree?: DependencyTree | null;
  subgraph?: Subgraph | null;
  error?: { code: string; title: string; message: string };
}

const service = 'github.com/omniviewdev/omniview/backend/pkg/plugin/resource.GraphService';
const baselineGeneration = 'b9fca71b-caaa-4adc-931a-16fa249009e4';
const foreignToken = '85081163-a8f8-428e-bf38-33ca3d73be28';
const foreignGeneration = '03d3e29c-717f-4f2b-a02a-d8992938d48c';
const route: AccessRoute = { connection: 'cluster' };
const topicFor = (token: string) => `resource/graph-observation/${token}`;

function node(type: string, id: string): GraphNode {
  return {
    key: `native-issued-key:${type}:${id}`,
    pluginId: 'kubernetes',
    route,
    reference: {
      address: {
        provider: 'kubernetes', authority: 'native-issued-authority', type, id,
        scope: type === 'k8s:/pods' ? [{ dimension: 'namespace', value: 'default' }] : [],
      },
      incarnation: `native-incarnation:${id}`,
    },
  };
}

const pod = node('k8s:/pods', 'web-1');
const nextPod = node('k8s:/pods', 'web-2');
const workerA = node('k8s:/nodes', 'worker-a');
const workerB = node('k8s:/nodes', 'worker-b');
const poison = node('k8s:/nodes', 'wrong-owner-or-stale');

function projection(reference: ResourceReference, accessRoute: AccessRoute, target: GraphNode | null) {
  const root: GraphNode = { ...pod, reference, route: accessRoute, key: `native-issued-root:${reference.address.id}` };
  const edges: GraphEdge[] = target ? [{ source: root, target, type: 'runs_on', label: 'runs on' }] : [];
  const tree: DependencyTree = { root, children: edges.map(edge => ({ edge, children: [] })) };
  const subgraph: Subgraph = {
    root,
    nodes: [{ node: root, depth: 0 }, ...(target ? [{ node: target, depth: 1 }] : [])],
    edges,
    truncated: false,
  };
  return { edges, tree, subgraph };
}

function cancellable<T>(value: T | Promise<T>) {
  return Object.assign(Promise.resolve(value), { cancel: vi.fn(() => Promise.resolve()) });
}

function emit(topic: string, data: unknown) {
  for (const listener of native.listeners.get(topic) ?? []) listener({ data });
}

async function deliverNativeEvent(topic: string, data: unknown) {
  await act(async () => {
    emit(topic, data);
    // Flush queued React work before asserting that a frame was rejected.
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });
}

class NativeGraph {
  target: GraphNode | null = workerA;
  finiteRelatedTargets?: GraphNode[];
  holdNextOpen = false;
  failNextSync = false;
  openPatch: Partial<ObservationOpened> = {};
  readonly requests: ObservationRequest[] = [];
  readonly reservations = new Map<string, ObservationRequest>();
  readonly populationLeases = new Set<string>();
  readonly retired = new Set<string>();
  readonly refreshes = new Set<string>();
  readonly activationAfterRetirement = new Set<string>();
  readonly finiteReads: string[] = [];
  readonly pendingOpens = new Map<string, { opened: ObservationOpened; resolve: (opened: ObservationOpened) => void }>();
  private readonly generations = new Map<string, string>();
  private readonly sequences = new Map<string, bigint>();
  private readonly synced = new Set<string>();

  latest(kind: GraphKind) {
    for (let index = this.requests.length - 1; index >= 0; index--) {
      if (this.requests[index].kind === kind) return this.requests[index];
    }
    return undefined;
  }

  frame(kind: GraphKind, target: GraphNode | null, token: string, patch: Partial<ObservationSnapshot> = {}): ObservationSnapshot {
    const request = this.requests.find(value => value.clientToken === token);
    const sequence = (this.sequences.get(token) ?? 0n) + 1n;
    this.sequences.set(token, sequence);
    const state = patch.state ?? 'ready';
    const value = projection(request?.reference ?? pod.reference, request?.route ?? route, target);
    let payload: Partial<ObservationSnapshot> = {};
    if (state === 'ready') {
      // Go omits an empty related edge slice. A complete empty snapshot must still replace old edges.
      if (kind === 'related') payload = value.edges.length ? { edges: value.edges } : {};
      if (kind === 'tree') payload = { tree: value.tree };
      if (kind === 'subgraph') payload = { subgraph: value.subgraph };
    }
    return {
      observationId: token,
      generation: this.generations.get(token) ?? baselineGeneration,
      sequence: sequence.toString(),
      state,
      ...payload,
      ...patch,
    };
  }

  publish(kind: GraphKind, target: GraphNode | null, patch: Partial<ObservationSnapshot> = {}, token = this.latest(kind)?.clientToken) {
    if (!token) throw new Error('Publishing requires an actual native graph observation reservation.');
    this.target = target;
    if (patch.state !== 'pending') this.refreshes.delete(token);
    if (patch.state === 'failed') this.populationLeases.delete(token);
    else if (this.reservations.has(token)) this.populationLeases.add(token);
    emit(topicFor(token), this.frame(kind, target, token, patch));
  }

  completeOpen(token: string) {
    const pending = this.pendingOpens.get(token);
    if (!pending) throw new Error('No held native Open acknowledgment exists for this token.');
    this.pendingOpens.delete(token);
    pending.resolve(pending.opened);
  }

  call(method: string, first: string | ObservationRequest | RelatedRequest, reference = pod.reference, accessRoute = route): Promise<unknown> {
    switch (method) {
      case `${service}.OpenGraphObservation`: {
        if (typeof first === 'string' || !('clientToken' in first)) throw new Error('Open requires the published graph request.');
        const token = first.clientToken;
        if (this.retired.has(token)) return cancellable(Promise.reject(new Error('Graph observation already closed.')));
        this.requests.push(first);
        this.reservations.set(token, first);
        this.generations.set(token, crypto.randomUUID());
        const opened: ObservationOpened = { observationId: token, topic: topicFor(token), ...this.openPatch };
        if (!this.holdNextOpen) return cancellable(opened);
        this.holdNextOpen = false;
        const { promise, resolve } = Promise.withResolvers<ObservationOpened>();
        this.pendingOpens.set(token, { opened, resolve });
        return cancellable(promise);
      }
      case `${service}.SyncGraphObservation`: {
        if (typeof first !== 'string') throw new Error('Observation control requires its ID.');
        const request = this.reservations.get(first);
        if (!request || this.retired.has(first)) {
          this.activationAfterRetirement.add(first);
          return cancellable(Promise.reject(new Error('Graph observation already closed.')));
        }
        if (this.failNextSync) {
          this.failNextSync = false;
          return cancellable(Promise.reject({ code: 'UNAVAILABLE', title: 'Graph unavailable', message: 'Graph Sync failed.' }));
        }
        this.populationLeases.add(first);
        // Synchronous delivery proves the real receiver exists before Sync activates populations.
        emit(topicFor(first), this.frame(request.kind, this.target, first, { state: 'pending' }));
        if (this.synced.has(first)) this.refreshes.add(first);
        else {
          this.synced.add(first);
          emit(topicFor(first), this.frame(request.kind, this.target, first));
        }
        return cancellable(undefined);
      }
      case `${service}.CloseGraphObservation`:
        if (typeof first !== 'string') throw new Error('Close requires its ID, including before Open acknowledges.');
        this.retired.add(first);
        this.populationLeases.delete(first);
        this.reservations.delete(first);
        return cancellable(undefined);
      case `${service}.GetRelated`: {
        if (typeof first === 'string' || 'clientToken' in first) throw new Error('GetRelated requires the finite request.');
        this.finiteReads.push(method);
        const edges = (this.finiteRelatedTargets ?? [this.target])
          .flatMap(target => projection(first.reference, first.route, target).edges);
        const limit = first.limit ?? 0;
        return cancellable({ edges: limit ? edges.slice(0, limit) : edges, truncated: limit > 0 && edges.length > limit });
      }
      case `${service}.GetRelationshipChain`:
        this.finiteReads.push(method);
        return cancellable([projection(reference, accessRoute, this.target).edges]);
      case `${service}.GetDependencyTree`:
        this.finiteReads.push(method);
        return cancellable(projection(reference, accessRoute, this.target).tree);
      case `${service}.GetSubgraph`:
        this.finiteReads.push(method);
        return cancellable(projection(reference, accessRoute, this.target).subgraph);
      default:
        throw new Error(`Unexpected native graph method: ${method}`);
    }
  }
}

interface PanelProps {
  reference?: ResourceReference;
  route?: AccessRoute;
  enabled?: boolean;
  options?: {
    direction?: 'incoming' | 'outgoing' | 'both';
    relationshipType?: string;
    maxDepth?: number;
    upDepth?: number;
    downDepth?: number;
  };
}
interface ProjectionViewProps {
  edges: GraphEdge[];
  loading: boolean;
  fetching: boolean;
  error: unknown;
  refresh: () => unknown;
}

function ProjectionView({ edges, loading, fetching, error, refresh }: ProjectionViewProps) {
  return <section>
    <ul aria-label="graph edges">{edges.map(edge =>
      <li key={`${edge.source.key}:${edge.target.key}:${edge.type}`}>{edge.source.reference.address.id} → {edge.target.reference.address.id}</li>,
    )}</ul>
    <output aria-label="graph state">{error ? 'failed' : loading ? 'pending' : fetching ? 'refreshing' : 'ready'}</output>
    <output aria-label="graph error">{error ? error instanceof Error ? error.message : 'Graph observation failed.' : ''}</output>
    <button onClick={() => { void Promise.resolve(refresh()).catch(() => {}); }}>Refresh graph</button>
  </section>;
}

function RelatedPanel({ reference = pod.reference, route: accessRoute = route, enabled = true, options }: PanelProps) {
  const query = useRelatedResources({
    pluginID: 'kubernetes', reference, route: accessRoute, enabled,
    direction: options?.direction, relationshipType: options?.relationshipType,
  });
  return <ProjectionView edges={query.edges} loading={query.isLoading} fetching={query.isFetching} error={query.error} refresh={query.refetch} />;
}

function treeEdges(children: DependencyNode[]): GraphEdge[] {
  return children.flatMap(child => [child.edge, ...treeEdges(child.children)]);
}

function TreePanel({ reference = pod.reference, route: accessRoute = route, enabled = true, options }: PanelProps) {
  const query = useDependencyTree({ pluginID: 'kubernetes', reference, route: accessRoute, enabled, maxDepth: options?.maxDepth });
  return <ProjectionView edges={treeEdges(query.tree?.children ?? [])} loading={query.isLoading} fetching={query.isFetching} error={query.error} refresh={query.refetch} />;
}

function SubgraphPanel({ reference = pod.reference, route: accessRoute = route, enabled = true, options }: PanelProps) {
  const query = useResourceGraph({
    pluginID: 'kubernetes', reference, route: accessRoute, enabled,
    upDepth: options?.upDepth, downDepth: options?.downDepth,
  });
  return <ProjectionView edges={query.graph?.edges ?? []} loading={query.isLoading} fetching={query.isFetching} error={query.error} refresh={query.refetch} />;
}

const projections: Array<{ kind: GraphKind; Panel: ComponentType<PanelProps> }> = [
  { kind: 'related', Panel: RelatedPanel },
  { kind: 'tree', Panel: TreePanel },
  { kind: 'subgraph', Panel: SubgraphPanel },
];
let host: NativeGraph;

function visibleEdges() { return screen.getByLabelText('graph edges').textContent; }
async function expectEdges(target: GraphNode | null, root = pod) {
  await waitFor(() => { expect(visibleEdges()).toBe(target ? `${root.reference.address.id} → ${target.reference.address.id}` : ''); });
}

async function mountedToken(kind: GraphKind) {
  await waitFor(() => {
    const token = host.latest(kind)?.clientToken;
    expect(token && host.populationLeases.has(token)).toBe(true);
  });
  const request = host.latest(kind);
  if (!request) throw new Error('Mounted contract requires a native observation reservation.');
  return request.clientToken;
}

beforeEach(() => {
  host = new NativeGraph();
  native.call.mockReset().mockImplementation((...args: Parameters<NativeGraph['call']>) => host.call(...args));
  native.check.mockReset().mockImplementation((_pluginID: string, connectionID: string) => cancellable({
    status: 'CONNECTED', connection: { id: connectionID, name: 'Cluster' }, error: '', details: '',
  }));
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  native.listeners.clear();
});

it('current-interface control: renders healthy initial graph edges', async () => {
  render(<SubgraphPanel />);
  await expectEdges(workerA);
  expect(screen.getByLabelText('graph error').textContent).toBe('');
});

it('current-interface observation update: replaces visible edges from a native full snapshot', async () => {
  render(<SubgraphPanel />);
  await expectEdges(workerA);

  act(() => { host.publish('subgraph', workerB); });

  await expectEdges(workerB);
  expect(visibleEdges()).not.toContain(workerA.reference.address.id);
});

it('finite graph controls: returns nonempty projections without mounted ownership', async () => {
  const related = await GetRelated({ pluginID: 'kubernetes', reference: pod.reference, route, direction: 'both' });
  const edges = related.edges;
  expect(related.truncated).toBe(false);
  const chain = await GetRelationshipChain('kubernetes', pod.reference, route, 'runs_on', 3);
  const tree = await GetDependencyTree('kubernetes', pod.reference, route, 3);
  const graph = await GetSubgraph('kubernetes', pod.reference, route, 2, 3);
  expect(edges.map(edge => edge.target)).toEqual([workerA]);
  expect(chain).toEqual([edges]);
  expect(tree?.children.map(child => child.edge)).toEqual(edges);
  expect(graph?.edges).toEqual(edges);
  expect(graph?.nodes.map(value => value.node)).toEqual([graph?.root, workerA]);
  expect(host.reservations.size).toBe(0);
  expect(host.populationLeases.size).toBe(0);
});

it('finite related preserves explicit truncation without acquiring mounted ownership', async () => {
  host.finiteRelatedTargets = [workerA, workerB];
  const request: RelatedRequest = { pluginID: 'kubernetes', reference: pod.reference, route, direction: 'both' };
  const bounded = await GetRelated({ ...request, limit: 1 });
  expect(bounded.edges.map(edge => edge.target)).toEqual([workerA]);
  expect(bounded.truncated).toBe(true);
  const whole = await GetRelated({ ...request, limit: 0 });
  expect(whole.edges.map(edge => edge.target)).toEqual([workerA, workerB]);
  expect(whole.truncated).toBe(false);
  expect(host.reservations.size).toBe(0);
  expect(host.populationLeases.size).toBe(0);
});

describe.each(projections)('$kind mounted graph contract', ({ kind, Panel }) => {
  it('reports pending until its first Open acknowledges', async () => {
    host.holdNextOpen = true;
    render(<Panel />);
    await waitFor(() => { expect(host.pendingOpens.size).toBe(1); });
    expect(screen.getByLabelText('graph state').textContent).toBe('pending');
    expect(visibleEdges()).toBe('');
    expect(host.populationLeases.size).toBe(0);
    const opening = host.latest(kind);
    if (!opening) throw new Error('Pending loading requires a native reservation.');
    await act(async () => { host.completeOpen(opening.clientToken); });
    await expectEdges(workerA);
    expect(screen.getByLabelText('graph state').textContent).toBe('ready');
  });

  it('replaces complete payloads, including empty results, while retaining populations until unmount', async () => {
    const view = render(<Panel />);
    await expectEdges(workerA);
    const token = await mountedToken(kind);

    view.rerender(<Panel reference={{ ...pod.reference, address: { ...pod.reference.address } }} route={{ ...route }} />);
    act(() => { host.publish(kind, workerB); });
    await expectEdges(workerB);
    act(() => { host.publish(kind, null); });
    await expectEdges(null);
    act(() => { host.publish(kind, workerA); });
    await expectEdges(workerA);

    expect([...host.populationLeases]).toEqual([token]);
    expect(host.retired.size).toBe(0);
    expect(host.finiteReads).toEqual([]);
    view.unmount();
    await waitFor(() => { expect(host.populationLeases.size).toBe(0); });
    expect(host.retired.has(token)).toBe(true);
    expect(native.listeners.get(topicFor(token))?.size ?? 0).toBe(0);
  });

  it('accepts sequence gaps exactly and rejects other observation, topic, generation, duplicate and stale frames', async () => {
    render(<Panel />);
    await expectEdges(workerA);
    const token = await mountedToken(kind);

    act(() => { emit(topicFor(token), host.frame(kind, workerB, token, { sequence: '9007199254740992' })); });
    await expectEdges(workerB);
    act(() => { emit(topicFor(token), host.frame(kind, workerA, token, { sequence: '9007199254740993' })); });
    await expectEdges(workerA);

    const rejectedFrames = [
      { topic: topicFor(foreignToken), patch: { sequence: '9007199254740994' } },
      { topic: topicFor(token), patch: { observationId: foreignToken, sequence: '9007199254740994' } },
      { topic: topicFor(token), patch: { generation: foreignGeneration, sequence: '9007199254740994' } },
      { topic: topicFor(token), patch: { sequence: '9007199254740993' } },
      { topic: topicFor(token), patch: { sequence: '9007199254740992' } },
      { topic: topicFor(token), patch: { sequence: '-1' } },
      { topic: topicFor(token), patch: { sequence: '9007199254740994.0' } },
      { topic: topicFor(token), patch: { sequence: '9e16' } },
    ];
    for (const rejected of rejectedFrames) {
      await deliverNativeEvent(rejected.topic, host.frame(kind, poison, token, rejected.patch));
      expect(visibleEdges()).toBe('web-1 → worker-a');
    }
    act(() => { emit(topicFor(token), host.frame(kind, workerB, token, { sequence: '9007199254740995' })); });
    await expectEdges(workerB);
    expect([...host.populationLeases]).toEqual([token]);
    expect(host.retired.size).toBe(0);
  });

  it('refreshes the same observation, retains pending data, clears failure and recovers without finite refetch', async () => {
    render(<Panel />);
    await expectEdges(workerA);
    const token = await mountedToken(kind);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh graph' }));
    await waitFor(() => { expect(host.refreshes.has(token)).toBe(true); });
    expect(screen.getByLabelText('graph state').textContent).toBe('refreshing');
    expect(visibleEdges()).toBe('web-1 → worker-a');
    act(() => { host.publish(kind, workerB); });
    await expectEdges(workerB);
    act(() => { host.publish(kind, null, { state: 'failed', error: { code: 'FORBIDDEN', title: 'Access denied', message: 'Graph access was revoked.' } }); });
    await expectEdges(null);
    expect(screen.getByLabelText('graph state').textContent).toBe('failed');
    expect(screen.getByLabelText('graph error').textContent).not.toBe('');
    expect(host.reservations.has(token)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh graph' }));
    await waitFor(() => { expect(host.refreshes.has(token)).toBe(true); });
    expect(screen.getByLabelText('graph state').textContent).toBe('pending');
    act(() => { host.publish(kind, workerA); });
    await expectEdges(workerA);
    expect(screen.getByLabelText('graph error').textContent).toBe('');
    expect([...host.populationLeases]).toEqual([token]);
    expect(host.retired.size).toBe(0);
    expect(host.finiteReads).toEqual([]);
  });

  it('clears accepted data on connection retirement and ignores old frames after reconnect', async () => {
    render(<Panel />);
    await expectEdges(workerA);
    const token = await mountedToken(kind);

    act(() => { emit('connection/status', { pluginID: 'kubernetes', connectionID: route.connection, status: 'DISCONNECTED' }); });
    await expectEdges(null);
    await waitFor(() => { expect(host.retired.has(token)).toBe(true); });
    await deliverNativeEvent(topicFor(token), host.frame(kind, poison, token));
    expect(visibleEdges()).toBe('');

    host.target = workerB;
    act(() => { emit('connection/status', { pluginID: 'kubernetes', connectionID: route.connection, status: 'CONNECTED' }); });
    await expectEdges(workerB);
    const replacement = await mountedToken(kind);
    expect(replacement).not.toBe(token);
    await deliverNativeEvent(topicFor(token), host.frame(kind, poison, token));
    expect(visibleEdges()).toBe('web-1 → worker-b');
    expect([...host.populationLeases]).toEqual([replacement]);
  });

  it('clears accepted data and releases populations when disabled', async () => {
    const view = render(<Panel />);
    await expectEdges(workerA);
    const token = await mountedToken(kind);

    view.rerender(<Panel enabled={false} />);
    await expectEdges(null);
    await waitFor(() => { expect(host.retired.has(token)).toBe(true); });
    await deliverNativeEvent(topicFor(token), host.frame(kind, poison, token));
    expect(visibleEdges()).toBe('');
    expect(host.populationLeases.size).toBe(0);
  });

  it('recovers from a rejected Sync on the same observation without keeping stale data', async () => {
    render(<Panel />);
    await expectEdges(workerA);
    const token = await mountedToken(kind);
    host.failNextSync = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh graph' }));
    await expectEdges(null);
    expect(screen.getByLabelText('graph state').textContent).toBe('failed');
    expect(screen.getByLabelText('graph error').textContent).not.toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh graph' }));
    await waitFor(() => { expect(host.refreshes.has(token)).toBe(true); });
    act(() => { host.publish(kind, workerB); });
    await expectEdges(workerB);
    expect(host.retired.size).toBe(0);
    expect([...host.reservations.keys()]).toEqual([token]);
    expect(host.finiteReads).toEqual([]);
  });

  it('does not revive disabled data when the next Open is unresolved', async () => {
    const view = render(<Panel />);
    await expectEdges(workerA);
    const retired = await mountedToken(kind);
    view.rerender(<Panel enabled={false} />);
    await expectEdges(null);
    host.holdNextOpen = true;
    host.target = workerB;
    view.rerender(<Panel />);
    await waitFor(() => { expect(host.pendingOpens.size).toBe(1); });
    expect(screen.getByLabelText('graph state').textContent).toBe('pending');
    expect(visibleEdges()).toBe('');
    const replacement = host.latest(kind);
    if (!replacement) throw new Error('Re-enabling requires a fresh reservation.');
    await act(async () => { host.completeOpen(replacement.clientToken); });
    await expectEdges(workerB);
    expect(replacement.clientToken).not.toBe(retired);
    expect(host.retired.has(retired)).toBe(true);
  });

  it('retires a changed readiness generation even when its phase stays connected', async () => {
    const view = render(<Panel />);
    await expectEdges(workerA);
    const retired = await mountedToken(kind);
    host.holdNextOpen = true;
    host.target = workerB;
    act(() => { emit('connection/status', { pluginID: 'kubernetes', connectionID: route.connection, status: 'CONNECTED' }); });
    await waitFor(() => { expect(host.pendingOpens.size).toBe(1); });
    expect(screen.getByLabelText('graph state').textContent).toBe('pending');
    expect(visibleEdges()).toBe('');
    expect(host.retired.has(retired)).toBe(true);
    await deliverNativeEvent(topicFor(retired), host.frame(kind, poison, retired));
    expect(visibleEdges()).toBe('');
    const replacement = host.latest(kind);
    if (!replacement) throw new Error('Readiness retirement requires a fresh reservation.');
    await act(async () => { host.completeOpen(replacement.clientToken); });
    await expectEdges(workerB);
    expect(replacement.clientToken).not.toBe(retired);
    view.unmount();
    expect(host.populationLeases.size).toBe(0);
  });

  it.each(['route', 'incarnation', 'options'] as const)('clears data immediately when %s changes', async change => {
    const view = render(<Panel />);
    await expectEdges(workerA);
    const retired = await mountedToken(kind);
    host.holdNextOpen = true;
    host.target = workerB;
    const props: PanelProps = change === 'route'
      ? { route: { connection: 'another-cluster' } }
      : change === 'incarnation'
        ? { reference: { ...pod.reference, incarnation: 'replacement-incarnation' } }
        : { options: { direction: 'incoming', maxDepth: 1, upDepth: 1, downDepth: 1 } };
    view.rerender(<Panel {...props} />);
    await waitFor(() => { expect(host.pendingOpens.size).toBe(1); });
    expect(screen.getByLabelText('graph state').textContent).toBe('pending');
    expect(visibleEdges()).toBe('');
    expect(host.retired.has(retired)).toBe(true);
    await deliverNativeEvent(topicFor(retired), host.frame(kind, poison, retired));
    expect(visibleEdges()).toBe('');
    const replacement = host.latest(kind);
    if (!replacement) throw new Error('A changed request requires a fresh reservation.');
    await act(async () => { host.completeOpen(replacement.clientToken); });
    await expectEdges(workerB);
    expect([...host.populationLeases]).toEqual([replacement.clientToken]);
  });

  it('keeps demand for the remaining mounted owner', async () => {
    const first = render(<Panel />);
    const second = render(<Panel />);
    await waitFor(() => {
      expect(within(first.container).getByLabelText('graph edges').textContent).toBe('web-1 → worker-a');
      expect(within(second.container).getByLabelText('graph edges').textContent).toBe('web-1 → worker-a');
      expect(host.populationLeases.size).toBe(2);
    });
    const survivor = host.latest(kind);
    if (!survivor) throw new Error('The second owner requires its own reservation.');
    first.unmount();
    expect([...host.populationLeases]).toEqual([survivor.clientToken]);
    act(() => { host.publish(kind, workerB, {}, survivor.clientToken); });
    await waitFor(() => {
      expect(within(second.container).getByLabelText('graph edges').textContent).toBe('web-1 → worker-b');
    });
    second.unmount();
    expect(host.populationLeases.size).toBe(0);
  });
});

it('clears the old root while its replacement Open is pending', async () => {
  const view = render(<SubgraphPanel />);
  await expectEdges(workerA);
  const oldToken = await mountedToken('subgraph');
  host.holdNextOpen = true;
  host.target = workerB;

  view.rerender(<SubgraphPanel reference={nextPod.reference} />);
  await expectEdges(null);
  await waitFor(() => { expect(host.pendingOpens.size).toBe(1); });
  expect(screen.getByLabelText('graph state').textContent).toBe('pending');
  expect(host.retired.has(oldToken)).toBe(true);
  await deliverNativeEvent(topicFor(oldToken), host.frame('subgraph', poison, oldToken));
  expect(visibleEdges()).toBe('');

  const replacement = host.latest('subgraph');
  if (!replacement) throw new Error('Replacement root requires its own native reservation.');
  await act(async () => { host.completeOpen(replacement.clientToken); });
  await expectEdges(workerB, nextPod);
  expect([...host.populationLeases]).toEqual([replacement.clientToken]);
});

it('closes a pending Open before acknowledgment and never resurrects it after a new mount', async () => {
  host.holdNextOpen = true;
  const retiredView = render(<SubgraphPanel />);
  await waitFor(() => { expect(host.pendingOpens.size).toBe(1); });
  const oldRequest = host.latest('subgraph');
  if (!oldRequest) throw new Error('Pending-Open contract requires a captured native reservation.');
  const oldToken = oldRequest.clientToken;

  retiredView.unmount();
  await waitFor(() => { expect(host.retired.has(oldToken)).toBe(true); });
  expect(host.pendingOpens.has(oldToken)).toBe(true);
  expect(host.populationLeases.size).toBe(0);
  host.target = workerB;
  render(<SubgraphPanel reference={nextPod.reference} />);
  await expectEdges(workerB, nextPod);
  const replacement = await mountedToken('subgraph');

  await act(async () => { host.completeOpen(oldToken); });
  await deliverNativeEvent(topicFor(oldToken), host.frame('subgraph', poison, oldToken));
  expect(visibleEdges()).toBe('web-2 → worker-b');
  expect(host.activationAfterRetirement.size).toBe(0);
  expect(native.listeners.get(topicFor(oldToken))?.size ?? 0).toBe(0);
  expect([...host.populationLeases]).toEqual([replacement]);
  expect([...host.reservations.keys()]).toEqual([replacement]);
});

it.each([
  { observationId: foreignToken },
  { topic: topicFor(foreignToken) },
])('rejects a mismatched Open acknowledgment without activating it', async patch => {
  host.openPatch = patch;
  render(<SubgraphPanel />);
  await waitFor(() => { expect(screen.getByLabelText('graph state').textContent).toBe('failed'); });
  expect(visibleEdges()).toBe('');
  expect(host.populationLeases.size).toBe(0);
  expect(host.reservations.size).toBe(0);
  expect(host.activationAfterRetirement.size).toBe(0);
  for (const [topic, listeners] of native.listeners) {
    if (topic.startsWith('resource/graph-observation/')) expect(listeners.size).toBe(0);
  }
});

it('keeps the observation when canonical scope entries are reordered', async () => {
  const reference = {
    ...pod.reference,
    address: {
      ...pod.reference.address,
      scope: [{ dimension: 'cluster', value: 'cluster-a' }, ...pod.reference.address.scope],
    },
  };
  const view = render(<SubgraphPanel reference={reference} />);
  await expectEdges(workerA);
  const token = await mountedToken('subgraph');
  view.rerender(<SubgraphPanel reference={{
    ...reference, address: { ...reference.address, scope: [...reference.address.scope].reverse() },
  }} />);
  act(() => { host.publish('subgraph', workerB); });
  await expectEdges(workerB);
  expect([...host.populationLeases]).toEqual([token]);
  expect(host.retired.size).toBe(0);
});
