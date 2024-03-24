import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GetConnection, UpdateConnection, RemoveConnection } from '@api/resource/Client';
import { type types } from '@api/models';
import { useSnackbar } from '@/providers/SnackbarProvider';

type UseConnectionOptions = {
  /**
   * The name of the plugin we're interacting with
   */
  pluginID: string;

  /**
   * The ID of the connection
   */
  connectionID: string;
};

/**
 * Get and retreive connections from a plugin's connection manager..
 */
export const useConnection = ({ pluginID, connectionID }: UseConnectionOptions) => {
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const queryKey = [pluginID, 'connection', 'detail', connectionID];

  // === Mutations === //
  const { mutateAsync: updateConnection } = useMutation({
    mutationFn: async (conn: types.Connection) => UpdateConnection(pluginID, conn),
    onSuccess(data, { name }) {
      showSnackbar(`Connection ${name} sucessfully updated`, 'success');
      // Update the list and detail
      queryClient.setQueryData(queryKey, connection);
      queryClient.setQueriesData(
        { queryKey: [pluginID, 'connection', 'list'] },
        (previous: types.Connection[] | undefined) => previous?.map(conn => conn.id === connectionID ? data : conn),
      );
    },
    onError(error) {
      showSnackbar(`Failed to update connection: ${error}`, 'error');
    },
  });

  const { mutateAsync: deleteConnection } = useMutation({
    mutationFn: async () => RemoveConnection(pluginID, connectionID),
    onSuccess() {
      showSnackbar('Connection successfully removed', 'success');

      queryClient.setQueryData(queryKey, undefined);
      queryClient.setQueriesData(
        { queryKey: [pluginID, 'connection', 'list'] },
        (previous: types.Connection[] | undefined) => previous?.filter(conn => conn.id !== connectionID),
      );
    },
    onError(error) {
      showSnackbar(`Failed to remove connection: ${error}`, 'error');
    },
  });

  // === Queries === //

  const connection = useQuery({
    queryKey,
    queryFn: async () => GetConnection(pluginID, connectionID),
  });

  return {
    /**
     * Get the connection
     */
    connection,

    /**
     * Update the connection.
     */
    updateConnection,

    /**
     * Delete the connection
     */
    deleteConnection,
  };
};
