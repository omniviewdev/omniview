import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GetWatchState} from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper';
import { Events } from '@wailsio/runtime';
import { useResolvedPluginId } from '../useResolvedPluginId';
import type {
  WatchConnectionSummary,
  WatchStateEvent,
} from '../../types/watch';
import { WatchState } from '../../types/watch';

type UseWatchStateOptions = {
  pluginID?: string;
  connectionID: string;
  enabled?: boolean;
};

/**
 * useWatchState provides real-time watch state for a connection.
 * It fetches the initial summary via Wails binding and subscribes to
 * state change events for live updates.
 *
 * Events that arrive before the initial fetch completes are buffered
 * and replayed once the query cache is populated, preventing the race
 * condition where early SYNCED events are silently dropped.
 */
export const useWatchState = ({
  pluginID: explicitPluginID,
  connectionID,
  enabled = true,
}: UseWatchStateOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const queryKey = [pluginID, connectionID, 'watch-state'];

  // Buffer for events arriving before the initial query completes.
  const pendingEventsRef = useRef<WatchStateEvent[]>([]);
  const dataLoadedRef = useRef(false);

  // Shared apply logic used by both buffer replay and live event path.
  const applyEvent = useCallback((event: WatchStateEvent) => {
    queryClient.setQueryData<WatchConnectionSummary>(queryKey, (old) => {
      if (!old) return old;

      const resources = { ...old.resources, [event.resourceKey]: event.state };
      const resourceCounts = { ...old.resourceCounts, [event.resourceKey]: event.resourceCount };

      // Recompute aggregates
      let synced = 0;
      let errors = 0;
      for (const state of Object.values(resources)) {
        if (state === WatchState.WatchStateSynced) synced++;
        if (state === WatchState.WatchStateError || state === WatchState.WatchStateFailed) errors++;
      }

      return { ...old, resources, resourceCounts, syncedCount: synced, errorCount: errors };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, pluginID, connectionID]);

  const summaryQuery = useQuery<WatchConnectionSummary>({
    queryKey,
    queryFn: async () => {
      const result = await GetWatchState(pluginID, connectionID);
      if (!result) throw new Error('Failed to get watch state: null response');
      const resources: Record<string, WatchState> = {};
      let syncedCount = 0;
      let errorCount = 0;

      for (const [key, state] of Object.entries(result.resources ?? {})) {
        if (state == null) continue;
        resources[key] = state as WatchState;
        if (state === WatchState.WatchStateSynced) syncedCount++;
        if (state === WatchState.WatchStateError) errorCount++;
      }

      const resourceCounts: Record<string, number> = {};
      for (const [key, count] of Object.entries(result.resourceCounts ?? {})) {
        if (count == null) continue;
        resourceCounts[key] = count;
      }

      return {
        connection: result.connectionId,
        resources,
        resourceCounts,
        totalResources: Object.keys(resources).length,
        syncedCount,
        errorCount,
      };
    },
    enabled: enabled && !!pluginID && !!connectionID,
    refetchInterval: (query) => {
      // Poll every 3s while not all resources have reached a terminal state.
      // Once fully synced (or all terminal), stop polling.
      const data = query.state.data;
      if (!data || data.totalResources === 0) return 3000;
      let terminalCount = 0;
      for (const state of Object.values(data.resources)) {
        if (
          state === WatchState.WatchStateSynced ||
          state === WatchState.WatchStateError ||
          state === WatchState.WatchStateStopped ||
          state === WatchState.WatchStateFailed ||
          state === WatchState.WatchStateForbidden ||
          state === WatchState.WatchStateSkipped
        ) {
          terminalCount++;
        }
      }
      return terminalCount >= data.totalResources ? false : 3000;
    },
  });

  // Replay buffered events once React Query has committed data to cache.
  // useEffect fires after render, guaranteeing summaryQuery.data is in the
  // cache before we call applyEvent (which uses setQueryData updater).
  useEffect(() => {
    if (!summaryQuery.data || dataLoadedRef.current) return;

    dataLoadedRef.current = true;
    const buffered = pendingEventsRef.current;
    pendingEventsRef.current = [];
    for (const evt of buffered) {
      applyEvent(evt);
    }
  }, [summaryQuery.data, applyEvent]);

  useEffect(() => {
    if (!enabled || !pluginID || !connectionID) {
      return;
    }

    // Reset on key change.
    dataLoadedRef.current = false;
    pendingEventsRef.current = [];

    const cancel = Events.On(
      `${pluginID}/${connectionID}/watch/STATE`,
      (ev) => {
        const event = ev.data as WatchStateEvent;
        if (!dataLoadedRef.current) {
          pendingEventsRef.current.push(event);
        } else {
          applyEvent(event);
        }
      },
    );

    return () => {
      cancel();
      dataLoadedRef.current = false;
      pendingEventsRef.current = [];
    };
  }, [pluginID, connectionID, enabled, applyEvent]);

  const data = summaryQuery.data;

  // Count terminal states for progress
  let terminalCount = 0;
  if (data?.resources) {
    for (const state of Object.values(data.resources)) {
      if (
        state === WatchState.WatchStateSynced ||
        state === WatchState.WatchStateError ||
        state === WatchState.WatchStateStopped ||
        state === WatchState.WatchStateFailed ||
        state === WatchState.WatchStateForbidden ||
        state === WatchState.WatchStateSkipped
      ) {
        terminalCount++;
      }
    }
  }

  return {
    /** Full summary query result */
    summary: summaryQuery,

    /** Get the state of a specific resource type's watch */
    getResourceState: (key: string): WatchState | undefined =>
      data?.resources[key],

    /** Whether all registered watches have reached a terminal state */
    isFullySynced: data
      ? data.totalResources > 0 && terminalCount === data.totalResources
      : false,

    /** Sync progress as a 0-1 fraction (terminal states / total) */
    syncProgress: data && data.totalResources > 0
      ? terminalCount / data.totalResources
      : 0,

    /** Number of watches that encountered errors */
    errorCount: data?.errorCount ?? 0,
  };
};
