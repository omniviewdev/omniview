import React from 'react';
import MuiIconButton from '@mui/material/IconButton';
import MuiTooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toCssColor, toMuiSize } from '../types';

export interface ToggleButtonProps {
  selected: boolean;
  onChange: (selected: boolean) => void;
  icon: React.ReactNode;
  label?: string;
  size?: ComponentSize;
  color?: SemanticColor;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

export default function ToggleButton({
  selected,
  onChange,
  icon,
  label,
  size = 'sm',
  color = 'primary',
  disabled,
  sx,
}: ToggleButtonProps) {
  const muiSize = toMuiSize(size) as any;
  const activeColor = toCssColor(color);

  const button = (
    <MuiIconButton
      size={muiSize}
      disabled={disabled}
      onClick={() => onChange(!selected)}
      sx={{
        borderRadius: '4px',
        color: selected ? activeColor : 'var(--ov-fg-muted)',
        bgcolor: selected ? 'var(--ov-state-hover)' : 'transparent',
        '&:hover': {
          bgcolor: 'var(--ov-state-hover)',
        },
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {icon}
    </MuiIconButton>
  );

  if (label) {
    return <MuiTooltip title={label}>{button}</MuiTooltip>;
  }

  return button;
}

ToggleButton.displayName = 'ToggleButton';
