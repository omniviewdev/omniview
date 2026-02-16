import React from 'react';
import { Avatar, Box, Card, Stack, Typography } from '@mui/joy';
import type { EnrichedConnection } from '../../types/clusters';
import ProviderIcon from './ProviderIcon';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import FavoriteButton from './FavoriteButton';
import NamedAvatar from '../shared/NamedAvatar';

type Props = {
  enriched: EnrichedConnection;
  subtitle?: string;
  showFavorite?: boolean;
  onToggleFavorite?: () => void;
  onClick: () => void;
};

const HubClusterRow: React.FC<Props> = ({
  enriched,
  subtitle,
  showFavorite,
  onToggleFavorite,
  onClick,
}) => {
  const { connection, provider, isConnected, displayName } = enriched;

  return (
    <Card
      variant='outlined'
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        p: 1,
        '&:hover': { borderColor: 'primary.outlinedHoverBorder', boxShadow: 'sm' },
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    >
      <Stack direction='row' alignItems='center' gap={1}>
        <ConnectionStatusBadge isConnected={isConnected}>
          {connection.avatar ? (
            <Avatar
              size='sm'
              src={connection.avatar}
              sx={{
                borderRadius: 6,
                backgroundColor: 'transparent',
                maxHeight: 32,
                maxWidth: 32,
                '--Avatar-size': '32px',
              }}
            />
          ) : (
            <NamedAvatar value={connection.name} />
          )}
        </ConnectionStatusBadge>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction='row' alignItems='center' gap={0.5} sx={{ minWidth: 0 }}>
            <Box sx={{ flexShrink: 0, display: 'flex' }}>
              <ProviderIcon provider={provider} />
            </Box>
            <Typography level='body-sm' fontWeight={600} noWrap sx={{ fontSize: '0.8rem' }}>
              {displayName}
            </Typography>
          </Stack>
          {subtitle && (
            <Typography level='body-xs' noWrap sx={{ opacity: 0.6, fontSize: '0.7rem' }}>
              {subtitle}
            </Typography>
          )}
        </Stack>
        {showFavorite && onToggleFavorite && (
          <FavoriteButton isFavorite={enriched.isFavorite} onToggle={onToggleFavorite} />
        )}
      </Stack>
    </Card>
  );
};

export default HubClusterRow;
