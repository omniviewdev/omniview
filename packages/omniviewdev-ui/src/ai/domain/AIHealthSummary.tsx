import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
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

interface HealthStat {
  label: string;
  value: number;
  status: Status;
}

interface HealthBreakdown {
  kind: string;
  icon?: React.ReactNode;
  total: number;
  statuses: Record<string, number>;
}

export interface AIHealthSummaryProps {
  title?: string;
  stats: HealthStat[];
  breakdowns?: HealthBreakdown[];
  sx?: SxProps<Theme>;
}

export default function AIHealthSummary({
  title,
  stats,
  breakdowns,
  sx,
}: AIHealthSummaryProps) {
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

      {/* Stats row */}
      <Box
        sx={{
          display: 'flex',
          gap: 0,
        }}
      >
        {stats.map((stat, i) => (
          <Box
            key={i}
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              py: 1,
              px: 1,
              borderRight:
                i < stats.length - 1
                  ? '1px solid var(--ov-border-muted)'
                  : 'none',
            }}
          >
            <Typography
              sx={{
                fontSize: 'var(--ov-text-xl)',
                fontWeight: 'var(--ov-weight-semibold)',
                color: statusColors[stat.status],
                lineHeight: 1.2,
              }}
            >
              {stat.value}
            </Typography>
            <Typography
              sx={{
                fontSize: 'var(--ov-text-xs)',
                color: 'var(--ov-fg-muted)',
                mt: 0.25,
              }}
            >
              {stat.label}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* Breakdowns */}
      {breakdowns && breakdowns.length > 0 && (
        <Box
          sx={{
            borderTop: '1px solid var(--ov-border-default)',
            px: 1.5,
            py: 0.75,
          }}
        >
          {breakdowns.map((bd, i) => (
            <Box
              key={i}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                py: 0.5,
                borderBottom:
                  i < breakdowns.length - 1
                    ? '1px solid var(--ov-border-muted)'
                    : 'none',
              }}
            >
              {bd.icon && (
                <Box sx={{ color: 'var(--ov-fg-muted)', display: 'flex' }}>
                  {bd.icon}
                </Box>
              )}
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  fontWeight: 'var(--ov-weight-medium)',
                  color: 'var(--ov-fg-default)',
                  minWidth: 80,
                }}
              >
                {bd.kind}
              </Typography>
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-fg-muted)',
                  fontFamily: 'var(--ov-font-mono)',
                }}
              >
                {bd.total} total
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.75, ml: 'auto' }}>
                {Object.entries(bd.statuses).map(([key, count]) => {
                  const color =
                    statusColors[key as Status] || 'var(--ov-fg-muted)';
                  return (
                    <Box
                      key={key}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.25,
                      }}
                    >
                      <Box
                        sx={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          bgcolor: color,
                        }}
                      />
                      <Typography
                        sx={{
                          fontSize: '10px',
                          color: 'var(--ov-fg-muted)',
                          fontFamily: 'var(--ov-font-mono)',
                        }}
                      >
                        {count}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

AIHealthSummary.displayName = 'AIHealthSummary';
