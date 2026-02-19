import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Skeleton } from '../feedback';

export interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number;
  deltaDirection?: 'up' | 'down' | 'neutral';
  sparkline?: React.ReactNode;
  loading?: boolean;
}

const deltaColors: Record<string, string> = {
  up: 'var(--ov-success)',
  down: 'var(--ov-danger)',
  neutral: 'var(--ov-fg-muted)',
};

export default function MetricCard({
  label,
  value,
  unit,
  delta,
  deltaDirection = 'neutral',
  sparkline,
  loading = false,
}: MetricCardProps) {
  if (loading) {
    return (
      <Box
        sx={{
          p: 2,
          border: '1px solid var(--ov-border-default)',
          borderRadius: '8px',
          bgcolor: 'var(--ov-bg-surface)',
        }}
      >
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="text" width="60%" height={32} />
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
        gap: 0.5,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          color: 'var(--ov-fg-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
        <Typography
          variant="h5"
          sx={{ fontWeight: 700, color: 'var(--ov-fg-base)', lineHeight: 1 }}
        >
          {value}
        </Typography>
        {unit && (
          <Typography variant="body2" sx={{ color: 'var(--ov-fg-muted)', fontSize: '0.75rem' }}>
            {unit}
          </Typography>
        )}
      </Box>

      {delta != null && (
        <Typography
          variant="caption"
          sx={{
            color: deltaColors[deltaDirection],
            fontWeight: 500,
            fontSize: '0.75rem',
          }}
        >
          {deltaDirection === 'up' && '↑'}
          {deltaDirection === 'down' && '↓'}
          {delta > 0 ? '+' : ''}{delta}%
        </Typography>
      )}

      {sparkline && <Box sx={{ mt: 0.5 }}>{sparkline}</Box>}
    </Box>
  );
}

MetricCard.displayName = 'MetricCard';
