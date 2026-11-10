/**
 * In-memory implementation of the host Activity FrontendService protocol
 * (backend/pkg/activity/frontend.go, service.go, observations.go).
 *
 * The earlier fixture answered only Subscribe/Attach/Snapshot/Heartbeat/Unsubscribe and
 * left every producer call unhandled. An unhandled call resolves to `null`, so the first
 * `notify()` made by the shell (a failed row action, a saved page that could not be
 * migrated) crashed in `store.applyRecord(null)` and surfaced a spurious
 * "Activity observation" error toast. This service speaks the whole protocol instead:
 *
 * - Subscribe returns a snapshot and a subscription that is not armed.
 * - Attach arms it and returns the snapshot; only armed subscriptions receive
 *   `activity/change/<subscription>` events.
 * - Every commit takes the next global revision and publishes `{ revision, record,
 *   removedIds }`, exactly what the store's `applyChange` fences on.
 * - Producer calls need a live producer session (the id Subscribe returned), as the
 *   host requires; an unknown id is rejected like the host rejects it. Unsubscribe
 *   removes only the view subscription: the producer session stays valid for the
 *   document, because the runtime keeps using it after a view unmounts.
 *
 * It models the observable contract only: no persistence, no producer ownership, no
 * history pruning, and no cancellation callbacks. Plugin-sourced provenance is rejected
 * for frontend producers, as the host does.
 */
import { emit, handleAll } from '../harness/backend';

type Json = Record<string, any>;

export interface ActivityFixture {
  /** Records currently held, oldest first. */
  records(): Json[];
  revision(): number;
  /** Subscriptions that are armed (attached) and receive change events. */
  armedSubscriptions(): number;
  /** Counters for the calls the shell made, by method name. */
  calls(): Record<string, number>;
}

const iso = () => new Date().toISOString();

function parse(encoded: unknown): Json {
  if (typeof encoded !== 'string') throw new Error('activity request must be encoded JSON');
  try {
    return JSON.parse(encoded) as Json;
  } catch {
    throw new Error('activity request is not valid JSON');
  }
}

export function installActivityFixture(): ActivityFixture {
  let revision = 0;
  let nextRecord = 0;
  let nextSubscription = 0;
  const records = new Map<string, Json>();
  /** Producer sessions: valid for the document, renewed by Heartbeat, never expired here. */
  const sessions = new Set<string>();
  /** View subscriptions: removed by Unsubscribe, armed by Attach. */
  const subscriptions = new Map<string, { armed: boolean }>();
  const callCounts: Record<string, number> = {};
  const counted = <A extends unknown[], R>(name: string, fn: (...args: A) => R) => (...args: A): R => {
    callCounts[name] = (callCounts[name] ?? 0) + 1;
    return fn(...args);
  };

  const snapshot = () => ({
    revision,
    records: [...records.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
  });
  const publish = (change: Json) => {
    for (const [id, subscription] of subscriptions) {
      if (subscription.armed) emit(`activity/change/${id}`, change);
    }
  };
  const commit = (record: Json): Json => {
    record.revision = ++revision;
    record.updatedAt = iso();
    records.set(record.id, record);
    publish({ revision, record });
    return record;
  };
  const session = (id: unknown) => {
    if (typeof id !== 'string' || !sessions.has(id)) throw new Error('activity session unavailable');
  };
  const refuseProvenance = (spec: Json) => {
    if (spec.source && (spec.source.pluginID || spec.source.resource)) {
      throw new Error('frontend observations cannot claim plugin provenance');
    }
  };
  const create = (spec: Json, kind: 'task' | 'alert' | 'message'): Json => {
    if (!spec.presentation || typeof spec.presentation.title !== 'string' || !spec.presentation.title) {
      throw new Error('activity presentation requires a title');
    }
    return {
      id: `bench-activity-${++nextRecord}`,
      revision: 0,
      source: spec.source ?? {},
      kind,
      severity: spec.severity || 'info',
      createdAt: iso(),
      updatedAt: iso(),
      ...(spec.parentId ? { parentId: spec.parentId } : {}),
      presentation: spec.presentation,
      visibility: { collapsed: false, toastDismissed: false, read: false },
    };
  };
  const active = (record: Json) => record.kind === 'task' && ['starting', 'running', 'paused'].includes(record.task?.state);
  const held = (id: unknown): Json => {
    const record = typeof id === 'string' ? records.get(id) : undefined;
    if (!record) throw new Error('activity unavailable for producer');
    return { ...record, task: record.task && { ...record.task }, alert: record.alert && { ...record.alert }, visibility: { ...record.visibility } };
  };

  handleAll({
    'activity.FrontendService.Subscribe': counted('Subscribe', () => {
      const id = `bench-activity-subscription-${++nextSubscription}`;
      sessions.add(id);
      subscriptions.set(id, { armed: false });
      return { id, snapshot: snapshot() };
    }),
    'activity.FrontendService.Attach': counted('Attach', (id: string) => {
      session(id);
      const subscription = subscriptions.get(id);
      if (!subscription) throw new Error('subscription unavailable');
      subscription.armed = true;
      return snapshot();
    }),
    'activity.FrontendService.Snapshot': counted('Snapshot', () => snapshot()),
    'activity.FrontendService.Heartbeat': counted('Heartbeat', (id: string) => { session(id); }),
    'activity.FrontendService.Unsubscribe': counted('Unsubscribe', (id: string) => { session(id); subscriptions.delete(id); }),
    'activity.FrontendService.BeginTask': counted('BeginTask', (sessionID: string, encoded: string) => {
      session(sessionID);
      const spec = parse(encoded);
      refuseProvenance(spec);
      const record = create(spec, 'task');
      record.task = { state: 'starting', cancellation: 'unsupported' };
      return commit(record);
    }),
    'activity.FrontendService.ReportTask': counted('ReportTask', (sessionID: string, encoded: string) => {
      session(sessionID);
      const request = parse(encoded);
      const record = held(request.id);
      if (!active(record)) throw new Error('task is not active');
      if (request.state && request.state !== 'running' && request.state !== 'paused') throw new Error('invalid task state');
      if (request.observedAt) record.observedAt = request.observedAt;
      record.presentation = request.presentation;
      record.task.state = request.state || 'running';
      return commit(record);
    }),
    'activity.FrontendService.FinishTask': counted('FinishTask', (sessionID: string, encoded: string) => {
      session(sessionID);
      const request = parse(encoded);
      const record = held(request.id);
      if (!active(record)) throw new Error('task already terminal');
      if (!['succeeded', 'failed', 'cancelled', 'unknown'].includes(request.state)) throw new Error('invalid terminal state');
      if (request.presentation) record.presentation = request.presentation;
      record.task.state = request.state;
      if (request.state === 'cancelled') record.task.cancellation = 'acknowledged';
      return commit(record);
    }),
    'activity.FrontendService.PublishMessage': counted('PublishMessage', (sessionID: string, encoded: string) => {
      session(sessionID);
      const spec = parse(encoded);
      refuseProvenance(spec);
      return commit(create(spec, 'message'));
    }),
    'activity.FrontendService.UpsertAlert': counted('UpsertAlert', (sessionID: string, encoded: string) => {
      session(sessionID);
      const request = parse(encoded);
      refuseProvenance(request);
      if (!request.key || String(request.key).length > 1024) throw new Error('invalid alert key');
      if (Number.isNaN(Date.parse(request.observedAt))) throw new Error('invalid alert observation time');
      for (const record of records.values()) {
        if (record.alert?.key !== request.key) continue;
        if (!(Date.parse(request.observedAt) > Date.parse(record.observedAt ?? ''))) return record;
        const next = held(record.id);
        next.alert.state = 'firing';
        next.alert.occurrences++;
        next.observedAt = request.observedAt;
        next.presentation = request.presentation;
        if (request.severity) next.severity = request.severity;
        return commit(next);
      }
      const record = create(request, 'alert');
      record.observedAt = request.observedAt;
      record.alert = { key: request.key, state: 'firing', occurrences: 1 };
      return commit(record);
    }),
    'activity.FrontendService.ResolveAlert': counted('ResolveAlert', (sessionID: string, request: Json) => {
      session(sessionID);
      for (const record of records.values()) {
        if (record.alert?.key !== request.key) continue;
        const next = held(record.id);
        next.alert.state = 'resolved';
        next.observedAt = request.observedAt;
        return commit(next);
      }
      throw new Error('alert unavailable');
    }),
    'activity.FrontendService.SetPresentation': counted('SetPresentation', (request: Json) => {
      const record = held(request.id);
      if (request.collapsed != null) record.visibility.collapsed = request.collapsed;
      if (request.toastDismissed != null) record.visibility.toastDismissed = request.toastDismissed;
      if (request.read != null) record.visibility.read = request.read;
      if (request.snoozedUntil != null || request.acknowledged != null) {
        if (!record.alert) throw new Error('presentation control requires alert');
        if (request.snoozedUntil != null) record.alert.snoozedUntil = request.snoozedUntil;
        if (request.acknowledged != null) record.alert.acknowledgedAt = request.acknowledged ? iso() : '';
      }
      return commit(record);
    }),
    'activity.FrontendService.ClearHistory': counted('ClearHistory', () => {
      const removedIds: string[] = [];
      for (const [id, record] of records) {
        if (!active(record) && record.alert?.state !== 'firing') { records.delete(id); removedIds.push(id); }
      }
      if (!removedIds.length) return;
      revision++;
      publish({ revision, removedIds });
    }),
    'activity.FrontendService.RequestCancellation': counted('RequestCancellation', () => {
      throw new Error('cancellation unavailable');
    }),
    'activity.FrontendService.StartResourceAction': counted('StartResourceAction', () => {
      throw new Error('resource actions unavailable');
    }),
  });

  return {
    records: () => snapshot().records,
    revision: () => revision,
    armedSubscriptions: () => [...subscriptions.values()].filter((subscription) => subscription.armed).length,
    calls: () => ({ ...callCounts }),
  };
}
