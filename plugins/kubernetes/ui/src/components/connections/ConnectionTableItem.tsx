import React from 'react';
import { usePluginRouter } from '@omniviewdev/runtime';

import { Avatar, Chip } from '@omniviewdev/ui';
import { Text } from '@omniviewdev/ui/typography';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

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

const tdSx: React.CSSProperties = {
  padding: '3px 8px',
  verticalAlign: 'middle',
  borderBottom: '1px solid var(--ov-border-default, rgba(255,255,255,0.06))',
};

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
  const { id, labels } = connection;

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
    <tr
      id={`connection-${id}`}
      style={{ cursor: 'pointer' }}
      onMouseOver={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--ov-bg-surface-hover, rgba(255,255,255,0.04))'; }}
      onMouseOut={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}
    >
      {/* Favorite */}
      <td style={{ ...tdSx, width: 32, padding: '3px 4px', textAlign: 'center' }}>
        <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
      </td>

      {/* Name */}
      <td
        onClick={handleClick}
        style={{ ...tdSx }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <ConnectionStatusBadge isConnected={isConnected}>
            {enriched.avatar
              ? <Avatar size='sm' src={enriched.avatar} />
              : <NamedAvatar value={displayName} color={enriched.avatarColor} />
            }
          </ConnectionStatusBadge>
          <ProviderIcon provider={provider} size={14} />
          <Text weight='semibold' size='sm' noWrap>{displayName}</Text>
          {Boolean(displayDescription) && (
            <Text size='xs' noWrap sx={{ color: 'var(--ov-fg-faint)', flexShrink: 1, minWidth: 0 }}>
              {displayDescription}
            </Text>
          )}
          {enriched.tags.length > 0 && enriched.tags.map(tag => (
            <Chip key={tag} size='xs' emphasis='soft' color='warning' label={tag} />
          ))}
          {connecting && <CircularProgress size={14} />}
        </Box>
      </td>

      {/* Visible label columns */}
      {visibleColumns.map(col => (
        <td key={`${id}-${col}`} onClick={handleClick} style={{ ...tdSx }}>
          {labels?.[col] ? (
            <Text size='xs' noWrap sx={{ color: 'var(--ov-fg-muted)' }}>
              {truncate(String(labels[col]))}
            </Text>
          ) : null}
        </td>
      ))}

      {/* Actions */}
      <td onClick={e => e.stopPropagation()} style={{ ...tdSx, width: 36, textAlign: 'center' }}>
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
