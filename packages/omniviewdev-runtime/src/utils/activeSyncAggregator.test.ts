import { describe, expect, it } from 'vitest';
import { aggregateProgress, computeActiveSync, hasActiveSyncing, isSyncDone, trackerKey, updateTracker } from './activeSyncAggregator';
import type { HostSourceStateEvent } from '../resource/v2/host';

const event = (pluginID: string, connection: string, type: string, state: HostSourceStateEvent['status']['state']): HostSourceStateEvent => ({
  pluginID, route: { connection }, type,
  status: { state, mode: 'snapshot', count: { kind: 'exact', value: '0' } },
});

describe('source sync aggregation', () => {
  it('counts every terminal state and reports failures', () => {
    const sync = computeActiveSync({ pluginID: 'p', connectionID: 'c', states: {
      a: 'following', b: 'finished', c: 'failed', d: 'closed', e: 'opening', f: 'snapshotting', g: 'resetRequired',
    } });
    expect(sync).toMatchObject({ trackedTotal: 7, syncedCount: 2, errorCount: 1, doneCount: 4, progress: 4 / 7 });
    expect(isSyncDone(sync)).toBe(false);
    expect(hasActiveSyncing([sync])).toBe(true);
  });

  it('weights aggregate progress by tracked types', () => {
    const one = computeActiveSync({ pluginID: 'p', connectionID: '1', states: { a: 'following' } });
    const two = computeActiveSync({ pluginID: 'p', connectionID: '2', states: { a: 'closed', b: 'failed', c: 'opening' } });
    expect(isSyncDone(one)).toBe(true);
    expect(aggregateProgress([one, two])).toBe(0.75);
    expect(aggregateProgress([])).toBe(0);
    expect(isSyncDone(computeActiveSync({ pluginID: 'p', connectionID: 'empty', states: {} }))).toBe(false);
  });

  it('updates types and isolates opaque route tuples', () => {
    const trackers = new Map();
    const first = event('a/b', 'c', 'pods', 'opening');
    const second = event('a', 'b/c', 'pods', 'failed');
    updateTracker(trackers, first.pluginID, first);
    updateTracker(trackers, second.pluginID, second);
    updateTracker(trackers, first.pluginID, event('a/b', 'c', 'pods', 'finished'));
    expect(trackers.size).toBe(2);
    expect(trackers.get(trackerKey(first.pluginID, first)).states.pods).toBe('finished');
    expect(trackers.get(trackerKey(second.pluginID, second)).states.pods).toBe('failed');
  });
});
