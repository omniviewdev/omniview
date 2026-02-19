import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import type { Status, ComponentSize } from '../types';
import { statusToColor, toCssColor } from '../types';

export interface StatusDotProps {
  status: Status;
  size?: ComponentSize;
  label?: string;
  pulse?: boolean;
  sx?: SxProps<Theme>;
}

const dotSizeMap: Record<ComponentSize, number> = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
};

export default function StatusDot({
  status,
  size = 'sm',
  label,
  pulse = false,
  sx,
}: StatusDotProps) {
  const color = toCssColor(statusToColor(status));
  const dotSize = dotSizeMap[size];

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Box
        sx={{
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          backgroundColor: color,
          flexShrink: 0,
          ...(pulse && {
            animation: 'ov-pulse 1.5s ease-in-out infinite',
            '@keyframes ov-pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.4 },
            },
          }),
        }}
      />
      {label && (
        <Typography
          variant="body2"
          sx={{
            fontSize: size === 'xs' ? 'var(--ov-text-xs)' : 'var(--ov-text-sm)',
            color: 'var(--ov-fg-default)',
            lineHeight: 1,
          }}
        >
          {label}
        </Typography>
      )}
    </Box>
  );
}

StatusDot.displayName = 'StatusDot';
