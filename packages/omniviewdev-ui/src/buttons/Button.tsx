import React from 'react';
import MuiButton from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, Emphasis, ComponentSize, Shape } from '../types';
import { toMuiColor, toMuiVariant, toMuiSize, sizeOverrideSx, toBorderRadius } from '../types';

export interface ButtonProps {
  children: React.ReactNode;
  color?: SemanticColor;
  emphasis?: Emphasis;
  size?: ComponentSize;
  shape?: Shape;
  loading?: boolean;
  loadingPosition?: 'start' | 'center' | 'end';
  disabled?: boolean;
  startIcon?: React.ReactNode;
  /** Alias for startIcon */
  startAdornment?: React.ReactNode;
  /** Alias for startIcon (single icon shorthand) */
  icon?: React.ReactNode;
  endIcon?: React.ReactNode;
  /** Alias for endIcon */
  endAdornment?: React.ReactNode;
  fullWidth?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  type?: 'button' | 'submit' | 'reset';
  href?: string;
  sx?: SxProps<Theme>;
}

export default function Button({
  children,
  color = 'neutral',
  emphasis = 'ghost',
  size = 'sm',
  shape = 'rounded',
  loading = false,
  loadingPosition = 'center',
  disabled,
  startIcon,
  startAdornment,
  icon,
  endIcon,
  endAdornment,
  fullWidth,
  onClick,
  type = 'button',
  href,
  sx,
}: ButtonProps) {
  const baseStartIcon = startIcon ?? startAdornment ?? icon;
  const baseEndIcon = endIcon ?? endAdornment;
  const muiColor = toMuiColor(color) as any;
  const muiVariant = toMuiVariant(emphasis) as any;
  const muiSize = toMuiSize(size) as any;
  const sizeOverride = sizeOverrideSx(size);

  const spinner = <CircularProgress size={size === 'xs' ? 12 : 16} color="inherit" />;

  const resolvedStartIcon = loading && loadingPosition === 'start' ? spinner : baseStartIcon;
  const resolvedEndIcon = loading && loadingPosition === 'end' ? spinner : baseEndIcon;

  return (
    <MuiButton
      color={muiColor}
      variant={muiVariant}
      size={muiSize}
      disabled={disabled || (loading && loadingPosition === 'center')}
      startIcon={resolvedStartIcon}
      endIcon={resolvedEndIcon}
      fullWidth={fullWidth}
      onClick={onClick}
      type={type}
      href={href}
      sx={{
        borderRadius: toBorderRadius(shape),
        ...sizeOverride,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {loading && loadingPosition === 'center' ? spinner : children}
    </MuiButton>
  );
}

Button.displayName = 'Button';
