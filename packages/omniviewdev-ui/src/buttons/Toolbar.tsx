import React from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ComponentSize } from '../types';

export interface ToolbarProps {
  children: React.ReactNode;
  size?: ComponentSize;
  variant?: 'default' | 'dense';
  dividers?: boolean;
  sx?: SxProps<Theme>;
}

const heightMap: Record<string, number> = {
  default: 36,
  dense: 28,
};

export default function Toolbar({
  children,
  variant = 'default',
  dividers = false,
  sx,
}: ToolbarProps) {
  const height = heightMap[variant];

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        height,
        gap: dividers ? 0 : 0.5,
        px: 0.5,
        bgcolor: 'var(--ov-bg-surface)',
        ...(dividers && {
          '& > *:not(:last-child)::after': {
            content: '""',
            display: 'block',
            width: '1px',
            height: '60%',
            bgcolor: 'var(--ov-border-muted)',
            ml: 0.5,
            mr: 0.5,
            flexShrink: 0,
          },
        }),
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {children}
    </Box>
  );
}

Toolbar.displayName = 'Toolbar';
