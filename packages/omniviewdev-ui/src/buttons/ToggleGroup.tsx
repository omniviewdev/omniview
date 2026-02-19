import React from 'react';
import MuiToggleButton from '@mui/material/ToggleButton';
import MuiToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toCssColor, toMuiSize } from '../types';

export interface ToggleOption {
  key: string;
  label?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface ToggleGroupProps {
  value: string | string[];
  onChange: (value: string | string[]) => void;
  options: ToggleOption[];
  exclusive?: boolean;
  size?: ComponentSize;
  color?: SemanticColor;
  sx?: SxProps<Theme>;
}

export default function ToggleGroup({
  value,
  onChange,
  options,
  exclusive = true,
  size = 'sm',
  color = 'primary',
  sx,
}: ToggleGroupProps) {
  const muiSize = toMuiSize(size) as any;
  const activeColor = toCssColor(color);

  const handleChange = (_: unknown, newValue: string | string[] | null) => {
    if (newValue === null) return;
    onChange(newValue);
  };

  return (
    <MuiToggleButtonGroup
      value={value}
      exclusive={exclusive}
      onChange={handleChange}
      size={muiSize}
      sx={{
        '& .Mui-selected': {
          color: `${activeColor} !important`,
          bgcolor: 'var(--ov-state-hover) !important',
        },
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {options.map((opt) => (
        <MuiToggleButton
          key={opt.key}
          value={opt.key}
          disabled={opt.disabled}
          sx={{
            fontSize: 'var(--ov-text-sm)',
            textTransform: 'none',
            px: 1.5,
            gap: 0.5,
          }}
        >
          {opt.icon}
          {opt.label}
        </MuiToggleButton>
      ))}
    </MuiToggleButtonGroup>
  );
}

ToggleGroup.displayName = 'ToggleGroup';
