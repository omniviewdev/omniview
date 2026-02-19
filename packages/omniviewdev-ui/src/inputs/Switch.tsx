import MuiSwitch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toMuiColor } from '../types';

/** Track / thumb dimensions per ComponentSize. */
const SWITCH_SIZES: Record<ComponentSize, {
  width: number;
  height: number;
  thumb: number;
  translate: number;
}> = {
  xs: { width: 32, height: 18, thumb: 14, translate: 14 },
  sm: { width: 36, height: 20, thumb: 16, translate: 16 },
  md: { width: 44, height: 24, thumb: 20, translate: 20 },
  lg: { width: 52, height: 28, thumb: 24, translate: 24 },
  xl: { width: 60, height: 32, thumb: 28, translate: 28 },
};

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: ComponentSize;
  color?: SemanticColor;
  label?: string;
  labelPlacement?: 'start' | 'end' | 'top' | 'bottom';
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

export default function Switch({
  checked,
  onChange,
  size = 'md',
  color = 'primary',
  label,
  labelPlacement = 'end',
  disabled,
  sx,
}: SwitchProps) {
  const muiColor = toMuiColor(color) as any;
  const dim = SWITCH_SIZES[size];

  const sizeSx: SxProps<Theme> = size !== 'md' ? {
    width: dim.width,
    height: dim.height,
    '& .MuiSwitch-switchBase.Mui-checked': {
      transform: `translateX(${dim.translate}px)`,
    },
    '& .MuiSwitch-thumb': {
      width: dim.thumb,
      height: dim.thumb,
    },
  } : {};

  const switchEl = (
    <MuiSwitch
      checked={checked}
      onChange={(_, val) => onChange(val)}
      color={muiColor === 'default' || muiColor === 'inherit' ? 'primary' : muiColor}
      disabled={disabled}
      sx={sizeSx}
    />
  );

  if (!label) return switchEl;

  return (
    <FormControlLabel
      control={switchEl}
      label={label}
      labelPlacement={labelPlacement}
      disabled={disabled}
      sx={{
        '& .MuiFormControlLabel-label': {
          fontSize: size === 'xs' || size === 'sm' ? 'var(--ov-text-sm)' : undefined,
        },
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    />
  );
}

Switch.displayName = 'Switch';
