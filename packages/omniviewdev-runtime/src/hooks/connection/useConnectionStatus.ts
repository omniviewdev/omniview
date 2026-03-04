import { useEffect, useState, useCallback, useRef } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import {
  ListAllConnections,
  GetAllConnectionStates,
  StopConnection,
  StartConnectionWatch,
} from '../../wailsjs/go/resource/Client';
import type { types } from '../../wailsjs/go/models';
import { WatchState } from '../../types/watch';
import type { WatchStateEvent } from '../../types/watch';
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

/**
 * Mirrors backend resource.ConnectionState.
 * Locally declared until Wails v3 model generation handles cross-package types.
 */
interface ConnectionStateResponse {
  connection: types.Connection;
  started: boolean;
  resources: Record<string, number>;
  resourceCounts: Record<string, number>;
  totalResources: number;
  syncedCount: number;
  errorCount: number;
  lastSyncTime?: string;
}

export interface ConnectionStatusEntry {
  pluginID: string;
  connectionID: string;
  name: string;
  avatar: string;
  isStarted: boolean;
  sync?: ActiveSync;
  isSyncing: boolean;
  hasErrors: boolean;
}

export interface ConnectionStatusSummary {
  entries: ConnectionStatusEntry[];
  grouped: Map<string, ConnectionStatusEntry[]>;
  connectedCount: number;
  syncingCount: number;
  errorCount: number;
  hasSyncing: boolean;
  aggregateProgress: number;
  /** Disconnect a connection by plugin/connection ID */
  disconnect: (pluginID: string, connectionID: string) => Promise<void>;
  /** Retry watch sync for a connection */
  retryWatch: (pluginID: string, connectionID: string) => Promise<void>;
}

/**
 * Unified hook that tracks connection status across all plugins.
 * Combines ListAllConnections query + connection/status events + watch/STATE events.
 */
export function useConnectionStatus(): ConnectionStatusSummary {
  // Set of "pluginID/connectionID" keys for started connections
  const [startedKeys, setStartedKeys] = useState<Set<string>>(new Set());
  // Connection metadata from ListAllConnections
  const [allConnections, setAllConnections] = useState<Record<string, types.Connection[]>>({});
  // Sync state per connection
  const [syncs, setSyncs] = useState<Map<string, ActiveSync>>(new Map());
  const trackersRef = useRef<Map<string, ResourceTracker>>(new Map());

  // Hydrate full connection + watch state on mount
  useEffect(() => {
    GetAllConnectionStates()
      .then((result: Record<string, ConnectionStateResponse[]>) => {
        if (!result) return;

        const conns: Record<string, types.Connection[]> = {};
        const keys = new Set<string>();
        const newSyncs = new Map<string, ActiveSync>();

        for (const [pluginID, states] of Object.entries(result)) {
          conns[pluginID] = states.map((s) => s.connection);

          for (const s of states) {
            if (!s.started) continue;

            const key = `${pluginID}/${s.connection.id}`;
            keys.add(key);

            // Build a tracker from the backend's resource states
            const tracker: ResourceTracker = {
              pluginID,
              connectionID: s.connection.id,
              states: {},
            };
            if (s.resources) {
              for (const [resourceKey, numericState] of Object.entries(s.resources)) {
                tracker.states[resourceKey] = numericState as WatchState;
              }
            }
            trackersRef.current.set(key, tracker);
            newSyncs.set(key, computeActiveSync(tracker));
          }
        }

        setAllConnections(conns);
        setStartedKeys(keys);
        setSyncs(newSyncs);
      })
      .catch(() => {
        // silently ignore - connections may not be available yet
      });
  }, []);

  // Listen for connection/status events
  useEffect(() => {
    const cancel = EventsOn('connection/status', (event: {
      pluginID: string;
      connectionID: string;
      status: string;
      name: string;
    }) => {
      const key = `${event.pluginID}/${event.connectionID}`;

      if (event.status === 'DISCONNECTED') {
        setStartedKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        // Clean up sync data
        setSyncs((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        trackersRef.current.delete(key);
      } else {
        // CONNECTED or other non-disconnected status
        setStartedKeys((prev) => {
          const next = new Set(prev);
          next.add(key);
          return next;
        });
      }

      // Re-fetch connections to get latest metadata
      ListAllConnections()
        .then((result: Record<string, types.Connection[]>) => {
          if (result) setAllConnections(result);
        })
        .catch(() => {});
    });

    return cancel;
  }, []);

  // Listen for watch/STATE events
  const handleWatchEvent = useCallback((event: WatchStateEvent) => {
    const key = trackerKey(event);

    // If we get watch events for a connection, it's started
    setStartedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    const tracker = updateTracker(trackersRef.current, event);
    const activeSync = computeActiveSync(tracker);

    setSyncs((prev) => {
      const next = new Map(prev);
      next.set(key, activeSync);
      return next;
    });
  }, []);

  useEffect(() => {
    const cancel = EventsOn('watch/STATE', handleWatchEvent);
    return cancel;
  }, [handleWatchEvent]);

  // Actions
  const disconnect = useCallback(async (pluginID: string, connectionID: string) => {
    await StopConnection(pluginID, connectionID);
  }, []);

  const retryWatch = useCallback(async (pluginID: string, connectionID: string) => {
    await StartConnectionWatch(pluginID, connectionID);
  }, []);

  // Build entries from started connections
  const entries: ConnectionStatusEntry[] = [];
  for (const key of startedKeys) {
    const [pluginID, connectionID] = key.split('/', 2);
    const pluginConns = allConnections[pluginID] ?? [];
    const connMeta = pluginConns.find((c) => c.id === connectionID);
    const sync = syncs.get(key);
    const syncing = sync != null && !isSyncDone(sync);
    const hasErrors = sync != null && sync.errorCount > 0;

    entries.push({
      pluginID,
      connectionID,
      name: connMeta?.name ?? connectionID,
      avatar: connMeta?.avatar ?? '',
      isStarted: true,
      sync,
      isSyncing: syncing,
      hasErrors,
    });
  }

  // Group by plugin
  const grouped = new Map<string, ConnectionStatusEntry[]>();
  for (const entry of entries) {
    const existing = grouped.get(entry.pluginID) ?? [];
    existing.push(entry);
    grouped.set(entry.pluginID, existing);
  }

  // Derived counts
  const syncArray = Array.from(syncs.values());
  const syncingEntries = entries.filter((e) => e.isSyncing);
  const errorEntries = entries.filter((e) => e.hasErrors);

  return {
    entries,
    grouped,
    connectedCount: entries.length,
    syncingCount: syncingEntries.length,
    errorCount: errorEntries.length,
    hasSyncing: hasActiveSyncing(syncArray),
    aggregateProgress: computeAggregateProgress(syncArray),
    disconnect,
    retryWatch,
  };
}
