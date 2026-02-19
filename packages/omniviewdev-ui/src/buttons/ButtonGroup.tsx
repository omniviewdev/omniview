import React from 'react';
import MuiButtonGroup from '@mui/material/ButtonGroup';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, Emphasis, ComponentSize } from '../types';
import { toMuiColor, toMuiVariant, toMuiSize } from '../types';

export interface ButtonGroupProps {
  children: React.ReactNode;
  emphasis?: Emphasis;
  size?: ComponentSize;
  color?: SemanticColor;
  fullWidth?: boolean;
  orientation?: 'horizontal' | 'vertical';
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

export default function ButtonGroup({
  children,
  emphasis = 'outline',
  size = 'sm',
  color = 'neutral',
  fullWidth,
  orientation = 'horizontal',
  disabled,
  sx,
}: ButtonGroupProps) {
  const muiColor = toMuiColor(color) as any;
  const muiVariant = toMuiVariant(emphasis) as any;
  const muiSize = toMuiSize(size) as any;

  return (
    <MuiButtonGroup
      color={muiColor}
      variant={muiVariant}
      size={muiSize}
      fullWidth={fullWidth}
      orientation={orientation}
      disabled={disabled}
      sx={sx}
    >
      {children}
    </MuiButtonGroup>
  );
}

ButtonGroup.displayName = 'ButtonGroup';
