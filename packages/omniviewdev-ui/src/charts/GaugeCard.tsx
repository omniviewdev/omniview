import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Gauge } from '@mui/x-charts/Gauge';

import type { ComponentSize, SemanticColor } from '../types';
import { resolveChartColor } from './palette';
import Skeleton from '../feedback/Skeleton';

const sizeMap: Record<ComponentSize, number> = { xs: 80, sm: 100, md: 140, lg: 180, xl: 220 };

export interface GaugeCardProps {
  value: number;
  min?: number;
  max?: number;
  label: string;
  unit?: string;
  color?: SemanticColor;
  /** [warningAt, dangerAt] thresholds for auto-coloring */
  thresholds?: [number, number];
  size?: ComponentSize;
  loading?: boolean;
}

function autoColor(value: number, min: number, max: number, thresholds: [number, number]): SemanticColor {
  const pct = ((value - min) / (max - min)) * 100;
  if (pct < thresholds[0]) return 'success';
  if (pct < thresholds[1]) return 'warning';
  return 'danger';
}

export default function GaugeCard({
  value,
  min = 0,
  max = 100,
  label,
  unit,
  color,
  thresholds = [60, 85],
  size = 'md',
  loading = false,
}: GaugeCardProps) {
  const gaugeSize = sizeMap[size];
  const resolvedColor = useMemo(
    () => resolveChartColor(color ?? autoColor(value, min, max, thresholds)),
    [color, value, min, max, thresholds],
  );

  if (loading) {
    return (
      <Box
        sx={{
          p: 2,
          border: '1px solid var(--ov-border-default)',
          borderRadius: '8px',
          bgcolor: 'var(--ov-bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Skeleton variant="circular" width={gaugeSize} height={gaugeSize} />
        <Skeleton variant="text" width="60%" />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: 2,
        border: '1px solid var(--ov-border-default)',
        borderRadius: '8px',
        bgcolor: 'var(--ov-bg-surface)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
      }}
    >
      <Gauge
        value={value}
        valueMin={min}
        valueMax={max}
        startAngle={-110}
        endAngle={110}
        width={gaugeSize}
        height={gaugeSize}
        sx={{
          '& .MuiGauge-valueArc': { fill: resolvedColor },
          '& .MuiGauge-referenceArc': { fill: 'var(--ov-bg-surface-inset)' },
        }}
        text={unit ? `${value}${unit}` : `${value}`}
      />
      <Typography
        variant="caption"
        sx={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          color: 'var(--ov-fg-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          textAlign: 'center',
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

GaugeCard.displayName = 'GaugeCard';
