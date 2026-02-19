import React from 'react';
import MuiIconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize, Shape } from '../types';
import { toMuiColor, toMuiSize, toBorderRadius } from '../types';

export interface IconButtonProps {
  children: React.ReactNode;
  color?: SemanticColor;
  size?: ComponentSize;
  shape?: Shape;
  loading?: boolean;
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  'aria-label'?: string;
  title?: string;
  sx?: SxProps<Theme>;
}

export default function IconButton({
  children,
  color = 'neutral',
  size = 'sm',
  shape = 'rounded',
  loading = false,
  disabled,
  onClick,
  title,
  sx,
  ...rest
}: IconButtonProps) {
  const muiColor = toMuiColor(color) as any;
  const muiSize = toMuiSize(size) as any;

  const sizeMap: Record<ComponentSize, number> = {
    xs: 24,
    sm: 32,
    md: 40,
    lg: 48,
    xl: 56,
  };

  const iconSizeMap: Record<ComponentSize, number> = {
    xs: 14,
    sm: 18,
    md: 22,
    lg: 26,
    xl: 30,
  };

  return (
    <MuiIconButton
      color={muiColor}
      size={muiSize}
      disabled={disabled || loading}
      onClick={onClick}
      title={title}
      sx={{
        borderRadius: toBorderRadius(shape),
        width: sizeMap[size],
        height: sizeMap[size],
        fontSize: iconSizeMap[size],
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
      {...rest}
    >
      {loading ? (
        <CircularProgress size={iconSizeMap[size] - 4} color="inherit" />
      ) : (
        children
      )}
    </MuiIconButton>
  );
}

IconButton.displayName = 'IconButton';
