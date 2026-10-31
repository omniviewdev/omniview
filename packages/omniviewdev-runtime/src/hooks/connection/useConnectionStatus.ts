import { useEffect, useState, useCallback, useRef } from 'react';
import { Events } from '@wailsio/runtime';
import {
  ListAllConnections,
  GetAllConnectionStates,
  StartConnectionWatch,
  Catalog,
  ResolveTarget,
} from '../../resource/v2/client';
import { RetryFailedPlugin } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/servicewrapper';
import type { Connection } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
import { WatchState } from '../../types/watch';
import type { NativeConnectionReadiness, HostConnectionState, HostWatchStateEvent } from '../../resource/v2/host';
import { parseAppError } from '../../errors/parseAppError';
import type { AppError } from '../../errors/types';
import { stopConnectionWithReadiness } from '../../connection/connectionReadiness';
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

export interface ConnectionStatusEntry {
  pluginID: string;
  connectionID: string;
  name: string;
  avatar: string;
  readiness: NativeConnectionReadiness;
  readinessError?: HostConnectionState['readinessError'];
  sync?: ActiveSync;
  isSyncing: boolean;
  hasErrors: boolean;
  /** True when the plugin's crash recovery has been exhausted */
  pluginFailed: boolean;
  /** Error message from the crash recovery failure */
  pluginError?: string;
}

export interface ConnectionStatusSummary {
  isLoading: boolean;
  error?: AppError;
  /** Explicitly refresh native readiness; failures are never retried automatically. */
  refresh: () => Promise<void>;
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
  const [readiness, setReadiness] = useState<Map<string, Pick<HostConnectionState, 'readiness' | 'readinessError'>>>(new Map());
  const readinessRef = useRef(readiness);
  const statusEventsRef = useRef(new Map<string, Pick<HostConnectionState, 'readiness' | 'readinessError'>>());
  const watchEventsRef = useRef<Map<string, ResourceTracker>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<AppError>();
  const requestRef = useRef({ generation: 0 });
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
      const data = ev.data as unknown as { pluginID?: string; error?: string };
      const pluginID = data?.pluginID;
      if (!pluginID) return;
      setFailedPlugins((prev) => {
        const next = new Map(prev);
        next.set(pluginID, data.error ?? 'Crash recovery failed');
        return next;
      });
    });

    const cancelRecovered = Events.On('plugin/recovered', (ev) => {
      const data = ev.data as unknown as { pluginID?: string };
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

  // Each refresh accepts only lifecycle and watch events newer than its snapshot request.
  const loadSnapshot = useCallback(async () => {
    const request = ++requestRef.current.generation;
    statusEventsRef.current.clear();
    watchEventsRef.current.clear();
    let snapshot: Promise<Record<string, HostConnectionState[]>>;
    try {
      snapshot = GetAllConnectionStates();
    } catch (failure) {
      // Normalize synchronous transport failures into the same completion path.
      snapshot = Promise.reject(failure);
    }
    await snapshot.then((result) => {
      if (request !== requestRef.current.generation) return;
        if (!result) return;

        const conns: Record<string, Connection[]> = {};
        const statesByKey = new Map<string, Pick<HostConnectionState, 'readiness' | 'readinessError'>>();
        const newSyncs = new Map<string, ActiveSync>();

        for (const [pluginID, states] of Object.entries(result)) {
          if (!states) continue;
          conns[pluginID] = states.map((s) => s.connection);

          for (const s of states) {
            const key = JSON.stringify([pluginID, s.connection.id]);
            const state = statusEventsRef.current.get(key) ?? { readiness: s.readiness, readinessError: s.readinessError };
            statesByKey.set(key, state);
            if (state.readiness !== 'CONNECTED') continue;

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
            Object.assign(tracker.states, watchEventsRef.current.get(key)?.states);
            trackersRef.current.set(key, tracker);
            newSyncs.set(key, computeActiveSync(tracker));
          }
        }

        setAllConnections(conns);
        for (const [key, state] of statusEventsRef.current) statesByKey.set(key, state);
        readinessRef.current = statesByKey;
        setReadiness(statesByKey);
        setSyncs(newSyncs);
    }).catch((failure: unknown) => {
      if (request === requestRef.current.generation) setError(parseAppError(failure));
    }).finally(() => {
      if (request === requestRef.current.generation) setIsLoading(false);
    });
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    await loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    const requests = requestRef.current;
    loadSnapshot().catch((failure: unknown) => {
      console.error('Connection status refresh failed:', failure);
    });
    return () => { ++requests.generation; };
  }, [loadSnapshot]);

  // Listen for connection/status events
  useEffect(() => {
    let active = true;
    let metadataRequest = 0;
    const cancel = Events.On('connection/status', (ev) => {
      const event = ev.data;
      const key = JSON.stringify([event.pluginID, event.connectionID]);

      const status: NativeConnectionReadiness =
        event.status === 'DISCONNECTED' || event.status === 'PENDING' ||
        event.status === 'CONNECTED' || event.status === 'FAILED'
          ? event.status : 'UNKNOWN';
      const state = { readiness: status };
      statusEventsRef.current.set(key, state);
      const next = new Map(readinessRef.current);
      next.set(key, state);
      readinessRef.current = next;
      setReadiness(next);

      if (status !== 'CONNECTED') {
        // Clean up sync data
        setSyncs((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        trackersRef.current.delete(key);
        watchEventsRef.current.delete(key);
      }

      // Re-fetch connections to get latest metadata. Retire older event requests.
      const metadata = ++metadataRequest;
      const generation = requestRef.current.generation;
      ListAllConnections()
        .then((result) => {
          if (!active || metadata !== metadataRequest || generation !== requestRef.current.generation || !result) return;
          const filtered: Record<string, Connection[]> = {};
          for (const [k, v] of Object.entries(result)) {
            if (v != null) filtered[k] = v;
          }
          setAllConnections(filtered);
        })
        .catch((failure: unknown) => {
          if (active && metadata === metadataRequest && generation === requestRef.current.generation) {
            console.error('Connection metadata refresh failed:', failure);
          }
        });
    });

    return () => {
      active = false;
      cancel();
    };
  }, []);

  // Listen for watch/STATE events
  const handleWatchEvent = useCallback((ev: Events.WailsEvent) => {
    const event = ev.data as HostWatchStateEvent;
    const key = trackerKey(event.pluginID, event);
    // Watch activity never proves that a native client is registered.
    if (readinessRef.current.get(key)?.readiness !== 'CONNECTED') return;


    const tracker = updateTracker(trackersRef.current, event.pluginID, event);
    updateTracker(watchEventsRef.current, event.pluginID, event);
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
    await stopConnectionWithReadiness(pluginID, connectionID);
  }, []);

  const retryWatch = useCallback(async (pluginID: string, connectionID: string) => {
    if (readinessRef.current.get(JSON.stringify([pluginID, connectionID]))?.readiness !== 'CONNECTED') return;
    const route = { connection: connectionID };
    const catalog = await Catalog(pluginID, { route });
    const resolved = await Promise.all(catalog.types
      .filter((type) => type.capabilities.some((capability) => capability.operation === 'update'))
      .map((type) => ResolveTarget(pluginID, { route, type: type.type })));
    await StartConnectionWatch(pluginID, resolved.map((target) => target.target));
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

  // Keep every discovered connection visible, including unknown and stopped clients.
  const entries: ConnectionStatusEntry[] = [];
  const keys = new Set(readiness.keys());
  for (const [pluginID, connections] of Object.entries(allConnections)) {
    for (const connection of connections) keys.add(JSON.stringify([pluginID, connection.id]));
  }
  for (const key of keys) {
    const [pluginID, connectionID] = JSON.parse(key) as [string, string];
    const pluginConns = allConnections[pluginID] ?? [];
    const connMeta = pluginConns.find((c) => c.id === connectionID);
    const state: Pick<HostConnectionState, 'readiness' | 'readinessError'> = readiness.get(key) ?? { readiness: 'UNKNOWN' };
    const sync = state.readiness === 'CONNECTED' ? syncs.get(key) : undefined;
    const syncing = sync != null && !isSyncDone(sync);
    const hasErrors = sync != null && sync.errorCount > 0;
    const pluginError = failedPlugins.get(pluginID);

    entries.push({
      pluginID,
      connectionID,
      name: connMeta?.name ?? connectionID,
      avatar: connMeta?.avatar ?? '',
      readiness: state.readiness,
      readinessError: state.readinessError,
      sync,
      isSyncing: syncing,
      hasErrors: hasErrors || pluginError != null || state.readiness === 'FAILED' || state.readinessError != null,
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
  const syncArray = entries.flatMap((entry) => entry.sync ? [entry.sync] : []);
  const syncingEntries = entries.filter((e) => e.isSyncing);
  const errorEntries = entries.filter((e) => e.hasErrors);
  const failedEntries = entries.filter((e) => e.pluginFailed);

  return {
    isLoading,
    error,
    refresh,
    entries,
    grouped,
    connectedCount: entries.filter((entry) => entry.readiness === 'CONNECTED').length,
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
