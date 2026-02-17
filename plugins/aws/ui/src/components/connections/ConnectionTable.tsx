import React from 'react';
import Box from '@mui/joy/Box';
import {
  usePluginContext,
  useConnection,
  useSnackbar,
} from '@omniviewdev/runtime';
import { usePluginRouter } from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';
import type { EnrichedConnection } from '../../types/accounts';
import ConnectionCard from './ConnectionCard';
import SSOLoginDialog from './SSOLoginDialog';

type Props = {
  connections: EnrichedConnection[];
  onToggleFavorite: (connectionId: string) => void;
  onRecordAccess: (connectionId: string) => void;
};

const GridCardWrapper: React.FC<{
  enriched: EnrichedConnection;
  onToggleFavorite: () => void;
  onRecordAccess: () => void;
}> = ({ enriched, onToggleFavorite, onRecordAccess }) => {
  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  const { showSnackbar } = useSnackbar();
  const { startConnection, stopConnection } = useConnection({
    pluginID: meta.id,
    connectionID: enriched.connection.id,
  });

  const [ssoDialogOpen, setSSODialogOpen] = React.useState(false);
  const [ssoData, setSSOData] = React.useState<{
    verificationURL: string;
    userCode: string;
    expiresAt: string;
  } | null>(null);
  const [isRetrying, setIsRetrying] = React.useState(false);

  const handleSSOResponse = (status: types.ConnectionStatus) => {
    const data = status.connection?.data;
    if (
      data?.sso_verification_uri_complete &&
      data?.sso_user_code &&
      (status.status === types.ConnectionStatusCode.UNAUTHORIZED ||
        status.status === types.ConnectionStatusCode.PENDING)
    ) {
      setSSOData({
        verificationURL: data.sso_verification_uri_complete as string,
        userCode: data.sso_user_code as string,
        expiresAt: (data.sso_device_auth_expires_at as string) || '',
      });
      setSSODialogOpen(true);
      return true;
    }
    return false;
  };

  const handleClick = () => {
    onRecordAccess();
    if (enriched.isConnected) {
      navigate(`/account/${encodeURIComponent(enriched.connection.id)}/resources`);
      return;
    }
    startConnection()
      .then(status => {
        console.log('startConnection result:', status);
        if (status.status === types.ConnectionStatusCode.CONNECTED) {
          navigate(`/account/${encodeURIComponent(enriched.connection.id)}/resources`);
        } else if (!handleSSOResponse(status)) {
          showSnackbar({
            status: 'error',
            message: status.details || status.error || `Connection failed (${status.status})`,
            icon: 'LuCircleAlert',
          });
        }
      })
      .catch(err => {
        console.error('startConnection error:', err);
        const message = err instanceof Error ? err.message : String(err);
        showSnackbar({ status: 'error', message, icon: 'LuCircleAlert' });
      });
  };

  const handleSSORetry = () => {
    setIsRetrying(true);
    startConnection()
      .then(status => {
        if (status.status === types.ConnectionStatusCode.CONNECTED) {
          setSSODialogOpen(false);
          setSSOData(null);
          navigate(`/account/${encodeURIComponent(enriched.connection.id)}/resources`);
        } else if (status.status === types.ConnectionStatusCode.PENDING) {
          // Still waiting — keep dialog open, update data in case it changed
          handleSSOResponse(status);
          showSnackbar({
            status: 'warning',
            message: 'Authorization still pending. Complete the login in your browser.',
            icon: 'LuCircleAlert',
          });
        } else if (!handleSSOResponse(status)) {
          showSnackbar({
            status: 'error',
            message: status.details || status.error || 'SSO login failed',
            icon: 'LuCircleAlert',
          });
        }
      })
      .catch(err => {
        const message = err instanceof Error ? err.message : String(err);
        showSnackbar({ status: 'error', message, icon: 'LuCircleAlert' });
      })
      .finally(() => setIsRetrying(false));
  };

  const handleSSODialogClose = () => {
    setSSODialogOpen(false);
    setSSOData(null);
  };

  const handleConnect = () => {
    onRecordAccess();
    startConnection()
      .then(status => {
        if (!handleSSOResponse(status) && status.status !== types.ConnectionStatusCode.CONNECTED) {
          showSnackbar({
            status: 'error',
            message: status.details || status.error || 'Connection failed',
            icon: 'LuCircleAlert',
          });
        }
      })
      .catch(err => {
        const message = err instanceof Error ? err.message : String(err);
        showSnackbar({ status: 'error', message, icon: 'LuCircleAlert' });
      });
  };

  const handleDisconnect = () => {
    stopConnection().catch(err => {
      const message = err instanceof Error ? err.message : String(err);
      showSnackbar({ status: 'error', message, icon: 'LuCircleAlert' });
    });
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(enriched.connection.id);
    showSnackbar({ status: 'success', message: 'Connection ID copied' });
  };

  return (
    <>
      <ConnectionCard
        enriched={enriched}
        onClick={handleClick}
        onToggleFavorite={onToggleFavorite}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onCopyId={handleCopyId}
      />
      {ssoData && (
        <SSOLoginDialog
          open={ssoDialogOpen}
          onClose={handleSSODialogClose}
          verificationURL={ssoData.verificationURL}
          userCode={ssoData.userCode}
          expiresAt={ssoData.expiresAt}
          onRetry={handleSSORetry}
          isRetrying={isRetrying}
        />
      )}
    </>
  );
};

const ConnectionTable: React.FC<Props> = ({
  connections,
  onToggleFavorite,
  onRecordAccess,
}) => {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 1.5,
      }}
    >
      {connections.map(enriched => (
        <GridCardWrapper
          key={enriched.connection.id}
          enriched={enriched}
          onToggleFavorite={() => onToggleFavorite(enriched.connection.id)}
          onRecordAccess={() => onRecordAccess(enriched.connection.id)}
        />
      ))}
    </Box>
  );
};

export default ConnectionTable;
