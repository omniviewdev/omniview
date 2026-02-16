import { useCallback } from 'react';
import { usePluginContext, useConnection, useSnackbar } from '@omniviewdev/runtime';
import { usePluginRouter } from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';

/**
 * Shared hook that handles connect-and-navigate for a cluster connection.
 * Replaces the HubCardHandler wrapper pattern.
 */
export function useClusterAction(
  connectionId: string,
  isConnected: boolean,
  onRecordAccess: () => void,
) {
  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  const { showSnackbar } = useSnackbar();
  const { startConnection } = useConnection({
    pluginID: meta.id,
    connectionID: connectionId,
  });

  const handleClick = useCallback(() => {
    onRecordAccess();
    if (isConnected) {
      navigate(`/cluster/${encodeURIComponent(connectionId)}/resources`);
      return;
    }
    startConnection()
      .then(status => {
        if (status.status === types.ConnectionStatusCode.CONNECTED) {
          navigate(`/cluster/${encodeURIComponent(connectionId)}/resources`);
        } else {
          showSnackbar({
            status: 'warning',
            message: `Failed to connect to cluster`,
            details: status.details,
            icon: 'LuCircleAlert',
          });
        }
      })
      .catch(err => {
        if (err instanceof Error) {
          showSnackbar({ status: 'error', message: err.message, icon: 'LuCircleAlert' });
        }
      });
  }, [connectionId, isConnected, onRecordAccess, navigate, startConnection, showSnackbar]);

  return { handleClick };
}
