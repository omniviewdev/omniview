import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { ComponentSize } from '../../types';

const SIZES: ComponentSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

interface SizePickerProps {
  value: ComponentSize;
  onChange: (size: ComponentSize) => void;
  label?: string;
}

/** Inline toggle strip for switching ComponentSize in showcase demos. */
export default function SizePicker({ value, onChange, label = 'Size' }: SizePickerProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', fontWeight: 600 }}>
        {label}
      </Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        size="small"
        onChange={(_, v) => { if (v) onChange(v as ComponentSize); }}
      >
        {SIZES.map((s) => (
          <ToggleButton key={s} value={s} sx={{ px: 1.5, py: 0.25, fontSize: '0.6875rem', textTransform: 'none' }}>
            {s}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}
