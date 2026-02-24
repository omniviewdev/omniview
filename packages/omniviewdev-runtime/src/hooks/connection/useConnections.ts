import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ListConnections, StartConnectionInformer, StopConnectionInformer } from '../../wailsjs/go/resource/Client';
import { type types } from '../../wailsjs/go/models';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';
import { createErrorHandler } from '../../errors/parseAppError';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import React from 'react';

type UseConnectionsOptions = {
  /**
  * The name of the plugin we're interacting with
  */
  plugin: string;
};

/** Stable query key factory for connection list queries. */
export const connectionListQueryKey = (plugin: string) => [plugin, 'connection', 'list'];

/**
* Get and retreive connections from a plugin's connection manager..
 */
export const useConnections = ({ plugin }: UseConnectionsOptions) => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const queryKey = connectionListQueryKey(plugin);

  // === Mutations === //
  const { mutateAsync: startInformer } = useMutation({
    mutationFn: async (conn: types.Connection) => StartConnectionInformer(plugin, conn.id),
    onError: createErrorHandler(showSnackbar, 'Failed to start connection informer'),
  });

  const { mutateAsync: stopInformer } = useMutation({
    mutationFn: async (conn: types.Connection) => StopConnectionInformer(plugin, conn.id),
    onError: createErrorHandler(showSnackbar, 'Failed to stop connection informer'),
  });

  /**
   * Handle sync of connections from the backend
   */
  const onConnectionSync = React.useCallback((connections: types.Connection[]) => {
    console.log("got update to connections", connections)
    queryClient.setQueryData(queryKey, connections)
  }, []);

  // *Only on mount*, we want subscribe to new resources, updates and deletes
  React.useEffect(() => {
    const syncCloser = EventsOn(`${plugin}/connection/sync`, onConnectionSync);

    return () => {
      syncCloser()
    };
  }, []);

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
    startInformer,
    stopInformer,
  };
};
