import { WatchState } from '../types/watch';
import type { WatchStateEvent } from '../types/watch';
import {
  computeActiveSync,
  isSyncDone,
  hasActiveSyncing,
  aggregateProgress,
  trackerKey,
  updateTracker,
  type ResourceTracker,
  type ActiveSync,
} from './activeSyncAggregator';

describe('computeActiveSync', () => {
  it('computes correct counts for all-synced tracker', () => {
    const tracker: ResourceTracker = {
      pluginID: 'k8s',
      connectionID: 'cluster1',
      states: {
        'k8s:/pods': WatchState.WatchStateSynced,
        'k8s:/services': WatchState.WatchStateSynced,
        'k8s:apps/deployments': WatchState.WatchStateSynced,
      },
    };

    const result = computeActiveSync(tracker);
    expect(result.totalResources).toBe(3);
    expect(result.syncedCount).toBe(3);
    expect(result.errorCount).toBe(0);
    expect(result.doneCount).toBe(3);
    expect(result.progress).toBe(1);
  });

  it('computes correct counts for mixed states', () => {
    const tracker: ResourceTracker = {
      pluginID: 'k8s',
      connectionID: 'cluster1',
      states: {
        'k8s:/pods': WatchState.WatchStateSynced,
        'k8s:/services': WatchState.WatchStateSyncing,
        'k8s:apps/deployments': WatchState.WatchStateError,
        'k8s:/secrets': WatchState.WatchStateIdle,
      },
    };

    const result = computeActiveSync(tracker);
    expect(result.totalResources).toBe(4);
    expect(result.syncedCount).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.doneCount).toBe(2);
    expect(result.progress).toBe(0.5);
  });

  it('counts errored resources toward progress', () => {
    const tracker: ResourceTracker = {
      pluginID: 'k8s',
      connectionID: 'cluster1',
      states: {
        'k8s:/pods': WatchState.WatchStateSynced,
        'k8s:/services': WatchState.WatchStateError,
      },
    };

    const result = computeActiveSync(tracker);
    expect(result.progress).toBe(1);
    expect(result.doneCount).toBe(2);
    expect(result.syncedCount).toBe(1);
    expect(result.errorCount).toBe(1);
  });

  it('counts cancelled resources toward progress', () => {
    const tracker: ResourceTracker = {
      pluginID: 'k8s',
      connectionID: 'cluster1',
      states: {
        'k8s:/pods': WatchState.WatchStateSynced,
        'k8s:/services': WatchState.WatchStateStopped,
      },
    };

    const result = computeActiveSync(tracker);
    expect(result.progress).toBe(1);
    expect(result.doneCount).toBe(2);
    expect(result.syncedCount).toBe(1);
    expect(result.errorCount).toBe(0);
  });

  it('returns 0 progress for empty tracker', () => {
    const tracker: ResourceTracker = {
      pluginID: 'k8s',
      connectionID: 'cluster1',
      states: {},
    };

    const result = computeActiveSync(tracker);
    expect(result.totalResources).toBe(0);
    expect(result.doneCount).toBe(0);
    expect(result.progress).toBe(0);
  });

  it('computes progress for all-pending tracker', () => {
    const tracker: ResourceTracker = {
      pluginID: 'k8s',
      connectionID: 'cluster1',
      states: {
        'k8s:/pods': WatchState.WatchStateIdle,
        'k8s:/services': WatchState.WatchStateIdle,
      },
    };

    const result = computeActiveSync(tracker);
    expect(result.totalResources).toBe(2);
    expect(result.watchedTotal).toBe(2);
    expect(result.syncedCount).toBe(0);
    expect(result.doneCount).toBe(0);
    expect(result.progress).toBe(0);
  });

  it('excludes SKIPPED resources from watchedTotal and progress', () => {
    const tracker: ResourceTracker = {
      pluginID: 'k8s',
      connectionID: 'cluster1',
      states: {
        'k8s:/pods': WatchState.WatchStateSynced,
        'k8s:/services': WatchState.WatchStateSynced,
        'opaque.example.io/deviceclasses': WatchState.WatchStateSkipped,
        'opaque.example.io/resourceclaims': WatchState.WatchStateSkipped,
        'opaque.example.io/resourceslices': WatchState.WatchStateSkipped,
      },
    };

    const result = computeActiveSync(tracker);
    expect(result.totalResources).toBe(5);
    expect(result.watchedTotal).toBe(2);
    expect(result.skippedCount).toBe(3);
    expect(result.syncedCount).toBe(2);
    expect(result.doneCount).toBe(2);
    expect(result.progress).toBe(1); // 2/2 watched are done
  });
});

describe('isSyncDone', () => {
  it('returns true when all resources are synced', () => {
    const sync: ActiveSync = {
      pluginID: 'k8s', connectionID: 'c1',
      totalResources: 3, watchedTotal: 3, syncedCount: 3, errorCount: 0, forbiddenCount: 0, skippedCount: 0, doneCount: 3, progress: 1,
    };
    expect(isSyncDone(sync)).toBe(true);
  });

  it('returns true when all resources are either synced or errored', () => {
    const sync: ActiveSync = {
      pluginID: 'k8s', connectionID: 'c1',
      totalResources: 3, watchedTotal: 3, syncedCount: 2, errorCount: 1, forbiddenCount: 0, skippedCount: 0, doneCount: 3, progress: 1,
    };
    expect(isSyncDone(sync)).toBe(true);
  });

  it('returns true when all resources errored', () => {
    const sync: ActiveSync = {
      pluginID: 'k8s', connectionID: 'c1',
      totalResources: 3, watchedTotal: 3, syncedCount: 0, errorCount: 3, forbiddenCount: 0, skippedCount: 0, doneCount: 3, progress: 1,
    };
    expect(isSyncDone(sync)).toBe(true);
  });

  it('returns true when mix of synced, errored, and cancelled', () => {
    const sync: ActiveSync = {
      pluginID: 'k8s', connectionID: 'c1',
      totalResources: 4, watchedTotal: 4, syncedCount: 2, errorCount: 1, forbiddenCount: 0, skippedCount: 0, doneCount: 4, progress: 1,
    };
    expect(isSyncDone(sync)).toBe(true);
  });

  it('returns false when some resources are still syncing', () => {
    const sync: ActiveSync = {
      pluginID: 'k8s', connectionID: 'c1',
      totalResources: 3, watchedTotal: 3, syncedCount: 1, errorCount: 0, forbiddenCount: 0, skippedCount: 0, doneCount: 1, progress: 0.33,
    };
    expect(isSyncDone(sync)).toBe(false);
  });

  it('returns false for empty sync', () => {
    const sync: ActiveSync = {
      pluginID: 'k8s', connectionID: 'c1',
      totalResources: 0, watchedTotal: 0, syncedCount: 0, errorCount: 0, forbiddenCount: 0, skippedCount: 0, doneCount: 0, progress: 0,
    };
    expect(isSyncDone(sync)).toBe(false);
  });
});

describe('hasActiveSyncing', () => {
  it('returns false for empty array', () => {
    expect(hasActiveSyncing([])).toBe(false);
  });

  it('returns false when all syncs are done', () => {
    const syncs: ActiveSync[] = [
      { pluginID: 'k8s', connectionID: 'c1', totalResources: 3, watchedTotal: 3, syncedCount: 3, errorCount: 0, forbiddenCount: 0, skippedCount: 0, doneCount: 3, progress: 1 },
      { pluginID: 'k8s', connectionID: 'c2', totalResources: 2, watchedTotal: 2, syncedCount: 2, errorCount: 0, forbiddenCount: 0, skippedCount: 0, doneCount: 2, progress: 1 },
    ];
    expect(hasActiveSyncing(syncs)).toBe(false);
  });

  it('returns false when all resources errored (terminal state)', () => {
    const syncs: ActiveSync[] = [
      { pluginID: 'k8s', connectionID: 'c1', totalResources: 3, watchedTotal: 3, syncedCount: 0, errorCount: 3, forbiddenCount: 0, skippedCount: 0, doneCount: 3, progress: 1 },
    ];
    expect(hasActiveSyncing(syncs)).toBe(false);
  });

  it('returns false when done via cancelled + synced', () => {
    const syncs: ActiveSync[] = [
      { pluginID: 'k8s', connectionID: 'c1', totalResources: 4, watchedTotal: 4, syncedCount: 2, errorCount: 0, forbiddenCount: 0, skippedCount: 0, doneCount: 4, progress: 1 },
    ];
    expect(hasActiveSyncing(syncs)).toBe(false);
  });

  it('returns true when some resources are still in progress', () => {
    const syncs: ActiveSync[] = [
      { pluginID: 'k8s', connectionID: 'c1', totalResources: 3, watchedTotal: 3, syncedCount: 1, errorCount: 0, forbiddenCount: 0, skippedCount: 0, doneCount: 1, progress: 0.33 },
    ];
    expect(hasActiveSyncing(syncs)).toBe(true);
  });
});

describe('aggregateProgress', () => {
  it('returns 0 for empty array', () => {
    expect(aggregateProgress([])).toBe(0);
  });

  it('computes aggregate across multiple syncs', () => {
    const syncs: ActiveSync[] = [
      { pluginID: 'k8s', connectionID: 'c1', totalResources: 4, watchedTotal: 4, syncedCount: 2, errorCount: 0, forbiddenCount: 0, skippedCount: 0, doneCount: 2, progress: 0.5 },
      { pluginID: 'k8s', connectionID: 'c2', totalResources: 6, watchedTotal: 6, syncedCount: 6, errorCount: 0, forbiddenCount: 0, skippedCount: 0, doneCount: 6, progress: 1 },
    ];
    expect(aggregateProgress(syncs)).toBe(0.8);
  });

  it('includes errors and cancelled in aggregate progress', () => {
    const syncs: ActiveSync[] = [
      { pluginID: 'k8s', connectionID: 'c1', totalResources: 4, watchedTotal: 4, syncedCount: 1, errorCount: 1, forbiddenCount: 0, skippedCount: 0, doneCount: 4, progress: 1 },
    ];
    expect(aggregateProgress(syncs)).toBe(1);
  });
});

describe('trackerKey', () => {
  it('creates key from event fields', () => {
    const event: WatchStateEvent = {
      route: { connection: 'cluster-1' },
      type: 'k8s:/pods',
      state: WatchState.WatchStateSyncing,
      count: { kind: 'unknown' },
      guarantee: 'bestEffort',
    };
    expect(trackerKey('kubernetes', event)).toBe(JSON.stringify(['kubernetes', 'cluster-1']));
  });
});

describe('updateTracker', () => {
  it('creates a new tracker for unknown connection', () => {
    const trackers = new Map<string, ResourceTracker>();
    const event: WatchStateEvent = {
      route: { connection: 'c1' },
      type: 'k8s:/pods',
      state: WatchState.WatchStateSyncing,
      count: { kind: 'unknown' },
      guarantee: 'bestEffort',
    };

    const tracker = updateTracker(trackers, 'k8s', event);
    expect(tracker.pluginID).toBe('k8s');
    expect(tracker.connectionID).toBe('c1');
    expect(tracker.states['k8s:/pods']).toBe(WatchState.WatchStateSyncing);
  });

  it('updates existing tracker state', () => {
    const trackers = new Map<string, ResourceTracker>();
    trackers.set(JSON.stringify(['k8s', 'c1']), {
      pluginID: 'k8s',
      connectionID: 'c1',
      states: { 'k8s:/pods': WatchState.WatchStateSyncing },
    });

    const event: WatchStateEvent = {
      route: { connection: 'c1' },
      type: 'k8s:/pods',
      state: WatchState.WatchStateSynced,
      count: { kind: 'exact', value: '42' },
      guarantee: 'bestEffort',
    };

    const tracker = updateTracker(trackers, 'k8s', event);
    expect(tracker.states['k8s:/pods']).toBe(WatchState.WatchStateSynced);
  });

  it('tracks multiple resources per connection', () => {
    const trackers = new Map<string, ResourceTracker>();

    updateTracker(trackers, 'k8s', {
      route: { connection: 'c1' }, type: 'k8s:/pods',
      state: WatchState.WatchStateSynced, count: { kind: 'exact', value: '10' }, guarantee: 'bestEffort',
    });
    const tracker = updateTracker(trackers, 'k8s', {
      route: { connection: 'c1' }, type: 'k8s:/services',
      state: WatchState.WatchStateSyncing, count: { kind: 'unknown' }, guarantee: 'bestEffort',
    });

    expect(Object.keys(tracker.states)).toHaveLength(2);
    expect(tracker.states['k8s:/pods']).toBe(WatchState.WatchStateSynced);
    expect(tracker.states['k8s:/services']).toBe(WatchState.WatchStateSyncing);
  });
});

it('isolates opaque plugin and connection IDs even when slash tuples would collide', () => {
  const trackers = new Map<string, ResourceTracker>();
  const first: WatchStateEvent = { route: { connection: 'c/雪' }, type: 'opaque/type', state: WatchState.WatchStateSyncing, count: { kind: 'unknown' }, guarantee: 'bestEffort' };
  const second: WatchStateEvent = { ...first, route: { connection: 'b/c/雪' }, state: WatchState.WatchStateSynced };
  updateTracker(trackers, 'a/b', first);
  updateTracker(trackers, 'a', second);
  expect(trackers.size).toBe(2);
  expect(trackers.get(trackerKey('a/b', first))!.states['opaque/type']).toBe(WatchState.WatchStateSyncing);
  expect(trackers.get(trackerKey('a', second))!.states['opaque/type']).toBe(WatchState.WatchStateSynced);
});
