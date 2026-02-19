import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ComponentSize } from '../types';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  size?: ComponentSize;
  sx?: SxProps<Theme>;
}

const paddingMap: Record<ComponentSize, number> = {
  xs: 2,
  sm: 3,
  md: 4,
  lg: 6,
  xl: 8,
};

export default function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  size = 'md',
  sx,
}: EmptyStateProps) {
  const iconSize = size === 'xs' || size === 'sm' ? 32 : size === 'md' ? 40 : 48;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        py: paddingMap[size],
        px: 2,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {icon && (
        <Box
          sx={{
            mb: 2,
            color: 'var(--ov-fg-faint)',
            fontSize: iconSize,
            display: 'flex',
          }}
        >
          {icon}
        </Box>
      )}

      <Typography
        variant={size === 'xs' || size === 'sm' ? 'subtitle2' : 'h6'}
        sx={{ color: 'var(--ov-fg-default)', fontWeight: 600, mb: description ? 0.5 : 0 }}
      >
        {title}
      </Typography>

      {description && (
        <Typography
          variant="body2"
          sx={{
            color: 'var(--ov-fg-muted)',
            maxWidth: 400,
            lineHeight: 1.5,
          }}
        >
          {description}
        </Typography>
      )}

      {(primaryAction || secondaryAction) && (
        <Box sx={{ display: 'flex', gap: 1, mt: 2.5 }}>
          {primaryAction}
          {secondaryAction}
        </Box>
      )}
    </Box>
  );
}

EmptyState.displayName = 'EmptyState';
