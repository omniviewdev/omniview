import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toCssColor } from '../types';

export interface ProgressRingProps {
  /** 0–100 progress value. Omit for indeterminate. */
  value?: number;
  /** Size preset */
  size?: ComponentSize;
  /** Semantic color */
  color?: SemanticColor;
  /** Track thickness multiplier (1 = default) */
  thickness?: number;
  /** Show value inside the ring */
  showValue?: boolean;
  /** Custom label inside the ring (overrides showValue) */
  label?: React.ReactNode;
  /** Caption below the ring */
  caption?: string;
  /** Track (background) color */
  trackColor?: string;
  sx?: SxProps<Theme>;
}

const sizeMap: Record<ComponentSize, number> = {
  xs: 20,
  sm: 32,
  md: 48,
  lg: 64,
  xl: 80,
};

const thicknessMap: Record<ComponentSize, number> = {
  xs: 5,
  sm: 4.5,
  md: 4,
  lg: 3.5,
  xl: 3,
};

const fontSizeMap: Record<ComponentSize, string> = {
  xs: '0.5rem',
  sm: '0.625rem',
  md: '0.8125rem',
  lg: '1rem',
  xl: '1.25rem',
};

export default function ProgressRing({
  value,
  size = 'md',
  color = 'primary',
  thickness,
  showValue = false,
  label,
  caption,
  trackColor,
  sx,
}: ProgressRingProps) {
  const ringSize = sizeMap[size];
  const ringThickness = thickness ?? thicknessMap[size];
  const barColor = toCssColor(color);
  const indeterminate = value === undefined;
  const displayLabel = label ?? (showValue && !indeterminate ? `${Math.round(value)}%` : null);

  return (
    <Box
      sx={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Box sx={{ position: 'relative', display: 'inline-flex' }}>
        {/* Track (background ring) */}
        <CircularProgress
          variant="determinate"
          value={100}
          size={ringSize}
          thickness={ringThickness}
          sx={{
            color: trackColor ?? 'var(--ov-bg-surface-inset)',
            position: 'absolute',
          }}
        />
        {/* Progress ring */}
        <CircularProgress
          variant={indeterminate ? 'indeterminate' : 'determinate'}
          value={indeterminate ? undefined : value}
          size={ringSize}
          thickness={ringThickness}
          sx={{
            color: barColor,
            ...(indeterminate && { animationDuration: '1.2s' }),
          }}
        />
        {/* Center label */}
        {displayLabel && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography
              sx={{
                fontSize: fontSizeMap[size],
                fontWeight: 600,
                color: 'var(--ov-fg-default)',
                lineHeight: 1,
                fontFeatureSettings: '"tnum"',
              }}
            >
              {displayLabel}
            </Typography>
          </Box>
        )}
      </Box>
      {caption && (
        <Typography
          sx={{
            fontSize: size === 'xs' ? '0.5rem' : 'var(--ov-text-xs)',
            color: 'var(--ov-fg-muted)',
            textAlign: 'center',
            lineHeight: 1.3,
          }}
        >
          {caption}
        </Typography>
      )}
    </Box>
  );
}

ProgressRing.displayName = 'ProgressRing';
