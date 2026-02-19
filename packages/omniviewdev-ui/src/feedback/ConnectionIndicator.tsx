import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ComponentSize } from '../types';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface ConnectionIndicatorProps {
  status: ConnectionStatus;
  label?: string;
  size?: ComponentSize;
  showLabel?: boolean;
  sx?: SxProps<Theme>;
}

const colorMap: Record<ConnectionStatus, string> = {
  connected: 'var(--ov-success-default)',
  connecting: 'var(--ov-warning-default)',
  disconnected: 'var(--ov-fg-faint)',
  error: 'var(--ov-danger-default)',
};

const defaultLabels: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
  error: 'Error',
};

const dotSizeMap: Record<ComponentSize, number> = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
};

export default function ConnectionIndicator({
  status,
  label,
  size = 'sm',
  showLabel = true,
  sx,
}: ConnectionIndicatorProps) {
  const dotColor = colorMap[status];
  const dotSize = dotSizeMap[size];
  const displayLabel = label ?? defaultLabels[status];

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
          bgcolor: dotColor,
          flexShrink: 0,
          ...(status === 'connecting' && {
            animation: 'ov-conn-pulse 1.5s ease-in-out infinite',
            '@keyframes ov-conn-pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.3 },
            },
          }),
        }}
      />
      {showLabel && (
        <Typography
          sx={{
            fontSize: size === 'xs' ? 'var(--ov-text-xs)' : 'var(--ov-text-sm)',
            color: 'var(--ov-fg-default)',
            lineHeight: 1,
          }}
        >
          {displayLabel}
        </Typography>
      )}
    </Box>
  );
}

ConnectionIndicator.displayName = 'ConnectionIndicator';
