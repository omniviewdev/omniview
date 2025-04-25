import { useMutation, useQuery } from '@tanstack/react-query';
import { LoadConnections, StartConnectionInformer, StopConnectionInformer } from '../../wailsjs/go/resource/Client';
import { type types } from '../../wailsjs/go/models';
import { useSnackbar } from '../../hooks/snackbar/useSnackbar';

type UseConnectionsOptions = {
  /**
  * The name of the plugin we're interacting with
  */
  plugin: string;
};

/**
* Get and retreive connections from a plugin's connection manager..
 */
export const useConnections = ({ plugin }: UseConnectionsOptions) => {
  // Const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();

  const queryKey = [plugin, 'connection', 'list'];

  // === Mutations === //
  const { mutateAsync: startInformer } = useMutation({
    mutationFn: async (conn: types.Connection) => StartConnectionInformer(plugin, conn.id),
    onError(error) {
      showSnackbar({
        message: 'Failed to start connection informer',
        status: 'error',
        details: `${error.message}`,
      });
    },
  });

  const { mutateAsync: stopInformer } = useMutation({
    mutationFn: async (conn: types.Connection) => StopConnectionInformer(plugin, conn.id),
    onError(error) {
      showSnackbar({
        message: 'Failed to stop connection informer',
        status: 'error',
        details: `${error.message}`,
      });
    },
  });

  // === Queries === //

  const connections = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const result = await LoadConnections(plugin)
        return result
      } catch (error) {
        // log the error
        if (error instanceof Error) {
          showSnackbar({
            message: 'Failed to stop connection informer',
            status: 'error',
            details: `${error.message}`,
          });
        }
      }

      return []
    }
  });

  return {
    connections,
    startInformer,
    stopInformer,
  };
};
