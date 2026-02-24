import { useEffect, useState, useCallback, useRef } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import type { InformerStateEvent } from '../../types/informer';
import {
  type ActiveSync,
  type ResourceTracker,
  computeActiveSync,
  isSyncDone,
  hasActiveSyncing,
  aggregateProgress as computeAggregateProgress,
  trackerKey,
  updateTracker,
} from '../../utils/activeSyncAggregator';

export type { ActiveSync };

/**
 * useActiveSyncs aggregates informer sync state across all connections.
 * Subscribes to the global `informer/STATE` event topic.
 */
export const useActiveSyncs = () => {
  const [syncs, setSyncs] = useState<Map<string, ActiveSync>>(new Map());
  const trackersRef = useRef<Map<string, ResourceTracker>>(new Map());
  const removalTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const handleEvent = useCallback((event: InformerStateEvent) => {
    const key = trackerKey(event);
    const tracker = updateTracker(trackersRef.current, event);
    const activeSync = computeActiveSync(tracker);

    setSyncs(prev => {
      const next = new Map(prev);
      next.set(key, activeSync);
      return next;
    });

    // Clear existing removal timer
    if (removalTimers.current.has(key)) {
      clearTimeout(removalTimers.current.get(key));
      removalTimers.current.delete(key);
    }

    // Auto-remove completed syncs after 5s (synced + errored = done)
    if (isSyncDone(activeSync)) {
      const timer = setTimeout(() => {
        setSyncs(prev => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        trackersRef.current.delete(key);
        removalTimers.current.delete(key);
      }, 5000);
      removalTimers.current.set(key, timer);
    }
  }, []);

  useEffect(() => {
    const cancel = EventsOn('informer/STATE', handleEvent);
    return () => {
      cancel();
      for (const timer of removalTimers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, [handleEvent]);

  // Derived state
  const syncArray = Array.from(syncs.values());
  const hasSyncing = hasActiveSyncing(syncArray);
  const primarySync = syncArray.find(s => !isSyncDone(s)) ?? syncArray[0] ?? null;
  const aggregateProgress = computeAggregateProgress(syncArray);

  return {
    /** All tracked syncs */
    syncs: syncArray,
    /** Whether any connection is actively syncing */
    hasSyncing,
    /** The primary (first incomplete) sync or most recent */
    primarySync,
    /** Aggregate progress across all connections (0-1) */
    aggregateProgress,
  };
};
