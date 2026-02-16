import React from 'react';
import { usePluginRouter } from '@omniviewdev/runtime';

import {
  Avatar,
  Chip,
  CircularProgress,
  Typography,
} from '@mui/joy';

import {
  usePluginContext,
  useConnection,
  useSnackbar,
} from '@omniviewdev/runtime';
import { types } from '@omniviewdev/runtime/models';

import type { EnrichedConnection, ConnectionGroup } from '../../types/clusters';
import FavoriteButton from './FavoriteButton';
import ProviderIcon from './ProviderIcon';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import ConnectionContextMenu from './ConnectionContextMenu';
import NamedAvatar from '../shared/NamedAvatar';

type Props = {
  enriched: EnrichedConnection;
  visibleColumns: string[];
  customGroups: ConnectionGroup[];
  onToggleFavorite: () => void;
  onAssignToGroup: (groupId: string) => void;
  onRemoveFromGroup?: (groupId: string) => void;
  onCreateFolder?: (connectionId: string) => void;
  onDelete: () => void;
  onRecordAccess: () => void;
};

const truncate = (input: string) => input.length > 60 ? `${input.substring(0, 60)}...` : input;

const ConnectionTableItem: React.FC<Props> = ({
  enriched,
  visibleColumns,
  customGroups,
  onToggleFavorite,
  onAssignToGroup,
  onRemoveFromGroup,
  onCreateFolder,
  onDelete,
  onRecordAccess,
}) => {
  const { connection, provider, isFavorite, isConnected, displayName, displayDescription } = enriched;
  const { id, avatar, labels } = connection;

  const { meta } = usePluginContext();
  const { navigate } = usePluginRouter();
  const { showSnackbar } = useSnackbar();
  const { startConnection, stopConnection } = useConnection({ pluginID: meta.id, connectionID: id });
  const [connecting, setConnecting] = React.useState(false);

  const handleConnectionStatus = (status: types.ConnectionStatus) => {
    switch (status.status) {
      case types.ConnectionStatusCode.UNAUTHORIZED:
        showSnackbar({
          status: 'warning',
          message: `Failed to authorize to '${displayName}'`,
          details: status.details,
          icon: 'LuShieldClose',
        });
        break;
      case types.ConnectionStatusCode.CONNECTED:
        showSnackbar({
          status: 'success',
          message: `Connected to '${displayName}'`,
          icon: 'LuCheckCircle',
        });
        navigate(`/cluster/${encodeURIComponent(id)}/resources`);
        break;
      default:
        showSnackbar({
          status: 'error',
          message: `Failed to connect to '${displayName}'`,
          details: status.details,
          icon: 'LuCircleAlert',
        });
    }
  };

  const handleClick = () => {
    onRecordAccess();
    if (isConnected) {
      navigate(`/cluster/${encodeURIComponent(id)}/resources`);
      return;
    }
    setConnecting(true);
    startConnection()
      .then(status => handleConnectionStatus(status))
      .catch(err => {
        if (err instanceof Error) {
          showSnackbar({
            status: 'error',
            message: err.message,
            icon: 'LuCircleAlert',
          });
        }
      })
      .finally(() => setConnecting(false));
  };

  const handleConnect = () => {
    onRecordAccess();
    setConnecting(true);
    startConnection()
      .then(status => handleConnectionStatus(status))
      .catch(err => {
        if (err instanceof Error) {
          showSnackbar({ status: 'error', message: err.message, icon: 'LuCircleAlert' });
        }
      })
      .finally(() => setConnecting(false));
  };

  const handleDisconnect = () => {
    stopConnection().catch(err => {
      if (err instanceof Error) {
        showSnackbar({ status: 'error', message: err.message, icon: 'LuCircleAlert' });
      }
    });
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(id);
    showSnackbar({ status: 'success', message: 'Connection ID copied' });
  };

  return (
    <tr id={`connection-${id}`} style={{ cursor: 'pointer' }}>
      {/* Favorite */}
      <td style={{ width: 40, textAlign: 'center' }}>
        <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
      </td>

      {/* Name */}
      <td
        onClick={handleClick}
        style={{ display: 'flex', flex: 1, gap: 10, justifyContent: 'flex-start', alignItems: 'center' }}
      >
        <ConnectionStatusBadge isConnected={isConnected}>
          {avatar
            ? <Avatar
              size='sm'
              src={avatar}
              sx={{ borderRadius: 6, backgroundColor: 'transparent', maxHeight: 28, maxWidth: 28 }}
            />
            : <NamedAvatar value={connection.name} />
          }
        </ConnectionStatusBadge>
        <ProviderIcon provider={provider} size={16} />
        <Typography level='title-sm' noWrap>{displayName}</Typography>
        {Boolean(displayDescription) && <Typography level='body-sm' noWrap sx={{ opacity: 0.7 }}>{displayDescription}</Typography>}
        {enriched.tags.length > 0 && enriched.tags.map(tag => (
          <Chip key={tag} size='sm' variant='soft' color='warning' sx={{ fontSize: '0.65rem' }}>
            {tag}
          </Chip>
        ))}
        {connecting && <CircularProgress size='sm' />}
      </td>

      {/* Visible label columns only */}
      {visibleColumns.map(col => (
        <td key={`${id}-${col}`} onClick={handleClick}>
          <Chip
            variant='outlined'
            color='neutral'
            size='sm'
            sx={{ pointerEvents: 'none', borderRadius: 'sm' }}
          >
            {truncate(String(labels?.[col] ?? ''))}
          </Chip>
        </td>
      ))}

      {/* Actions */}
      <td onClick={e => e.stopPropagation()}>
        <ConnectionContextMenu
          connectionId={id}
          connectionName={displayName}
          isConnected={isConnected}
          isFavorite={isFavorite}
          customGroups={customGroups}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onToggleFavorite={onToggleFavorite}
          onAssignToGroup={onAssignToGroup}
          onRemoveFromGroup={onRemoveFromGroup}
          onCreateFolder={onCreateFolder}
          onCopyId={handleCopyId}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
};

export default ConnectionTableItem;
