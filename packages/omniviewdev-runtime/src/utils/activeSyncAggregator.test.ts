import { InformerResourceState } from '../types/informer';
import type { InformerStateEvent } from '../types/informer';
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
        'core::v1::Pod': InformerResourceState.Synced,
        'core::v1::Service': InformerResourceState.Synced,
        'apps::v1::Deployment': InformerResourceState.Synced,
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
        'core::v1::Pod': InformerResourceState.Synced,
        'core::v1::Service': InformerResourceState.Syncing,
        'apps::v1::Deployment': InformerResourceState.Error,
        'core::v1::Secret': InformerResourceState.Pending,
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
        'core::v1::Pod': InformerResourceState.Synced,
        'core::v1::Service': InformerResourceState.Error,
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
        'core::v1::Pod': InformerResourceState.Synced,
        'core::v1::Service': InformerResourceState.Cancelled,
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
        'core::v1::Pod': InformerResourceState.Pending,
        'core::v1::Service': InformerResourceState.Pending,
      },
    };

    const result = computeActiveSync(tracker);
    expect(result.totalResources).toBe(2);
    expect(result.syncedCount).toBe(0);
    expect(result.doneCount).toBe(0);
    expect(result.progress).toBe(0);
  });
});

describe('isSyncDone', () => {
  it('returns true when all resources are synced', () => {
    const sync: ActiveSync = {
      pluginID: 'k8s', connectionID: 'c1',
      totalResources: 3, syncedCount: 3, errorCount: 0, doneCount: 3, progress: 1,
    };
    expect(isSyncDone(sync)).toBe(true);
  });

  it('returns true when all resources are either synced or errored', () => {
    const sync: ActiveSync = {
      pluginID: 'k8s', connectionID: 'c1',
      totalResources: 3, syncedCount: 2, errorCount: 1, doneCount: 3, progress: 1,
    };
    expect(isSyncDone(sync)).toBe(true);
  });

  it('returns true when all resources errored', () => {
    const sync: ActiveSync = {
      pluginID: 'k8s', connectionID: 'c1',
      totalResources: 3, syncedCount: 0, errorCount: 3, doneCount: 3, progress: 1,
    };
    expect(isSyncDone(sync)).toBe(true);
  });

  it('returns true when mix of synced, errored, and cancelled', () => {
    const sync: ActiveSync = {
      pluginID: 'k8s', connectionID: 'c1',
      totalResources: 4, syncedCount: 2, errorCount: 1, doneCount: 4, progress: 1,
    };
    expect(isSyncDone(sync)).toBe(true);
  });

  it('returns false when some resources are still syncing', () => {
    const sync: ActiveSync = {
      pluginID: 'k8s', connectionID: 'c1',
      totalResources: 3, syncedCount: 1, errorCount: 0, doneCount: 1, progress: 0.33,
    };
    expect(isSyncDone(sync)).toBe(false);
  });

  it('returns false for empty sync', () => {
    const sync: ActiveSync = {
      pluginID: 'k8s', connectionID: 'c1',
      totalResources: 0, syncedCount: 0, errorCount: 0, doneCount: 0, progress: 0,
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
      { pluginID: 'k8s', connectionID: 'c1', totalResources: 3, syncedCount: 3, errorCount: 0, doneCount: 3, progress: 1 },
      { pluginID: 'k8s', connectionID: 'c2', totalResources: 2, syncedCount: 2, errorCount: 0, doneCount: 2, progress: 1 },
    ];
    expect(hasActiveSyncing(syncs)).toBe(false);
  });

  it('returns false when all resources errored (terminal state)', () => {
    const syncs: ActiveSync[] = [
      { pluginID: 'k8s', connectionID: 'c1', totalResources: 3, syncedCount: 0, errorCount: 3, doneCount: 3, progress: 1 },
    ];
    expect(hasActiveSyncing(syncs)).toBe(false);
  });

  it('returns false when done via cancelled + synced', () => {
    const syncs: ActiveSync[] = [
      { pluginID: 'k8s', connectionID: 'c1', totalResources: 4, syncedCount: 2, errorCount: 0, doneCount: 4, progress: 1 },
    ];
    expect(hasActiveSyncing(syncs)).toBe(false);
  });

  it('returns true when some resources are still in progress', () => {
    const syncs: ActiveSync[] = [
      { pluginID: 'k8s', connectionID: 'c1', totalResources: 3, syncedCount: 1, errorCount: 0, doneCount: 1, progress: 0.33 },
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
      { pluginID: 'k8s', connectionID: 'c1', totalResources: 4, syncedCount: 2, errorCount: 0, doneCount: 2, progress: 0.5 },
      { pluginID: 'k8s', connectionID: 'c2', totalResources: 6, syncedCount: 6, errorCount: 0, doneCount: 6, progress: 1 },
    ];
    expect(aggregateProgress(syncs)).toBe(0.8);
  });

  it('includes errors and cancelled in aggregate progress', () => {
    const syncs: ActiveSync[] = [
      { pluginID: 'k8s', connectionID: 'c1', totalResources: 4, syncedCount: 1, errorCount: 1, doneCount: 4, progress: 1 },
    ];
    expect(aggregateProgress(syncs)).toBe(1);
  });
});

describe('trackerKey', () => {
  it('creates key from event fields', () => {
    const event: InformerStateEvent = {
      pluginId: 'kubernetes',
      connection: 'cluster-1',
      resourceKey: 'core::v1::Pod',
      state: InformerResourceState.Syncing,
      resourceCount: 0,
      totalCount: -1,
    };
    expect(trackerKey(event)).toBe('kubernetes/cluster-1');
  });
});

describe('updateTracker', () => {
  it('creates a new tracker for unknown connection', () => {
    const trackers = new Map<string, ResourceTracker>();
    const event: InformerStateEvent = {
      pluginId: 'k8s',
      connection: 'c1',
      resourceKey: 'core::v1::Pod',
      state: InformerResourceState.Syncing,
      resourceCount: 0,
      totalCount: -1,
    };

    const tracker = updateTracker(trackers, event);
    expect(tracker.pluginID).toBe('k8s');
    expect(tracker.connectionID).toBe('c1');
    expect(tracker.states['core::v1::Pod']).toBe(InformerResourceState.Syncing);
  });

  it('updates existing tracker state', () => {
    const trackers = new Map<string, ResourceTracker>();
    trackers.set('k8s/c1', {
      pluginID: 'k8s',
      connectionID: 'c1',
      states: { 'core::v1::Pod': InformerResourceState.Syncing },
    });

    const event: InformerStateEvent = {
      pluginId: 'k8s',
      connection: 'c1',
      resourceKey: 'core::v1::Pod',
      state: InformerResourceState.Synced,
      resourceCount: 42,
      totalCount: 42,
    };

    const tracker = updateTracker(trackers, event);
    expect(tracker.states['core::v1::Pod']).toBe(InformerResourceState.Synced);
  });

  it('tracks multiple resources per connection', () => {
    const trackers = new Map<string, ResourceTracker>();

    updateTracker(trackers, {
      pluginId: 'k8s', connection: 'c1', resourceKey: 'core::v1::Pod',
      state: InformerResourceState.Synced, resourceCount: 10, totalCount: 10,
    });
    const tracker = updateTracker(trackers, {
      pluginId: 'k8s', connection: 'c1', resourceKey: 'core::v1::Service',
      state: InformerResourceState.Syncing, resourceCount: 0, totalCount: -1,
    });

    expect(Object.keys(tracker.states)).toHaveLength(2);
    expect(tracker.states['core::v1::Pod']).toBe(InformerResourceState.Synced);
    expect(tracker.states['core::v1::Service']).toBe(InformerResourceState.Syncing);
  });
});
