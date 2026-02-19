import React from 'react';
import Box from '@mui/material/Box';
import MuiTooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor } from '../types';
import { toCssColor } from '../types';

export interface StatusBarItemProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  tooltip?: string;
  align?: 'left' | 'right';
  color?: SemanticColor;
  separator?: boolean;
  sx?: SxProps<Theme>;
}

export default function StatusBarItem({
  children,
  icon,
  onClick,
  tooltip,
  color,
  separator = false,
  sx,
}: StatusBarItemProps) {
  const content = (
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        height: 20,
        fontSize: 'var(--ov-text-xs)',
        color: color ? toCssColor(color) : 'var(--ov-fg-default)',
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: '3px',
        whiteSpace: 'nowrap',
        ...(separator && {
          borderRight: '1px solid var(--ov-border-muted)',
          pr: 1,
          mr: 0.25,
        }),
        ...(onClick && {
          '&:hover': { bgcolor: 'var(--ov-state-hover)' },
        }),
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {icon && (
        <Box component="span" sx={{ display: 'inline-flex', fontSize: '0.75rem' }}>
          {icon}
        </Box>
      )}
      {children}
    </Box>
  );

  if (tooltip) {
    return <MuiTooltip title={tooltip}>{content}</MuiTooltip>;
  }

  return content;
}

StatusBarItem.displayName = 'StatusBarItem';
