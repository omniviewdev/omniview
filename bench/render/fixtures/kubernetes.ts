/** Deterministic Kubernetes fixtures shaped like what the plugin backend returns. */
import { emit, handleAll } from '../harness/backend';
import { jsonToValue } from '@omniviewdev/runtime';
import type {
  EditorSchemaResult, HostEnumerateRequest, HostSourceViewRequest, Representation, ResolveTargetRequest,
  SchemaBinding, SchemaDocumentRequest, SchemaFieldsRequest, SchemaFieldsResult, SchemaRequest,
} from '@omniviewdev/runtime';
import { BENCH_CONNECTION_ID } from './defaults';

/** Small seeded PRNG (mulberry32) so every run sees the same data. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMESPACES = ['default', 'kube-system', 'monitoring', 'payments', 'checkout', 'search', 'ingress', 'data'];
const APPS = ['api', 'worker', 'web', 'cron', 'gateway', 'indexer', 'cache', 'db-proxy', 'scheduler', 'exporter'];
const PHASES = ['Running', 'Running', 'Running', 'Running', 'Running', 'Pending', 'Succeeded', 'Failed'];
const EPOCH = Date.parse('2026-10-01T00:00:00Z');

export interface Pod {
  apiVersion: 'v1';
  kind: 'Pod';
  metadata: Record<string, any>;
  spec: Record<string, any>;
  status: Record<string, any>;
}

/** `count` pods in shuffled order (so name sort, reverse sort and no sort all differ). */
export function makePods(count: number, seed = 42): Pod[] {
  const rand = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');

  const pods: Pod[] = [];
  for (let i = 0; i < count; i++) {
    const app = pick(APPS);
    const namespace = pick(NAMESPACES);
    const rs = `${app}-${hex(10)}`;
    const name = `${rs}-${hex(5)}`;
    const phase = pick(PHASES);
    const created = new Date(EPOCH - Math.floor(rand() * 30 * 86_400_000)).toISOString();
    const containerCount = 1 + Math.floor(rand() * 3);
    const containers = Array.from({ length: containerCount }, (_, c) => ({
      name: c === 0 ? app : `sidecar-${c}`,
      image: `registry.example.com/${namespace}/${app}:1.${Math.floor(rand() * 40)}.${Math.floor(rand() * 10)}`,
      resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '500m', memory: '512Mi' } },
    }));
    const running = phase === 'Running';
    pods.push({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name,
        namespace,
        uid: `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`,
        resourceVersion: String(100000 + i),
        creationTimestamp: created,
        labels: { app, 'pod-template-hash': rs.slice(app.length + 1), tier: pick(['frontend', 'backend', 'batch']) },
        ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: rs, uid: hex(32), controller: true }],
      },
      spec: {
        nodeName: `node-${String(Math.floor(rand() * 40)).padStart(2, '0')}`,
        containers,
        dnsPolicy: 'ClusterFirst',
        restartPolicy: 'Always',
        serviceAccountName: app,
        schedulerName: 'default-scheduler',
        priority: 0,
        preemptionPolicy: 'PreemptLowerPriority',
      },
      status: {
        phase,
        hostIP: `10.0.${Math.floor(rand() * 4)}.${Math.floor(rand() * 250)}`,
        podIP: `10.244.${Math.floor(rand() * 64)}.${Math.floor(rand() * 250)}`,
        qosClass: 'Burstable',
        startTime: created,
        conditions: ['PodScheduled', 'Initialized', 'ContainersReady', 'Ready'].map((type) => ({
          type,
          status: running || type === 'PodScheduled' ? 'True' : 'False',
          lastTransitionTime: created,
        })),
        containerStatuses: containers.map((c) => ({
          name: c.name,
          image: c.image,
          ready: running,
          started: running,
          restartCount: Math.floor(rand() * rand() * 12),
          state: running
            ? { running: { startedAt: created } }
            : { waiting: { reason: phase === 'Pending' ? 'ContainerCreating' : 'CrashLoopBackOff' } },
        })),
      },
    });
  }
  return pods;
}

function podMetrics(pods: Pod[]) {
  const rand = rng(7);
  const results = pods.flatMap((p) => {
    const labels = { pod: p.metadata.name, namespace: p.metadata.namespace };
    return [
      { current_value: { metric_id: 'cpu_usage', value: Math.round(rand() * 400), labels } },
      { current_value: { metric_id: 'memory_usage', value: Math.round(rand() * 512 * 1024 * 1024), labels } },
    ];
  });
  return { 'metrics-server': { success: true, results } };
}

/** What the fixture's source views have delivered, for reports and for waiting on completeness. */
export interface SourceViewStats {
  viewId: string;
  mode: 'snapshot' | 'snapshotAndUpdates';
  generation: number;
  /** Last sequence number emitted in the current generation. */
  sequence: number;
  /** True once the current generation's snapshotEnd was emitted and until the next resync. */
  complete: boolean;
  /** A complete view that accepts live `changes` (snapshotAndUpdates mode). */
  following: boolean;
  snapshotBatches: number;
  snapshotRecords: number;
  snapshotEnds: number;
  changeEvents: number;
  upserts: number;
  removes: number;
  resets: number;
}

/**
 * One backend change batch. `replace` keeps the pod's incarnation (same uid, so the record
 * key is unchanged and the row updates in place). `recreate` is delete-then-create: the old
 * incarnation is removed and a new uid is upserted under the same name and namespace, so
 * the record key changes while the address key does not.
 */
export interface PodChange {
  replace?: Array<{ index: number; pod: Pod }>;
  recreate?: Array<{ index: number; pod: Pod }>;
}

export interface PodChangeResult {
  /** `changes` events emitted, at most one per live view. */
  events: number;
  upserts: number;
  removes: number;
}

export interface PodsFixture {
  /** Current backend corpus. Entries are replaced, never mutated, so held snapshots stay immutable. */
  pods(): readonly Pod[];
  /**
   * Apply a change to the corpus and deliver it to every complete live view as one
   * `changes` event with the next sequence number of the view's current generation.
   * A view that is still snapshotting or resyncing misses it, exactly as it would on the
   * host: its next snapshot already carries the change.
   */
  applyChange(change: PodChange): PodChangeResult;
  views(): SourceViewStats[];
}

/** Serve the Kubernetes corpus through the current host-owned V2 resource contract. */
export function servePods(initial: Pod[]): PodsFixture {
  const metrics = podMetrics(initial);
  // The corpus is the backend's state. Copy it so a caller's array is never mutated.
  const corpus: Pod[] = [...initial];
  const provider = 'kubernetes';
  const authority = `bench:${BENCH_CONNECTION_ID}`;
  const type = 'k8s:/pods';
  const representation: Representation = { id: 'kubernetes-json', revision: 'bench-1' };
  const coverage = { kind: 'complete', paths: [] };
  const count = { kind: 'exact', value: String(corpus.length) };
  const authorityDisclosure = { continuity: 'connectionLocal' as const, limitations: [] };
  const schemaObservation = (pluginID: string, request: SchemaRequest) => {
    const selected = request.target.representation;
    if (pluginID !== provider || request.route.connection !== BENCH_CONNECTION_ID || request.type !== type
      || request.target.auxiliary || selected?.id !== representation.id || selected.revision !== representation.revision) {
      throw new Error('Unsupported benchmark schema target');
    }
    return { type, target: request.target, observation: 'bench-schema-1' };
  };
  interface ViewState extends Omit<SourceViewStats, 'viewId'> { request: HostSourceViewRequest }
  const views = new Map<string, ViewState>();
  let nextView = 0;
  const selects = (target: HostSourceViewRequest['target'], pod: Pod) => target.scope.every((entry) =>
    entry.match === 'any' || (entry.dimension === 'namespace' && entry.values.includes(pod.metadata.namespace)));
  const select = (target: HostSourceViewRequest['target']) => corpus.filter((pod) => selects(target, pod));
  const record = (request: Pick<HostSourceViewRequest, 'targetId' | 'target'>, pod: Pod) => {
    const address = { provider, authority, type, scope: [{ dimension: 'namespace', value: pod.metadata.namespace }], id: pod.metadata.name };
    return {
      key: JSON.stringify([address, pod.metadata.uid]), addressKey: JSON.stringify(address), targetId: request.targetId, route: request.target.route,
      record: { reference: { address, incarnation: pod.metadata.uid }, body: jsonToValue(pod), representation, coverage, sourceRevision: pod.metadata.resourceVersion },
    };
  };
  const records = (request: HostSourceViewRequest, selected: Pod[]) => selected.map((pod) => record(request, pod));
  const sync = (viewId: string) => {
    const view = views.get(viewId);
    if (!view) throw new Error(`Unknown benchmark source view: ${viewId}`);
    const topic = `resource/source-view/${viewId}`;
    if (view.generation) {
      view.resets++;
      emit(topic, { viewId, viewGeneration: String(view.generation), sequence: String(++view.sequence), kind: 'reset', reset: { reason: 'resync', message: '' } });
    }
    view.complete = false;
    view.following = false;
    const generation = String(++view.generation);
    const selected = records(view.request, select(view.request.target));
    view.sequence = 0;
    for (let i = 0; i < selected.length; i += 256) {
      const batch = selected.slice(i, i + 256);
      view.snapshotBatches++;
      view.snapshotRecords += batch.length;
      emit(topic, { viewId, viewGeneration: generation, sequence: String(++view.sequence), kind: 'snapshot', records: batch });
    }
    view.snapshotEnds++;
    view.complete = true;
    view.following = view.mode === 'snapshotAndUpdates';
    emit(topic, {
      viewId, viewGeneration: generation, sequence: String(++view.sequence), kind: 'snapshotEnd',
      status: { state: view.mode === 'snapshot' ? 'finished' : 'following', mode: view.mode,
        continuity: view.mode === 'snapshot' ? 'notApplicable' : 'bestEffort',
        coverage: { enumeration: 'exhausted', consistency: 'bestEffort', limitations: [] },
        count: { kind: 'exact', value: String(selected.length) } },
    });
  };
  const applyChange = (change: PodChange): PodChangeResult => {
    const upserted: Pod[] = [];
    const removed: Pod[] = [];
    for (const { index, pod } of change.replace ?? []) {
      if (!corpus[index]) throw new Error(`Unknown benchmark pod index: ${index}`);
      corpus[index] = pod;
      upserted.push(pod);
    }
    for (const { index, pod } of change.recreate ?? []) {
      if (!corpus[index]) throw new Error(`Unknown benchmark pod index: ${index}`);
      removed.push(corpus[index]);
      corpus[index] = pod;
      upserted.push(pod);
    }
    const result: PodChangeResult = { events: 0, upserts: 0, removes: 0 };
    for (const [viewId, view] of views) {
      if (!view.following) continue;
      const upserts = upserted.filter((pod) => selects(view.request.target, pod)).map((pod) => record(view.request, pod));
      const removes = removed.filter((pod) => selects(view.request.target, pod)).map((pod) => {
        const { key, addressKey } = record(view.request, pod);
        return { key, addressKey };
      });
      if (!upserts.length && !removes.length) continue;
      view.changeEvents++;
      view.upserts += upserts.length;
      view.removes += removes.length;
      result.events++;
      result.upserts += upserts.length;
      result.removes += removes.length;
      emit(`resource/source-view/${viewId}`, {
        viewId, viewGeneration: String(view.generation), sequence: String(++view.sequence), kind: 'changes', upserts, removes,
      });
    }
    return result;
  };
  handleAll({
    'resource/servicewrapper.Catalog': () => ({
      provider, revision: 'bench-1', coverage,
      types: [{
        type, displayName: 'Pods',
        identityDimensions: [{ name: 'namespace', allowEmpty: true }],
        queryDimensions: [{ name: 'namespace', allowEmpty: true }],
        representations: [representation], defaultRepresentation: representation.id, modelRepresentation: representation.id,
        capabilities: [
          { operation: 'enumerate', scope: [{ dimension: 'namespace', match: 'any' }] },
          { operation: 'sourceUpdates', scope: [{ dimension: 'namespace', match: 'any' }] },
        ],
      }],
    }),
    'resource/servicewrapper.ResolveTarget': (_plugin: string, request: ResolveTargetRequest) => {
      if (request.type !== type) throw new Error(`Unsupported benchmark resource type: ${request.type}`);
      return {
        targetId: JSON.stringify([provider, authority, request.type, request.scope ?? []]),
        target: { ...request, provider, authority, scope: request.scope ?? [{ dimension: 'namespace', match: 'any' }], representation: request.representation ?? representation.id },
        authority: authorityDisclosure, catalogRevision: 'bench-1',
      };
    },
    'resource/servicewrapper.Enumerate': (_plugin: string, input: HostEnumerateRequest) => {
      const { target, pageSize, cursor } = input.request;
      if (target.type !== type) throw new Error(`Unsupported benchmark resource type: ${target.type}`);
      const selected = select(target);
      const start = cursor ? Number(cursor) : 0;
      if (!Number.isSafeInteger(start) || start < 0 || pageSize <= 0) throw new Error('Invalid benchmark source page');
      const end = Math.min(start + pageSize, selected.length);
      return {
        records: records({ targetId: input.targetId, target, updates: 'none' }, selected.slice(start, end)),
        sourcePage: {
          count: { kind: 'exact', value: String(selected.length) }, coverage, consistency: 'snapshot',
          ...(end < selected.length ? { nextCursor: String(end) } : {}),
        },
      };
    },
    // The fixture advertises a format, not a schema. Match a provider without an optional resolver.
    'resource/servicewrapper.ResolveSchema': (pluginID: string, request: SchemaRequest): SchemaBinding => {
      schemaObservation(pluginID, request);
      return { state: 'unavailable', unavailableReason: 'UNSUPPORTED' };
    },
    'resource/servicewrapper.GetSchemaFields': (pluginID: string, { request }: SchemaFieldsRequest): SchemaFieldsResult => ({
      ...schemaObservation(pluginID, request), schemaState: 'unavailable',
      fields: [], truncated: false,
      overlay: {
        Operations: ['enumerate', 'sourceUpdates'], NativeQueryLanguages: [],
        HostEvaluation: 'unsupported', HostEvaluationCode: 'UNSUPPORTED', Validation: 'none', Unvalidated: null,
      },
    }),
    'resource/servicewrapper.ResolveEditorSchema': (pluginID: string, request: SchemaRequest): EditorSchemaResult => ({
      ...schemaObservation(pluginID, request), status: 'unsupported', code: 'UNSUPPORTED',
    }),
    'resource/servicewrapper.GetSchemaDocument': (pluginID: string, { request }: SchemaDocumentRequest) => {
      schemaObservation(pluginID, request);
      throw Object.assign(new Error('Schema document is not referenced by the benchmark target.'), { code: 'NOT_FOUND' });
    },
    'resource/servicewrapper.ScopeValues': () => [...new Set(corpus.map((pod) => pod.metadata.namespace))],
    // The host's generic resource table builds its columns from this definition. The fixture's Pods
    // have no exec handler (the real backend rejects a type without one), so the row-action column
    // is absent, as it is for any type without a handler.
    'resource/servicewrapper.GetResourceDefinition': (_plugin: string, _route: unknown, resourceType: string) => {
      if (resourceType !== type) throw new Error(`Unsupported benchmark resource type: ${resourceType}`);
      return {
        columnDefs: [
          { id: 'name', header: 'Name', accessor: 'metadata.name' },
          { id: 'namespace', header: 'Namespace', accessor: 'metadata.namespace' },
          { id: 'phase', header: 'Status', accessor: 'status.phase' },
          { id: 'node', header: 'Node', accessor: 'spec.nodeName' },
          { id: 'podIP', header: 'Pod IP', accessor: 'status.podIP' },
          { id: 'created', header: 'Created', accessor: 'metadata.creationTimestamp' },
        ],
      };
    },
    'exec/servicewrapper.GetHandler': () => {
      throw new Error('No exec handler is registered for this resource type');
    },
    'resource/servicewrapper.GetSourceStates': (_plugin: string, route: unknown) => ({
      route, types: { [type]: { state: 'following', mode: 'snapshotAndUpdates', continuity: 'bestEffort', count } },
    }),
    'resource/servicewrapper.OpenSourceView': (_plugin: string, request: HostSourceViewRequest) => {
      if (request.target.type !== type) throw new Error(`Unsupported benchmark resource type: ${request.target.type}`);
      const viewId = `bench-${++nextView}`;
      const mode = request.updates === 'none' ? 'snapshot' : 'snapshotAndUpdates';
      views.set(viewId, {
        request, mode, generation: 0, sequence: 0, complete: false, following: false,
        snapshotBatches: 0, snapshotRecords: 0, snapshotEnds: 0, changeEvents: 0, upserts: 0, removes: 0, resets: 0,
      });
      return { viewId, topic: `resource/source-view/${viewId}`, mode };
    },
    'resource/servicewrapper.SyncSourceView': (_plugin: string, viewId: string) => sync(viewId),
    'resource/servicewrapper.RefreshSourceView': (_plugin: string, viewId: string) => sync(viewId),
    'resource/servicewrapper.CloseSourceView': (_plugin: string, viewId: string) => {
      const view = views.get(viewId);
      if (view) {
        view.following = false;
        view.resets++;
        emit(`resource/source-view/${viewId}`, { viewId, viewGeneration: String(view.generation || 1),
          sequence: String(++view.sequence), kind: 'reset', reset: { reason: 'closed', message: '' } });
        views.delete(viewId);
      }
    },
    'resource/servicewrapper.RetryConnectionSources': () => null,
    'metric/servicewrapper.QueryAll': () => metrics,
  });
  return {
    pods: () => corpus,
    applyChange,
    views: () => [...views].map(([viewId, { request: _request, ...stats }]) => ({ viewId, ...stats })),
  };
}
