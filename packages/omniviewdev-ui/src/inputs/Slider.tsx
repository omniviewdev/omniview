import MuiSlider from '@mui/material/Slider';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toMuiSize, toMuiColor } from '../types';

export interface SliderProps {
  value: number | number[];
  onChange: (value: number | number[]) => void;
  size?: ComponentSize;
  color?: SemanticColor;
  range?: boolean;
  marks?: boolean | Array<{ value: number; label?: string }>;
  showValue?: boolean;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

export default function Slider({
  value,
  onChange,
  size = 'sm',
  color = 'primary',
  marks,
  showValue = false,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  sx,
}: SliderProps) {
  const muiSize = toMuiSize(size) as 'small' | 'medium';
  const muiColor = toMuiColor(color) as any;

  return (
    <MuiSlider
      value={value}
      onChange={(_, val) => onChange(val)}
      size={muiSize}
      color={muiColor === 'default' || muiColor === 'inherit' ? 'primary' : muiColor}
      marks={marks}
      valueLabelDisplay={showValue ? 'auto' : 'off'}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      sx={sx}
    />
  );
}

Slider.displayName = 'Slider';
