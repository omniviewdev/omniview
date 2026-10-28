import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GetWatchState } from '../../resource/v2/client';
import type { AccessRoute } from '../../resource/v2/domain';
import { Events } from '@wailsio/runtime';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { WatchState, type WatchConnectionSummary, type WatchStateEvent } from '../../types/watch';

export interface WatchSummary extends WatchConnectionSummary {
  totalResources: number;
  syncedCount: number;
  errorCount: number;
}

function summarize(summary: WatchConnectionSummary): WatchSummary {
  const states = Object.values(summary.resources);
  return {
    ...summary,
    totalResources: states.length,
    syncedCount: states.filter((state) => state === WatchState.WatchStateSynced).length,
    errorCount: states.filter((state) => state === WatchState.WatchStateError || state === WatchState.WatchStateFailed).length,
  };
}

/** Advisory native cache readiness, never proof of snapshot/update continuity. */
export const useWatchState = ({
  pluginID: explicitPluginID, route, enabled = true,
}: { pluginID?: string; route: AccessRoute; enabled?: boolean }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const connection = route.connection;
  const queryKey = useMemo(() => [pluginID, 'resource-v2', 'watch-state', { connection }], [pluginID, connection]);
  const pending = useRef<WatchStateEvent[]>([]);
  const loaded = useRef(false);
  const applyEvent = useCallback((event: WatchStateEvent) => {
    queryClient.setQueryData<WatchSummary>(queryKey, (old) => old ? summarize({
      ...old,
      resources: { ...old.resources, [event.type]: event.state },
      resourceCounts: { ...old.resourceCounts, [event.type]: event.count },
    }) : old);
  }, [queryClient, queryKey]);
  const summary = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await GetWatchState(pluginID, { connection });
      if (!result) throw new Error('Failed to get watch state: null response');
      return summarize(result);
    },
    enabled: enabled && !!pluginID && !!connection,
    refetchInterval: (query) => {
      const states = Object.values(query.state.data?.resources ?? {});
      return states.length && states.every((state) => state !== WatchState.WatchStateIdle && state !== WatchState.WatchStateSyncing) ? false : 3000;
    },
  });
  useEffect(() => {
    loaded.current = false;
    pending.current = [];
    if (!enabled || !connection) return;
    const cancel = Events.On(`${pluginID}/${connection}/watch/STATE`, (event) => {
      const payload = event.data as WatchStateEvent;
      if (payload.route.connection !== connection) return;
      if (loaded.current) applyEvent(payload);
      else pending.current.push(payload);
    });
    return () => { cancel(); loaded.current = false; pending.current = []; };
  }, [pluginID, connection, enabled, applyEvent]);
  useEffect(() => {
    if (!summary.data || loaded.current) return;
    loaded.current = true;
    const events = pending.current;
    pending.current = [];
    for (const event of events) applyEvent(event);
  }, [summary.data, applyEvent]);
  const states = Object.values(summary.data?.resources ?? {});
  const terminalCount = states.filter((state) => state !== WatchState.WatchStateIdle && state !== WatchState.WatchStateSyncing).length;
  return {
    summary,
    getResourceState: (type: string) => summary.data?.resources[type],
    /** Retained UI readiness name; this does not claim source continuity. */
    isFullySynced: states.length > 0 && terminalCount === states.length,
    syncProgress: states.length ? terminalCount / states.length : 0,
    errorCount: summary.data?.errorCount ?? 0,
    guarantee: 'bestEffort' as const,
  };
};
