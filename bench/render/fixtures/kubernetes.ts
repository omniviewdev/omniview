/** Deterministic Kubernetes fixtures shaped like what the plugin backend returns. */
import { handleAll } from '../harness/backend';
import { jsonToValue } from '@omniviewdev/runtime';
import type { HostEnumerateRequest, ResolveTargetRequest } from '@omniviewdev/runtime';
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

/** Serve the Kubernetes corpus through the current host-owned V2 resource contract. */
export function servePods(pods: Pod[]): void {
  const metrics = podMetrics(pods);
  const provider = 'kubernetes';
  const authority = `bench:${BENCH_CONNECTION_ID}`;
  const type = 'k8s:/pods';
  const representation = {
    id: 'kubernetes-json', revision: 'bench-1',
    schema: { state: 'unavailable', unavailableReason: 'NOT_SUPPORTED', validation: 'none', unvalidated: [] },
  };
  const coverage = { kind: 'complete', paths: [] };
  const count = { kind: 'exact', value: String(pods.length) };
  const authorityDisclosure = { continuity: 'connectionLocal' as const, limitations: [] };
  handleAll({
    'resource/servicewrapper.Catalog': () => ({
      provider, revision: 'bench-1', coverage,
      types: [{
        type, displayName: 'Pods',
        identityDimensions: [{ name: 'namespace', allowEmpty: true }],
        queryDimensions: [{ name: 'namespace', allowEmpty: true }],
        representations: [representation], defaultRepresentation: representation.id, modelRepresentation: representation.id,
        capabilities: [{ operation: 'enumerate', scope: [{ dimension: 'namespace', match: 'any' }] }],
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
      const selected = pods.filter((pod) => target.scope.every((entry) =>
        entry.match === 'any' || (entry.dimension === 'namespace' && entry.values.includes(pod.metadata.namespace))));
      const start = cursor ? Number(cursor) : 0;
      if (!Number.isSafeInteger(start) || start < 0 || pageSize <= 0) throw new Error('Invalid benchmark source page');
      const end = Math.min(start + pageSize, selected.length);
      return {
        records: selected.slice(start, end).map((pod) => {
          const address = { provider, authority, type, scope: [{ dimension: 'namespace', value: pod.metadata.namespace }], id: pod.metadata.name };
          const addressKey = JSON.stringify(address);
          return {
            key: JSON.stringify([address, pod.metadata.uid]), addressKey, targetId: input.targetId, route: target.route,
            record: { reference: { address, incarnation: pod.metadata.uid }, body: jsonToValue(pod), representation, coverage, sourceRevision: pod.metadata.resourceVersion },
          };
        }),
        sourcePage: {
          count: { kind: 'exact', value: String(selected.length) }, coverage, consistency: 'snapshot',
          ...(end < selected.length ? { nextCursor: String(end) } : {}),
        },
      };
    },
    'resource/servicewrapper.ScopeValues': () => [...new Set(pods.map((pod) => pod.metadata.namespace))],
    'resource/servicewrapper.GetWatchState': () => ({
      connectionId: BENCH_CONNECTION_ID, resources: { [type]: 2 }, resourceCounts: { [type]: count },
    }),
    'resource/servicewrapper.EnsureResourceWatch': () => null,
    'resource/servicewrapper.SubscribeResource': () => null,
    'resource/servicewrapper.UnsubscribeResource': () => null,
    'metric/servicewrapper.QueryAll': () => metrics,
  });
}
