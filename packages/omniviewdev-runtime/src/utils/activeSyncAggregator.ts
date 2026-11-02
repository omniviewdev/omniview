import type { HostSourceStateEvent } from '../resource/v2/host';
import type { SourceSessionState } from '../types/source';

export interface ActiveSync {
  pluginID: string;
  connectionID: string;
  totalResources: number;
  trackedTotal: number;
  syncedCount: number;
  errorCount: number;
  doneCount: number;
  progress: number;
}

export interface ResourceTracker {
  states: Record<string, SourceSessionState>;
  pluginID: string;
  connectionID: string;
}

export function computeActiveSync(tracker: ResourceTracker): ActiveSync {
  const states = Object.values(tracker.states);
  const trackedTotal = states.length;
  const syncedCount = states.filter(s => s === 'following' || s === 'finished').length;
  const errorCount = states.filter(s => s === 'failed').length;
  const doneCount = states.filter(s => s === 'following' || s === 'finished' || s === 'failed' || s === 'closed').length;
  return {
    pluginID: tracker.pluginID,
    connectionID: tracker.connectionID,
    totalResources: trackedTotal,
    trackedTotal,
    syncedCount,
    errorCount,
    doneCount,
    progress: trackedTotal ? doneCount / trackedTotal : 0,
  };
}

export function isSyncDone(sync: ActiveSync): boolean {
  return sync.trackedTotal > 0 && sync.doneCount >= sync.trackedTotal;
}

export function hasActiveSyncing(syncs: ActiveSync[]): boolean {
  return syncs.some(s => !isSyncDone(s));
}

export function aggregateProgress(syncs: ActiveSync[]): number {
  const total = syncs.reduce((a, s) => a + s.trackedTotal, 0);
  return total ? syncs.reduce((a, s) => a + s.doneCount, 0) / total : 0;
}

export function trackerKey(pluginID: string, event: HostSourceStateEvent): string {
  return JSON.stringify([pluginID, event.route.connection]);
}

export function updateTracker(
  trackers: Map<string, ResourceTracker>,
  pluginID: string,
  event: HostSourceStateEvent,
): ResourceTracker {
  const key = trackerKey(pluginID, event);
  let tracker = trackers.get(key);
  if (!tracker) {
    tracker = { states: {}, pluginID, connectionID: event.route.connection };
    trackers.set(key, tracker);
  }
  tracker.states[event.type] = event.status.state;
  return tracker;
}
