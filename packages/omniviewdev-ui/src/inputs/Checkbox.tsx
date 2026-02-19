import MuiCheckbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toMuiSize, toMuiColor } from '../types';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: ComponentSize;
  color?: SemanticColor;
  indeterminate?: boolean;
  label?: string;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

export default function Checkbox({
  checked,
  onChange,
  size = 'sm',
  color = 'primary',
  indeterminate = false,
  label,
  disabled,
  sx,
}: CheckboxProps) {
  const muiSize = toMuiSize(size) as 'small' | 'medium';
  const muiColor = toMuiColor(color) as any;

  const checkbox = (
    <MuiCheckbox
      checked={checked}
      onChange={(_, val) => onChange(val)}
      size={muiSize}
      color={muiColor === 'default' || muiColor === 'inherit' ? 'primary' : muiColor}
      indeterminate={indeterminate}
      disabled={disabled}
    />
  );

  if (!label) return <span style={sx ? undefined : undefined}>{checkbox}</span>;

  return (
    <FormControlLabel
      control={checkbox}
      label={label}
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

Checkbox.displayName = 'Checkbox';
