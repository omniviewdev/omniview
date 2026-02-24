import React from 'react';

import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';

import Icon from './Icon';

/** Represents a single current metric value to display. */
export interface MetricValue {
  metricID: string;
  name: string;
  value: number;
  unit: string;
  icon?: string;
  /** Optional capacity to compute percentage for gauge display */
  capacity?: number;
  /** Optional color for the metric accent */
  color?: string;
}

/** A provider group of metric values. */
export interface MetricProviderGroup {
  providerID: string;
  providerName: string;
  providerIcon?: string;
  metrics: MetricValue[];
}

export interface MetricsSectionProps {
  /** Grouped metric data from providers. */
  providers: MetricProviderGroup[];
  /** Whether data is currently loading. */
  isLoading?: boolean;
  /** Error message, if any. */
  error?: string | null;
  /** Override container styles. */
  sx?: SxProps<Theme>;
}

const UNIT_LABELS: Record<string, string> = {
  NONE: '',
  BYTES: 'B',
  KB: 'KB',
  MB: 'MB',
  GB: 'GB',
  PERCENTAGE: '%',
  MILLISECONDS: 'ms',
  SECONDS: 's',
  COUNT: '',
  OPS_PER_SEC: 'ops/s',
  BYTES_PER_SEC: 'B/s',
  MILLICORES: 'm',
  CORES: 'cores',
};

function formatMetricValue(value: number, unit: string): string {
  const unitLabel = UNIT_LABELS[unit] ?? unit;

  // Auto-format bytes
  if (unit === 'BYTES' || unit === 'bytes') {
    if (value >= 1024 * 1024 * 1024) {
      return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    if (value >= 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (value >= 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${value} B`;
  }

  // Auto-format millicores
  if (unit === 'MILLICORES' || unit === 'millicores') {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(2)} cores`;
    }
    return `${Math.round(value)}${unitLabel}`;
  }

  if (Number.isInteger(value)) {
    return `${value}${unitLabel ? ` ${unitLabel}` : ''}`;
  }
  return `${value.toFixed(2)}${unitLabel ? ` ${unitLabel}` : ''}`;
}

const MetricGauge: React.FC<{ metric: MetricValue }> = ({ metric }) => {
  const hasCapacity = metric.capacity != null && metric.capacity > 0;
  const percentage = hasCapacity ? Math.min((metric.value / metric.capacity!) * 100, 100) : null;

  const getColor = (): 'primary' | 'warning' | 'error' | 'success' => {
    if (percentage == null) return 'primary';
    if (percentage >= 90) return 'error';
    if (percentage >= 70) return 'warning';
    return 'primary';
  };

  return (
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.25 }}>
        {metric.icon && (
          <Icon name={metric.icon} style={{ fontSize: 14, opacity: 0.7 }} />
        )}
        <Typography
          variant="caption"
          sx={{ fontWeight: 500, opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {metric.name}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {formatMetricValue(metric.value, metric.unit)}
      </Typography>
      {hasCapacity && (
        <Box sx={{ mt: 0.5 }}>
          <LinearProgress
            variant="determinate"
            value={percentage!}
            color={getColor()}
            sx={{ height: 4, borderRadius: 2 }}
          />
          <Typography variant="caption" sx={{ opacity: 0.6, fontSize: '0.65rem' }}>
            {percentage!.toFixed(0)}% of {formatMetricValue(metric.capacity!, metric.unit)}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

/**
 * MetricsSection renders metric data from one or more providers.
 * Designed to be dropped into any resource sidebar.
 */
export const MetricsSection: React.FC<MetricsSectionProps> = ({
  providers,
  isLoading = false,
  error,
  sx,
}) => {
  if (isLoading && providers.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2, ...sx }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ px: 1, py: 0.5, ...sx }}>
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      </Box>
    );
  }

  if (providers.length === 0) {
    return null;
  }

  return (
    <Stack spacing={1.5} sx={sx}>
      {providers.map((provider) => (
        <Box key={provider.providerID}>
          {providers.length > 1 && (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.75 }}>
              {provider.providerIcon && (
                <Icon name={provider.providerIcon} style={{ fontSize: 14 }} />
              )}
              <Chip
                label={provider.providerName}
                size="small"
                variant="outlined"
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
            </Stack>
          )}
          <Stack
            direction="row"
            spacing={1.5}
            sx={{
              flexWrap: 'wrap',
              '& > *': { minWidth: 100 },
            }}
          >
            {provider.metrics.map((m) => (
              <MetricGauge key={m.metricID} metric={m} />
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
};

export default MetricsSection;
