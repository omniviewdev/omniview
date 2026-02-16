import React from 'react';
import { Card, CardContent, Stack, Typography, Avatar } from '@mui/joy';
import type { EnrichedConnection } from '../../types/clusters';
import type { ConnectionGroup } from '../../types/clusters';
import FavoriteButton from './FavoriteButton';
import ProviderIcon from './ProviderIcon';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import ConnectionContextMenu from './ConnectionContextMenu';
import NamedAvatar from '../shared/NamedAvatar';

type Props = {
  enriched: EnrichedConnection;
  customGroups: ConnectionGroup[];
  onClick: () => void;
  onToggleFavorite: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onAssignToGroup: (groupId: string) => void;
  onRemoveFromGroup?: (groupId: string) => void;
  onCreateFolder?: (connectionId: string) => void;
  onCopyId: () => void;
  onDelete: () => void;
};

const ConnectionCard: React.FC<Props> = ({
  enriched,
  customGroups,
  onClick,
  onToggleFavorite,
  onConnect,
  onDisconnect,
  onAssignToGroup,
  onRemoveFromGroup,
  onCreateFolder,
  onCopyId,
  onDelete,
}) => {
  const { connection, provider, isFavorite, isConnected, displayName, displayDescription } = enriched;

  return (
    <Card
      variant='outlined'
      sx={{
        cursor: 'pointer',
        '&:hover': { borderColor: 'primary.outlinedHoverBorder', boxShadow: 'sm' },
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onClick={onClick}
    >
      <CardContent>
        <Stack gap={1.5}>
          {/* Header row */}
          <Stack direction='row' alignItems='center' gap={1}>
            <ConnectionStatusBadge isConnected={isConnected}>
              {enriched.avatar ? (
                <Avatar
                  size='sm'
                  src={enriched.avatar}
                  sx={{ borderRadius: 6, backgroundColor: 'transparent', maxHeight: 28, maxWidth: 28 }}
                />
              ) : (
                <NamedAvatar value={displayName} color={enriched.avatarColor} />
              )}
            </ConnectionStatusBadge>
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Typography level='title-sm' noWrap>{displayName}</Typography>
              {displayDescription && (
                <Typography level='body-xs' noWrap sx={{ opacity: 0.7 }}>
                  {displayDescription}
                </Typography>
              )}
            </Stack>
            <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
          </Stack>

          {/* Details */}
          <Stack gap={0.5}>
            <Stack direction='row' alignItems='center' gap={0.75}>
              <ProviderIcon provider={provider} size={14} />
              <Typography level='body-xs'>{String(connection.labels?.cluster ?? '')}</Typography>
            </Stack>
            {connection.labels?.kubeconfig && (
              <Typography level='body-xs' noWrap sx={{ opacity: 0.6 }}>
                {String(connection.labels.kubeconfig)}
              </Typography>
            )}
            {connection.labels?.user && (
              <Typography level='body-xs' sx={{ opacity: 0.6 }}>
                {String(connection.labels.user)}
              </Typography>
            )}
          </Stack>

          {/* Footer */}
          <Stack direction='row' justifyContent='flex-end' onClick={e => e.stopPropagation()}>
            <ConnectionContextMenu
              connectionId={connection.id}
              connectionName={displayName}
              isConnected={isConnected}
              isFavorite={isFavorite}
              customGroups={customGroups}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onToggleFavorite={onToggleFavorite}
              onAssignToGroup={onAssignToGroup}
              onRemoveFromGroup={onRemoveFromGroup}
              onCreateFolder={onCreateFolder}
              onCopyId={onCopyId}
              onDelete={onDelete}
            />
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ConnectionCard;
