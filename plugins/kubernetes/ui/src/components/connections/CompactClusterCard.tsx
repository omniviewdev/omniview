import React from 'react';
import Box from '@mui/material/Box';
import { Avatar } from '@omniviewdev/ui';
import type { EnrichedConnection } from '../../types/clusters';
import ProviderIcon from './ProviderIcon';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import NamedAvatar from '../shared/NamedAvatar';
import FavoriteButton from './FavoriteButton';

type Props = {
  enriched: EnrichedConnection;
  subtitle?: string;
  showFavorite?: boolean;
  onToggleFavorite?: () => void;
  onClick: () => void;
};

const CompactClusterCard: React.FC<Props> = ({ enriched, subtitle, showFavorite, onToggleFavorite, onClick }) => {
  const { provider, isConnected, displayName } = enriched;

  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        py: 1,
        minWidth: 160,
        maxWidth: 220,
        flexShrink: 0,
        cursor: 'pointer',
        borderRadius: 'var(--ov-radius-md, 6px)',
        border: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
        bgcolor: 'var(--ov-bg-surface, rgba(255,255,255,0.03))',
        transition: 'border-color 0.15s, background-color 0.15s, box-shadow 0.15s',
        '&:hover': {
          borderColor: 'var(--ov-border-emphasis, rgba(255,255,255,0.15))',
          bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        },
      }}
    >
      <ConnectionStatusBadge isConnected={isConnected}>
        {enriched.avatar ? (
          <Avatar
            size="xs"
            src={enriched.avatar}
            sx={{ borderRadius: '6px', bgcolor: 'transparent' }}
          />
        ) : (
          <NamedAvatar value={displayName} color={enriched.avatarColor} />
        )}
      </ConnectionStatusBadge>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
          <Box sx={{ flexShrink: 0, display: 'flex' }}>
            <ProviderIcon provider={provider} size={12} />
          </Box>
          <Box
            component="span"
            sx={{
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--ov-fg-base)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </Box>
        </Box>
        {subtitle && (
          <Box
            component="span"
            sx={{
              display: 'block',
              fontSize: '0.7rem',
              color: 'var(--ov-fg-faint)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subtitle}
          </Box>
        )}
      </Box>

      {showFavorite && onToggleFavorite && (
        <FavoriteButton isFavorite={enriched.isFavorite} onToggle={onToggleFavorite} />
      )}
    </Box>
  );
};

export default CompactClusterCard;
