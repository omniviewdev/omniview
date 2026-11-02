import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ListConnections } from '../../resource/v2/client';
import type { Connection } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { createErrorHandler } from '../../errors/parseAppError';
import { Events } from '@wailsio/runtime';
import React from 'react';
import { useResolvedPluginId } from '../useResolvedPluginId';

type UseConnectionsOptions = {
  /**
  * The name of the plugin we're interacting with
  */
  plugin?: string;
};

/** Stable query key factory for connection list queries. */
export const connectionListQueryKey = (plugin: string) => [plugin, 'connection', 'list'];

/**
* Get and retreive connections from a plugin's connection manager..
 */
export const useConnections = ({ plugin: explicitPlugin }: UseConnectionsOptions) => {
  const plugin = useResolvedPluginId(explicitPlugin);
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const queryKey = connectionListQueryKey(plugin);


  /**
   * Handle sync of connections from the backend
   */
  const onConnectionSync = React.useCallback((ev: Events.WailsEvent) => {
    const connections = ev.data as Connection[];
    console.log("got update to connections", connections)
    queryClient.setQueryData(queryKey, connections)
  }, [queryClient, queryKey]);

  // Subscribe to connection sync events from the backend.
  React.useEffect(() => {
    const syncCloser = Events.On(`${plugin}/connection/sync`, onConnectionSync);

    return () => {
      syncCloser()
    };
  }, [plugin, onConnectionSync]);

  // === Queries === //

  const connections = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const result = await ListConnections(plugin)
        return result
      } catch (error) {
        console.log(error)
        createErrorHandler(showSnackbar, 'Failed to load connections')(error);
      }

      return []
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  return {
    connections,
  };
};
