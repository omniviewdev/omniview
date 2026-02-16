import React from 'react';
import { Card, Stack, Typography } from '@mui/joy';
import type { EnrichedConnection } from '../../types/clusters';
import ProviderIcon from './ProviderIcon';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import NamedAvatar from '../shared/NamedAvatar';
import { Avatar } from '@mui/joy';

type Props = {
  enriched: EnrichedConnection;
  subtitle?: string;
  onClick: () => void;
};

const CompactClusterCard: React.FC<Props> = ({ enriched, subtitle, onClick }) => {
  const { connection, provider, isConnected, displayName } = enriched;

  return (
    <Card
      variant='outlined'
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        minWidth: 160,
        maxWidth: 200,
        p: 1.25,
        flexShrink: 0,
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
              sx={{ borderRadius: 6, backgroundColor: 'transparent', maxHeight: 24, maxWidth: 24, '--Avatar-size': '24px' }}
            />
          ) : (
            <NamedAvatar value={connection.name} />
          )}
        </ConnectionStatusBadge>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction='row' alignItems='center' gap={0.5}>
            <ProviderIcon provider={provider} size={12} />
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
      </Stack>
    </Card>
  );
};

export default CompactClusterCard;
