import React from 'react';
import { Card, CardContent, Stack, Typography, Avatar } from '@mui/joy';
import type { EnrichedConnection } from '../../types/accounts';
import FavoriteButton from './FavoriteButton';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import ConnectionContextMenu from './ConnectionContextMenu';
import NamedAvatar from '../shared/NamedAvatar';

type Props = {
  enriched: EnrichedConnection;
  onClick: () => void;
  onToggleFavorite: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onCopyId: () => void;
};

const ConnectionCard: React.FC<Props> = ({
  enriched,
  onClick,
  onToggleFavorite,
  onConnect,
  onDisconnect,
  onCopyId,
}) => {
  const { connection, isFavorite, isConnected, displayName, displayDescription } = enriched;

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
          <Stack direction='row' alignItems='center' gap={1}>
            <ConnectionStatusBadge isConnected={isConnected}>
              {connection.avatar ? (
                <Avatar
                  size='sm'
                  src={connection.avatar}
                  sx={{ borderRadius: 6, backgroundColor: 'transparent', maxHeight: 28, maxWidth: 28 }}
                />
              ) : (
                <NamedAvatar value={connection.name} />
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

          <Stack gap={0.5}>
            {connection.labels?.region && (
              <Typography level='body-xs' sx={{ opacity: 0.6 }}>
                Region: {String(connection.labels.region)}
              </Typography>
            )}
            {connection.labels?.profile && (
              <Typography level='body-xs' noWrap sx={{ opacity: 0.6 }}>
                Profile: {String(connection.labels.profile)}
              </Typography>
            )}
          </Stack>

          <Stack direction='row' justifyContent='flex-end' onClick={e => e.stopPropagation()}>
            <ConnectionContextMenu
              connectionId={connection.id}
              connectionName={displayName}
              isConnected={isConnected}
              isFavorite={isFavorite}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onToggleFavorite={onToggleFavorite}
              onCopyId={onCopyId}
            />
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default ConnectionCard;
