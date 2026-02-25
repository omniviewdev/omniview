import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import RemoveIcon from '@mui/icons-material/Remove';
import type { SxProps, Theme } from '@mui/material/styles';

type Status = 'healthy' | 'warning' | 'degraded' | 'error' | 'unknown' | 'pending';

const statusColors: Record<Status, string> = {
  healthy: 'var(--ov-success-default)',
  warning: 'var(--ov-warning-default)',
  degraded: 'var(--ov-warning-emphasis)',
  error: 'var(--ov-danger-default)',
  unknown: 'var(--ov-fg-muted)',
  pending: 'var(--ov-info-default)',
};

interface MetricItem {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number;
  deltaDirection?: 'up' | 'down' | 'flat';
  status?: Status;
  sparkline?: number[];
}

export interface AIMetricSnapshotProps {
  metrics: MetricItem[];
  title?: string;
  columns?: 2 | 3 | 4;
  sx?: SxProps<Theme>;
}

function MiniSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const h = 20;
  const w = 48;
  const step = w / (data.length - 1);

  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="var(--ov-accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DeltaIndicator({
  delta,
  direction,
}: {
  delta: number;
  direction?: 'up' | 'down' | 'flat';
}) {
  const dir = direction || (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat');
  const colorMap = { up: 'var(--ov-success-default)', down: 'var(--ov-danger-default)', flat: 'var(--ov-fg-muted)' };
  const iconMap = {
    up: <ArrowUpwardIcon sx={{ fontSize: 12 }} />,
    down: <ArrowDownwardIcon sx={{ fontSize: 12 }} />,
    flat: <RemoveIcon sx={{ fontSize: 12 }} />,
  };

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        color: colorMap[dir],
        fontSize: 'var(--ov-text-xs)',
        fontWeight: 'var(--ov-weight-medium)',
      }}
    >
      {iconMap[dir]}
      {Math.abs(delta).toFixed(1)}
    </Box>
  );
}

export default function AIMetricSnapshot({
  metrics,
  title,
  columns = 3,
  sx,
}: AIMetricSnapshotProps) {
  return (
    <Box
      sx={{
        borderRadius: '8px',
        border: '1px solid var(--ov-border-default)',
        bgcolor: 'var(--ov-bg-surface)',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {title && (
        <Box
          sx={{
            px: 1.5,
            py: 0.75,
            borderBottom: '1px solid var(--ov-border-default)',
          }}
        >
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              fontWeight: 'var(--ov-weight-semibold)',
              color: 'var(--ov-fg-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {title}
          </Typography>
        </Box>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 0,
        }}
      >
        {metrics.map((metric, i) => {
          const color = metric.status
            ? statusColors[metric.status]
            : 'var(--ov-fg-default)';

          return (
            <Box
              key={i}
              sx={{
                px: 1.5,
                py: 1,
                borderRight: (i + 1) % columns !== 0 ? '1px solid var(--ov-border-muted)' : 'none',
                borderBottom: i < metrics.length - columns ? '1px solid var(--ov-border-muted)' : 'none',
              }}
            >
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-fg-muted)',
                  fontWeight: 'var(--ov-weight-medium)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  mb: 0.25,
                }}
              >
                {metric.label}
              </Typography>

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 0.5,
                }}
              >
                <Typography
                  sx={{
                    fontSize: 'var(--ov-text-xl)',
                    fontWeight: 'var(--ov-weight-semibold)',
                    color,
                    lineHeight: 1.2,
                  }}
                >
                  {metric.value}
                </Typography>
                {metric.unit && (
                  <Typography
                    sx={{
                      fontSize: 'var(--ov-text-xs)',
                      color: 'var(--ov-fg-faint)',
                    }}
                  >
                    {metric.unit}
                  </Typography>
                )}
              </Box>

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  mt: 0.5,
                }}
              >
                {metric.delta !== undefined && (
                  <DeltaIndicator delta={metric.delta} direction={metric.deltaDirection} />
                )}
                {metric.sparkline && metric.sparkline.length > 1 && (
                  <MiniSparkline data={metric.sparkline} />
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

AIMetricSnapshot.displayName = 'AIMetricSnapshot';
