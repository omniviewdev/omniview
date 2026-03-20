import { useEffect, useState, useCallback, useRef } from 'react';
import { Events } from '@wailsio/runtime';
import {
  ListAllConnections,
  GetAllConnectionStates,
  StopConnection,
  StartConnectionWatch,
} from '../../bindings/github.com/omniviewdev/omniview/resourcecontrollerservice';
import { RetryFailedPlugin } from '../../bindings/github.com/omniviewdev/omniview/pluginmanagerservice';
import type { Connection } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
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
  connection: Connection;
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
  /** True when the plugin's crash recovery has been exhausted */
  pluginFailed: boolean;
  /** Error message from the crash recovery failure */
  pluginError?: string;
}

export interface ConnectionStatusSummary {
  entries: ConnectionStatusEntry[];
  grouped: Map<string, ConnectionStatusEntry[]>;
  connectedCount: number;
  syncingCount: number;
  errorCount: number;
  failedCount: number;
  hasSyncing: boolean;
  aggregateProgress: number;
  /** Disconnect a connection by plugin/connection ID */
  disconnect: (pluginID: string, connectionID: string) => Promise<void>;
  /** Retry watch sync for a connection */
  retryWatch: (pluginID: string, connectionID: string) => Promise<void>;
  /** Retry a failed plugin (reload it after crash recovery exhaustion) */
  retryPlugin: (pluginID: string) => Promise<void>;
}

/**
 * Unified hook that tracks connection status across all plugins.
 * Combines ListAllConnections query + connection/status events + watch/STATE events.
 */
export function useConnectionStatus(): ConnectionStatusSummary {
  // Set of "pluginID/connectionID" keys for started connections
  const [startedKeys, setStartedKeys] = useState<Set<string>>(new Set());
  // Connection metadata from ListAllConnections
  const [allConnections, setAllConnections] = useState<Record<string, Connection[]>>({});
  // Sync state per connection
  const [syncs, setSyncs] = useState<Map<string, ActiveSync>>(new Map());
  const trackersRef = useRef<Map<string, ResourceTracker>>(new Map());

  // Track plugins whose crash recovery has been exhausted
  const [failedPlugins, setFailedPlugins] = useState<Map<string, string>>(new Map());

  // Listen for plugin crash recovery events
  useEffect(() => {
    const cancelCrash = Events.On('plugin/crash_recovery_failed', (ev) => {
      const data = ev.data as { pluginID?: string; error?: string };
      const pluginID = data?.pluginID;
      if (!pluginID) return;
      setFailedPlugins((prev) => {
        const next = new Map(prev);
        next.set(pluginID, data.error ?? 'Crash recovery failed');
        return next;
      });
    });

    const cancelRecovered = Events.On('plugin/recovered', (ev) => {
      const data = ev.data as { pluginID?: string };
      const pluginID = data?.pluginID;
      if (!pluginID) return;
      setFailedPlugins((prev) => {
        if (!prev.has(pluginID)) return prev;
        const next = new Map(prev);
        next.delete(pluginID);
        return next;
      });
    });

    return () => {
      cancelCrash();
      cancelRecovered();
    };
  }, []);

  // Hydrate full connection + watch state on mount
  useEffect(() => {
    GetAllConnectionStates()
      .then((result: Record<string, ConnectionStateResponse[]>) => {
        if (!result) return;

        const conns: Record<string, Connection[]> = {};
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
    const cancel = Events.On('connection/status', (ev) => {
      const event = ev.data as {
        pluginID: string;
        connectionID: string;
        status: string;
        name: string;
      };
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
        .then((result: Record<string, Connection[]>) => {
          if (result) setAllConnections(result);
        })
        .catch(() => {});
    });

    return cancel;
  }, []);

  // Listen for watch/STATE events
  const handleWatchEvent = useCallback((ev: Events.WailsEvent) => {
    const event = ev.data as WatchStateEvent;
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
    const cancel = Events.On('watch/STATE', handleWatchEvent);
    return cancel;
  }, [handleWatchEvent]);

  // Actions
  const disconnect = useCallback(async (pluginID: string, connectionID: string) => {
    await StopConnection(pluginID, connectionID);
  }, []);

  const retryWatch = useCallback(async (pluginID: string, connectionID: string) => {
    await StartConnectionWatch(pluginID, connectionID);
  }, []);

  const retryPlugin = useCallback(async (pluginID: string) => {
    const previousError = failedPlugins.get(pluginID);
    // Clear the failed state optimistically before reload
    setFailedPlugins((prev) => {
      if (!prev.has(pluginID)) return prev;
      const next = new Map(prev);
      next.delete(pluginID);
      return next;
    });
    try {
      await RetryFailedPlugin(pluginID);
    } catch (err) {
      // Restore failed state if reload fails immediately
      setFailedPlugins((prev) => {
        const next = new Map(prev);
        next.set(pluginID, previousError ?? 'Reload failed');
        return next;
      });
      throw err;
    }
  }, [failedPlugins]);

  // Build entries from started connections
  const entries: ConnectionStatusEntry[] = [];
  for (const key of startedKeys) {
    const [pluginID, connectionID] = key.split('/', 2);
    const pluginConns = allConnections[pluginID] ?? [];
    const connMeta = pluginConns.find((c) => c.id === connectionID);
    const sync = syncs.get(key);
    const syncing = sync != null && !isSyncDone(sync);
    const hasErrors = sync != null && sync.errorCount > 0;
    const pluginError = failedPlugins.get(pluginID);

    entries.push({
      pluginID,
      connectionID,
      name: connMeta?.name ?? connectionID,
      avatar: connMeta?.avatar ?? '',
      isStarted: true,
      sync,
      isSyncing: syncing,
      hasErrors: hasErrors || pluginError != null,
      pluginFailed: pluginError != null,
      pluginError,
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
  const failedEntries = entries.filter((e) => e.pluginFailed);

  return {
    entries,
    grouped,
    connectedCount: entries.length,
    syncingCount: syncingEntries.length,
    errorCount: errorEntries.length,
    failedCount: failedEntries.length,
    hasSyncing: hasActiveSyncing(syncArray),
    aggregateProgress: computeAggregateProgress(syncArray),
    disconnect,
    retryWatch,
    retryPlugin,
  };
}
