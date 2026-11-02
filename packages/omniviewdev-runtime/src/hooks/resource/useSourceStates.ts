import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Events } from '@wailsio/runtime';
import { GetSourceStates } from '../../resource/v2/client';
import type { AccessRoute } from '../../resource/v2/domain';
import type { HostSourceStateEvent, HostSourceStates } from '../../resource/v2/host';
import { useResolvedPluginId } from '../useResolvedPluginId';

const terminal = (state: string) => ['following', 'finished', 'failed', 'closed'].includes(state);

export const useSourceStates = ({
  pluginID: explicitPluginID, route, enabled = true,
}: { pluginID?: string; route: AccessRoute; enabled?: boolean }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const connection = route.connection;
  const queryKey = useMemo(() => [pluginID, 'resource-v2', 'source-states', { connection }], [pluginID, connection]);
  const pending = useRef<HostSourceStateEvent[]>([]);
  const loaded = useRef(false);
  const fetchingEvents = useRef<HostSourceStateEvent[] | undefined>(undefined);
  const applyEvent = useCallback((event: HostSourceStateEvent) => {
    queryClient.setQueryData<HostSourceStates>(queryKey, old => old ? {
      ...old, types: { ...old.types, [event.type]: event.status },
    } : old);
  }, [queryClient, queryKey]);
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const events: HostSourceStateEvent[] = [];
      fetchingEvents.current = events;
      try {
        const result = await GetSourceStates(pluginID, { connection });
        if (!result) throw new Error('Failed to get source states: null response');
        const types = { ...result.types };
        for (const event of events) types[event.type] = event.status;
        return { ...result, types };
      } finally {
        if (fetchingEvents.current === events) fetchingEvents.current = undefined;
      }
    },
    enabled: enabled && !!pluginID && !!connection,
    refetchInterval: query => {
      const states = Object.values(query.state.data?.types ?? {});
      return states.length > 0 && states.every(status => terminal(status.state)) ? false : 3000;
    },
  });
  useEffect(() => {
    loaded.current = false;
    pending.current = [];
    if (!enabled || !pluginID || !connection) return;
    const cancel = Events.On(`${pluginID}/${connection}/source/STATE`, event => {
      const payload = event.data as HostSourceStateEvent;
      if (payload.pluginID !== pluginID || payload.route.connection !== connection) return;
      if (loaded.current) applyEvent(payload);
      else pending.current.push(payload);
      fetchingEvents.current?.push(payload);
    });
    return () => { cancel(); loaded.current = false; pending.current = []; };
  }, [pluginID, connection, enabled, applyEvent]);
  useEffect(() => {
    if (!query.data || loaded.current) return;
    loaded.current = true;
    const events = pending.current;
    pending.current = [];
    for (const event of events) applyEvent(event);
  }, [query.data, applyEvent]);
  const states = Object.values(query.data?.types ?? {});
  const done = states.filter(status => terminal(status.state)).length;
  return {
    summary: query.data,
    getTypeStatus: (type: string) => query.data?.types[type],
    isFullySynced: states.length > 0 && done === states.length,
    syncProgress: states.length ? done / states.length : 0,
    errorCount: states.filter(status => status.state === 'failed').length,
  };
};
