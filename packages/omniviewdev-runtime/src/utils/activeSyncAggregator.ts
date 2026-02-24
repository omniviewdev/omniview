/**
 * Pure aggregation logic for active sync tracking.
 * Extracted from useActiveSyncs for testability.
 */
import { InformerResourceState } from '../types/informer';
import type { InformerStateEvent } from '../types/informer';

export interface ActiveSync {
  pluginID: string;
  connectionID: string;
  totalResources: number;
  syncedCount: number;
  errorCount: number;
  /** Count of resources in any terminal state (Synced + Error + Cancelled) */
  doneCount: number;
  /** 0-1 progress fraction */
  progress: number;
}

export interface ResourceTracker {
  states: Record<string, InformerResourceState>;
  pluginID: string;
  connectionID: string;
}

/** Compute an ActiveSync from a ResourceTracker */
export function computeActiveSync(tracker: ResourceTracker): ActiveSync {
  const states = Object.values(tracker.states);
  const total = states.length;
  let synced = 0;
  let errors = 0;
  for (const s of states) {
    if (s === InformerResourceState.Synced) synced++;
    if (s === InformerResourceState.Error) errors++;
  }

  // A resource is "done" if it has reached a terminal state (Synced, Error, or Cancelled)
  const done = states.filter(
    s => s === InformerResourceState.Synced || s === InformerResourceState.Error || s === InformerResourceState.Cancelled
  ).length;
  const progress = total > 0 ? done / total : 0;

  return {
    pluginID: tracker.pluginID,
    connectionID: tracker.connectionID,
    totalResources: total,
    syncedCount: synced,
    errorCount: errors,
    doneCount: done,
    progress,
  };
}

/** Whether a sync is considered "done" (all resources reached terminal state) */
export function isSyncDone(sync: ActiveSync): boolean {
  return sync.totalResources > 0 && sync.doneCount >= sync.totalResources;
}

/** Whether any syncs are still actively in progress */
export function hasActiveSyncing(syncs: ActiveSync[]): boolean {
  return syncs.some(s => !isSyncDone(s));
}

/** Compute aggregate progress across multiple syncs */
export function aggregateProgress(syncs: ActiveSync[]): number {
  const totalResources = syncs.reduce((a, s) => a + s.totalResources, 0);
  if (totalResources === 0) return 0;
  const totalDone = syncs.reduce((a, s) => a + s.doneCount, 0);
  return totalDone / totalResources;
}

/** Build a tracker key from an event */
export function trackerKey(event: InformerStateEvent): string {
  return `${event.pluginId}/${event.connection}`;
}

/** Update a trackers map with a new event, returning the updated tracker */
export function updateTracker(
  trackers: Map<string, ResourceTracker>,
  event: InformerStateEvent,
): ResourceTracker {
  const key = trackerKey(event);

  if (!trackers.has(key)) {
    trackers.set(key, {
      states: {},
      pluginID: event.pluginId,
      connectionID: event.connection,
    });
  }

  const tracker = trackers.get(key)!;
  tracker.states[event.resourceKey] = event.state;
  return tracker;
}
