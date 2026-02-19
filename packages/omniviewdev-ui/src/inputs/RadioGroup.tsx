import MuiRadioGroup from '@mui/material/RadioGroup';
import Radio from '@mui/material/Radio';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import FormHelperText from '@mui/material/FormHelperText';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toMuiSize, toMuiColor } from '../types';

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
  description?: string;
}

export interface RadioGroupProps {
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  size?: ComponentSize;
  color?: SemanticColor;
  layout?: 'row' | 'column';
  label?: string;
  sx?: SxProps<Theme>;
}

export default function RadioGroup({
  options,
  value,
  onChange,
  size = 'sm',
  color = 'primary',
  layout = 'column',
  label,
  sx,
}: RadioGroupProps) {
  const muiSize = toMuiSize(size) as 'small' | 'medium';
  const muiColor = toMuiColor(color) as any;

  return (
    <FormControl sx={sx}>
      {label && (
        <FormLabel
          sx={{
            fontSize: 'var(--ov-text-sm)',
            fontWeight: 500,
            mb: 0.5,
          }}
        >
          {label}
        </FormLabel>
      )}
      <MuiRadioGroup
        value={value}
        onChange={(_, val) => onChange(val)}
        row={layout === 'row'}
      >
        {options.map((opt) => (
          <FormControlLabel
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled}
            control={
              <Radio
                size={muiSize}
                color={muiColor === 'default' || muiColor === 'inherit' ? 'primary' : muiColor}
              />
            }
            label={
              opt.description ? (
                <span>
                  <span>{opt.label}</span>
                  <FormHelperText sx={{ m: 0, mt: -0.25 }}>{opt.description}</FormHelperText>
                </span>
              ) : (
                opt.label
              )
            }
            sx={{
              '& .MuiFormControlLabel-label': {
                fontSize: size === 'xs' || size === 'sm' ? 'var(--ov-text-sm)' : undefined,
              },
            }}
          />
        ))}
      </MuiRadioGroup>
    </FormControl>
  );
}

RadioGroup.displayName = 'RadioGroup';
