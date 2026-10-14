/** Deterministic Kubernetes fixtures shaped like what the plugin backend returns. */
import { handleAll } from '../harness/backend';

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

/** Serve `pods` from the resource List call (and batch pod metrics). */
export function servePods(pods: Pod[]): void {
  const metrics = podMetrics(pods);
  handleAll({
    'resource/servicewrapper.List': (_plugin: string, _conn: string, key: string) =>
      key === 'core::v1::Pod'
        ? { result: pods, success: true, totalCount: pods.length }
        : { result: [], success: true, totalCount: 0 },
    'metric/servicewrapper.QueryAll': () => metrics,
  });
}
