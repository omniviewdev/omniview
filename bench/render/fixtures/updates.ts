/**
 * Declared sparse resource updates for the Kubernetes Pod fixture.
 *
 * A host source view in `snapshotAndUpdates` mode delivers `changes` events after its
 * snapshot. This driver emits them through `PodsFixture.applyChange`, so every event
 * carries the view's real viewGeneration and the next sequence number, and the runtime's
 * source-view reducer, query cache and table take the same path as for a live provider.
 *
 * The workload is declared, not random: a seed and four numbers fully determine which Pods
 * change, how, and when. Pods are drawn uniformly from the whole corpus, so most updates
 * land off screen, as sparse updates do in a cluster.
 *
 * Mutation kinds, in rotation per touched Pod:
 * - restart: container 0 `restartCount` + 1 and a new resourceVersion (the Restarts column);
 * - phase: Running <-> Pending with matching conditions and container state (the Status column);
 * - recreate (every `recreateEvery`-th touch): the Pod is deleted and created again under the
 *   same name and namespace with a new uid, so its record key changes but its address does not.
 */
import { rng, type Pod, type PodsFixture } from './kubernetes';

export interface SparseUpdateSpec {
  /** Backend `changes` events per second. */
  eventsPerSecond: number;
  /** Distinct Pods touched by each event. */
  recordsPerEvent: number;
  /** Every Nth touched Pod is deleted and recreated; 0 turns recreation off. */
  recreateEvery: number;
  seed: number;
  /** Stop after this many events; unbounded when absent. */
  maxEvents?: number;
}

export interface UpdateLedger {
  spec: SparseUpdateSpec;
  running: boolean;
  events: number;
  upserts: number;
  removes: number;
  recreated: number;
  restarts: number;
  phaseFlips: number;
  /** Worst delay between an event's scheduled time and the time it was emitted. */
  lateMaxMs: number;
}

export interface SparseUpdates {
  ledger(): UpdateLedger;
  /** Stop emitting and return the final ledger. Idempotent. */
  stop(): UpdateLedger;
}

const hex = (rand: () => number, length: number) =>
  Array.from({ length }, () => Math.floor(rand() * 16).toString(16)).join('');

function withVersion(pod: Pod, version: number): Pod['metadata'] {
  return { ...pod.metadata, resourceVersion: String(version) };
}

/** Container 0 restarted once more. */
export function restartedPod(pod: Pod, version: number): Pod {
  const containerStatuses = (pod.status.containerStatuses as Array<Record<string, unknown>>).map((status, index) =>
    index === 0 ? { ...status, restartCount: Number(status.restartCount ?? 0) + 1 } : status);
  return { ...pod, metadata: withVersion(pod, version), status: { ...pod.status, containerStatuses } };
}

/** Running <-> Pending, with the conditions and container state that go with each. */
export function phaseFlippedPod(pod: Pod, version: number): Pod {
  const running = pod.status.phase !== 'Running';
  const startedAt = pod.status.startTime as string;
  return {
    ...pod,
    metadata: withVersion(pod, version),
    status: {
      ...pod.status,
      phase: running ? 'Running' : 'Pending',
      conditions: (pod.status.conditions as Array<Record<string, unknown>>).map((condition) => ({
        ...condition, status: running || condition.type === 'PodScheduled' ? 'True' : 'False',
      })),
      containerStatuses: (pod.status.containerStatuses as Array<Record<string, unknown>>).map((status) => ({
        ...status,
        ready: running,
        started: running,
        state: running ? { running: { startedAt } } : { waiting: { reason: 'ContainerCreating' } },
      })),
    },
  };
}

/** The same Pod name and namespace as a new incarnation: new uid, new creation time, no restarts. */
export function recreatedPod(pod: Pod, version: number, rand: () => number): Pod {
  const created = new Date(Date.parse(pod.metadata.creationTimestamp as string) + 3_600_000).toISOString();
  return {
    ...pod,
    metadata: {
      ...pod.metadata,
      uid: `${hex(rand, 8)}-${hex(rand, 4)}-${hex(rand, 4)}-${hex(rand, 4)}-${hex(rand, 12)}`,
      resourceVersion: String(version),
      creationTimestamp: created,
    },
    status: {
      ...pod.status,
      phase: 'Running',
      startTime: created,
      conditions: (pod.status.conditions as Array<Record<string, unknown>>).map((condition) => ({
        ...condition, status: 'True', lastTransitionTime: created,
      })),
      containerStatuses: (pod.status.containerStatuses as Array<Record<string, unknown>>).map((status) => ({
        ...status, ready: true, started: true, restartCount: 0, state: { running: { startedAt: created } },
      })),
    },
  };
}

export function validateSparseUpdateSpec(spec: SparseUpdateSpec): void {
  const positive = (value: number) => Number.isFinite(value) && value > 0;
  if (!positive(spec.eventsPerSecond)) throw new Error('eventsPerSecond must be a positive number');
  if (!Number.isInteger(spec.recordsPerEvent) || spec.recordsPerEvent < 1) throw new Error('recordsPerEvent must be a positive integer');
  if (!Number.isInteger(spec.recreateEvery) || spec.recreateEvery < 0) throw new Error('recreateEvery must be a non-negative integer');
  if (!Number.isInteger(spec.seed)) throw new Error('seed must be an integer');
  if (spec.maxEvents !== undefined && (!Number.isInteger(spec.maxEvents) || spec.maxEvents < 1)) throw new Error('maxEvents must be a positive integer');
}

/** Start emitting. The first event fires one period after the call, on an absolute schedule. */
export function startSparseUpdates(fixture: PodsFixture, spec: SparseUpdateSpec): SparseUpdates {
  validateSparseUpdateSpec(spec);
  const population = fixture.pods().length;
  if (spec.recordsPerEvent > population) throw new Error('recordsPerEvent exceeds the corpus');
  const rand = rng(spec.seed);
  const periodMs = 1000 / spec.eventsPerSecond;
  const ledger: UpdateLedger = {
    spec: { ...spec }, running: true, events: 0, upserts: 0, removes: 0, recreated: 0, restarts: 0, phaseFlips: 0, lateMaxMs: 0,
  };
  const startedAt = performance.now();
  let touches = 0;
  let version = 1_000_000;
  let timer: number | undefined;

  const emitOne = () => {
    const chosen = new Set<number>();
    while (chosen.size < spec.recordsPerEvent) chosen.add(Math.floor(rand() * population));
    const replace: Array<{ index: number; pod: Pod }> = [];
    const recreate: Array<{ index: number; pod: Pod }> = [];
    for (const index of chosen) {
      const pod = fixture.pods()[index];
      touches++;
      version++;
      if (spec.recreateEvery > 0 && touches % spec.recreateEvery === 0) {
        recreate.push({ index, pod: recreatedPod(pod, version, rand) });
        ledger.recreated++;
      } else if (touches % 2 === 0) {
        replace.push({ index, pod: restartedPod(pod, version) });
        ledger.restarts++;
      } else {
        replace.push({ index, pod: phaseFlippedPod(pod, version) });
        ledger.phaseFlips++;
      }
    }
    const result = fixture.applyChange({ replace, recreate });
    ledger.events++;
    ledger.upserts += result.upserts;
    ledger.removes += result.removes;
  };

  const schedule = () => {
    if (!ledger.running) return;
    const due = startedAt + (ledger.events + 1) * periodMs;
    timer = window.setTimeout(() => {
      timer = undefined;
      if (!ledger.running) return;
      ledger.lateMaxMs = Math.max(ledger.lateMaxMs, performance.now() - due);
      emitOne();
      if (spec.maxEvents !== undefined && ledger.events >= spec.maxEvents) ledger.running = false;
      else schedule();
    }, Math.max(0, due - performance.now()));
  };
  schedule();

  const snapshot = (): UpdateLedger => ({ ...ledger, spec: { ...ledger.spec }, lateMaxMs: Math.round(ledger.lateMaxMs * 10) / 10 });
  return {
    ledger: snapshot,
    stop() {
      ledger.running = false;
      window.clearTimeout(timer);
      timer = undefined;
      return snapshot();
    },
  };
}
