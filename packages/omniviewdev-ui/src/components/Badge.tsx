import type { ReactNode } from 'react';
import MuiBadge from '@mui/material/Badge';
import type { SxProps, Theme } from '@mui/material/styles';
import type { SemanticColor } from '../types';
import { toMuiColor } from '../types';

export interface BadgeProps {
  count?: number;
  dot?: boolean;
  color?: SemanticColor;
  max?: number;
  invisible?: boolean;
  size?: 'sm' | 'md' | 'lg';
  anchorOrigin?: {
    vertical: 'top' | 'bottom';
    horizontal: 'left' | 'right';
  };
  children: ReactNode;
  sx?: SxProps<Theme>;
}

export default function Badge({
  count,
  dot = false,
  color = 'primary',
  max = 99,
  invisible,
  anchorOrigin,
  children,
  sx,
}: BadgeProps) {
  return (
    <MuiBadge
      badgeContent={dot ? undefined : count}
      variant={dot ? 'dot' : 'standard'}
      color={toMuiColor(color) as 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success' | 'default'}
      max={max}
      invisible={invisible}
      anchorOrigin={anchorOrigin}
      sx={sx}
    >
      {children}
    </MuiBadge>
  );
}

Badge.displayName = 'Badge';
