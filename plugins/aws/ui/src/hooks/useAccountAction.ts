import { useCallback } from 'react';
import { usePluginContext, useConnection, useNotifications } from '@omniviewdev/runtime';
import { usePluginRouter } from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';

export function useAccountAction(
  connectionId: string,
  isConnected: boolean,
  onRecordAccess: () => void,
) {
  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  const { notify } = useNotifications();
  const { startConnection } = useConnection({
    pluginID: meta.id,
    connectionID: connectionId,
  });

  const handleClick = useCallback(() => {
    onRecordAccess();
    if (isConnected) {
      navigate(`/account/${encodeURIComponent(connectionId)}/resources`);
      return;
    }
    startConnection()
      .then((status) => {
        if (status.status === types.ConnectionStatusCode.CONNECTED) {
          navigate(`/account/${encodeURIComponent(connectionId)}/resources`);
        } else {
          void notify({
            severity: 'warning',
            title: 'Failed to connect to AWS account',
            details: status.details,
          });
        }
      })
      .catch((err) => {
        if (err instanceof Error) {
          void notify({ severity: 'error', title: err.message });
        }
      });
  }, [connectionId, isConnected, onRecordAccess, navigate, startConnection, notify]);

  return { handleClick };
}
