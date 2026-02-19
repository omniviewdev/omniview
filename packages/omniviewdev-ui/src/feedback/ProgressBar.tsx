import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toCssColor } from '../types';

export interface ProgressBarProps {
  value?: number;
  indeterminate?: boolean;
  color?: SemanticColor;
  size?: ComponentSize;
  label?: string;
  showValue?: boolean;
  sx?: SxProps<Theme>;
}

const heightMap: Record<ComponentSize, number> = {
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 10,
};

export default function ProgressBar({
  value,
  indeterminate = false,
  color = 'primary',
  size = 'sm',
  label,
  showValue = false,
  sx,
}: ProgressBarProps) {
  const barColor = toCssColor(color);
  const barHeight = heightMap[size];

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {(label || showValue) && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {label && (
            <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)' }}>
              {label}
            </Typography>
          )}
          {showValue && !indeterminate && value !== undefined && (
            <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)' }}>
              {Math.round(value)}%
            </Typography>
          )}
        </Box>
      )}
      <LinearProgress
        variant={indeterminate ? 'indeterminate' : 'determinate'}
        value={indeterminate ? undefined : value}
        sx={{
          height: barHeight,
          borderRadius: barHeight / 2,
          bgcolor: 'var(--ov-bg-surface-inset)',
          '& .MuiLinearProgress-bar': {
            bgcolor: barColor,
            borderRadius: barHeight / 2,
          },
        }}
      />
    </Box>
  );
}

ProgressBar.displayName = 'ProgressBar';
