import React from 'react';
import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Card, Avatar } from '@omniviewdev/ui';
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
        '&:hover': { borderColor: 'primary.main', boxShadow: 1 },
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onClick={onClick}
    >
      <Box sx={{ p: 1.5 }}>
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
              <Text weight="semibold" size="sm" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</Text>
              {displayDescription && (
                <Text size="xs" sx={{ opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {displayDescription}
                </Text>
              )}
            </Stack>
            <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
          </Stack>

          <Stack gap={0.5}>
            {connection.labels?.region && (
              <Text size="xs" sx={{ opacity: 0.6 }}>
                Region: {String(connection.labels.region)}
              </Text>
            )}
            {connection.labels?.profile && (
              <Text size="xs" sx={{ opacity: 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Profile: {String(connection.labels.profile)}
              </Text>
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
      </Box>
    </Card>
  );
};

export default ConnectionCard;
