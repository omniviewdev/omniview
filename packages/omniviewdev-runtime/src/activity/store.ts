import type {
  ActivityChange,
  ActivityFilter,
  ActivityRecord,
  ActivitySnapshot,
  DiagnosticAction,
} from './types';
import type { ActivityClient } from './client';

export const isActiveTask = (record: ActivityRecord) =>
  record.kind === 'task' &&
  !!record.task &&
  ['starting', 'running', 'paused'].includes(record.task.state);
export const needsAttention = (record: ActivityRecord) =>
  record.alert?.state === 'firing' ||
  record.task?.state === 'unknown' ||
  record.severity === 'error' ||
  record.severity === 'warning';
export type ActivityView = {
  records: ActivityRecord[];
  centerOpen: boolean;
  filter: ActivityFilter;
  pinnedIds: ReadonlySet<string>;
};

/** One read model; presentation surfaces never own a second history. */
export class ActivityStore {
  private records = new Map<string, ActivityRecord>();
  private tombstones = new Map<string, number>();
  private snapshotRevision = -1;
  private listeners = new Set<() => void>();
  private diagnostics = new Map<string, DiagnosticAction[]>();
  private view: ActivityView = {
    records: [],
    centerOpen: false,
    filter: 'all',
    pinnedIds: new Set(),
  };
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.view = {
      ...this.view,
      records: [...this.records.values()].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      ),
    };
    if (this.view.centerOpen) {
      const pinnedIds = new Set(this.view.pinnedIds);
      for (const record of this.view.records) {
        if (
          this.view.filter === 'all' ||
          (this.view.filter === 'active' ? isActiveTask(record) : needsAttention(record))
        )
          pinnedIds.add(record.id);
      }
      this.view = { ...this.view, pinnedIds };
    }
    for (const listener of this.listeners) listener();
  }
  applyChange = (change: ActivityChange) => {
    if (change.revision <= this.snapshotRevision) return;
    let changed = false;
    for (const id of change.removedIds ?? []) {
      if (change.revision <= (this.tombstones.get(id) ?? -1)) continue;
      if ((this.records.get(id)?.revision ?? -1) > change.revision) continue;
      this.tombstones.set(id, change.revision);
      this.records.delete(id);
      this.diagnostics.delete(id);
      changed = true;
    }
    if (change.record) changed = this.put(change.record) || changed;
    if (changed) this.emit();
  };
  private put(record: ActivityRecord) {
    if (
      record.revision <= (this.tombstones.get(record.id) ?? -1) ||
      record.revision <= (this.records.get(record.id)?.revision ?? -1)
    )
      return false;
    this.records.set(record.id, record);
    return true;
  }
  applyRecord = (record: ActivityRecord) => this.applyChange({ revision: record.revision, record });
  applySnapshot = (snapshot: ActivitySnapshot) => {
    if (snapshot.revision < this.snapshotRevision) return;
    const present = new Set(snapshot.records.map((record) => record.id));
    for (const [id, record] of this.records) {
      if (!present.has(id) && record.revision <= snapshot.revision) {
        this.records.delete(id);
        this.tombstones.set(id, snapshot.revision);
        this.diagnostics.delete(id);
      }
    }
    for (const record of snapshot.records) this.put(record);
    this.snapshotRevision = snapshot.revision;
    this.emit();
  };
  setDiagnosticActions = (id: string, actions: DiagnosticAction[]) => {
    this.diagnostics.set(id, actions);
    this.emit();
  };
  getDiagnosticActions = (id: string) => this.diagnostics.get(id) ?? [];
  openNotifications = (filter: ActivityFilter = 'all') => {
    const pinnedIds = new Set(
      this.view.records
        .filter(
          (record) =>
            filter === 'all' ||
            (filter === 'active' ? isActiveTask(record) : needsAttention(record)),
        )
        .map((record) => record.id),
    );
    this.view = { ...this.view, centerOpen: true, filter, pinnedIds };
    this.emit();
  };
  closeNotifications = () => {
    this.view = { ...this.view, centerOpen: false, pinnedIds: new Set() };
    this.emit();
  };
}

/** Subscribe, install listener, then arm: no mutation can fall between snapshot and listener. */
export async function connectActivityStore(
  store: ActivityStore,
  client: Pick<ActivityClient, 'subscribe' | 'listen' | 'attach' | 'unsubscribe'>,
  signal: AbortSignal,
) {
  const subscription = await client.subscribe();
  let stop: (() => void) | undefined;
  const dispose = () => {
    stop?.();
    stop = undefined;
    void client.unsubscribe(subscription.id).catch(() => undefined);
  };
  if (signal.aborted) {
    dispose();
    return;
  }
  signal.addEventListener('abort', dispose, { once: true });
  try {
    store.applySnapshot(subscription.snapshot);
    stop = client.listen(subscription.id, store.applyChange);
    const snapshot = await client.attach(subscription.id);
    if (!signal.aborted) store.applySnapshot(snapshot);
  } catch (error) {
    signal.removeEventListener('abort', dispose);
    dispose();
    if (!signal.aborted) throw error;
  }
}
