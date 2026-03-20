/**
 * Pure aggregation logic for active sync tracking.
 * Extracted from useActiveSyncs for testability.
 */
import { WatchState } from '../types/watch';
import type { WatchStateEvent } from '../types/watch';

export interface ActiveSync {
  pluginID: string;
  connectionID: string;
  /** Total resources including skipped */
  totalResources: number;
  /** Total watched resources (excluding skipped) */
  watchedTotal: number;
  syncedCount: number;
  errorCount: number;
  forbiddenCount: number;
  skippedCount: number;
  /** Count of watched resources in any terminal state (Synced + Error + Stopped + Failed + Forbidden) */
  doneCount: number;
  /** 0-1 progress fraction based on watched resources only */
  progress: number;
}

export interface ResourceTracker {
  states: Record<string, WatchState>;
  pluginID: string;
  connectionID: string;
}

/** Compute an ActiveSync from a ResourceTracker */
export function computeActiveSync(tracker: ResourceTracker): ActiveSync {
  const states = Object.values(tracker.states);
  const total = states.length;
  let synced = 0;
  let errors = 0;
  let forbidden = 0;
  let skipped = 0;
  for (const s of states) {
    if (s === WatchState.WatchStateSynced) synced++;
    if (s === WatchState.WatchStateError || s === WatchState.WatchStateFailed) errors++;
    if (s === WatchState.WatchStateForbidden) forbidden++;
    if (s === WatchState.WatchStateSkipped) skipped++;
  }

  // Watched resources = total minus skipped
  const watchedTotal = total - skipped;

  // A watched resource is "done" if it has reached a terminal state (excluding SKIPPED)
  const done = states.filter(
    s => s === WatchState.WatchStateSynced || s === WatchState.WatchStateError || s === WatchState.WatchStateStopped ||
         s === WatchState.WatchStateFailed || s === WatchState.WatchStateForbidden
  ).length;

  // Progress based on watched resources only
  const progress = watchedTotal > 0 ? done / watchedTotal : 0;

  return {
    pluginID: tracker.pluginID,
    connectionID: tracker.connectionID,
    totalResources: total,
    watchedTotal,
    syncedCount: synced,
    errorCount: errors,
    forbiddenCount: forbidden,
    skippedCount: skipped,
    doneCount: done,
    progress,
  };
}

/** Whether a sync is considered "done" (all watched resources reached terminal state) */
export function isSyncDone(sync: ActiveSync): boolean {
  return sync.watchedTotal > 0 && sync.doneCount >= sync.watchedTotal;
}

/** Whether any syncs are still actively in progress */
export function hasActiveSyncing(syncs: ActiveSync[]): boolean {
  return syncs.some(s => !isSyncDone(s));
}

/** Compute aggregate progress across multiple syncs (watched resources only) */
export function aggregateProgress(syncs: ActiveSync[]): number {
  const totalWatched = syncs.reduce((a, s) => a + s.watchedTotal, 0);
  if (totalWatched === 0) return 0;
  const totalDone = syncs.reduce((a, s) => a + s.doneCount, 0);
  return totalDone / totalWatched;
}

/** Build a tracker key from an event */
export function trackerKey(event: WatchStateEvent): string {
  return `${event.pluginId}/${event.connection}`;
}

/** Update a trackers map with a new event, returning the updated tracker */
export function updateTracker(
  trackers: Map<string, ResourceTracker>,
  event: WatchStateEvent,
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
