import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AIEvent {
  type: 'info' | 'warning' | 'error' | 'success';
  reason: string;
  message: string;
  timestamp?: string | Date;
  source?: string;
  count?: number;
}

export interface AIEventListProps {
  events: AIEvent[];
  maxEvents?: number;
  title?: string;
  onExpand?: () => void;
  sx?: SxProps<Theme>;
}

const typeConfig: Record<
  AIEvent['type'],
  { icon: React.ReactNode; color: string }
> = {
  info: {
    icon: <InfoOutlinedIcon sx={{ fontSize: 14 }} />,
    color: 'var(--ov-info-default)',
  },
  warning: {
    icon: <WarningAmberIcon sx={{ fontSize: 14 }} />,
    color: 'var(--ov-warning-default)',
  },
  error: {
    icon: <ErrorOutlineIcon sx={{ fontSize: 14 }} />,
    color: 'var(--ov-danger-default)',
  },
  success: {
    icon: <CheckCircleOutlineIcon sx={{ fontSize: 14 }} />,
    color: 'var(--ov-success-default)',
  },
};

function formatTimestamp(ts?: string | Date): string {
  if (!ts) return '';
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  if (isNaN(d.getTime())) return String(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function AIEventList({
  events,
  maxEvents = 5,
  title,
  onExpand,
  sx,
}: AIEventListProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleEvents = expanded ? events : events.slice(0, maxEvents);
  const hasMore = events.length > maxEvents && !expanded;

  return (
    <Box
      sx={{
        borderRadius: '6px',
        border: '1px solid var(--ov-border-default)',
        bgcolor: 'var(--ov-bg-surface)',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Header */}
      {title && (
        <Box
          sx={{
            px: 1.5,
            py: 0.5,
            borderBottom: '1px solid var(--ov-border-default)',
          }}
        >
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-fg-muted)',
              fontWeight: 'var(--ov-weight-semibold)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {title}
          </Typography>
        </Box>
      )}

      {/* Events */}
      <Box>
        {visibleEvents.map((event, i) => {
          const config = typeConfig[event.type];
          return (
            <Box
              key={i}
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
                px: 1.5,
                py: 0.75,
                borderBottom:
                  i < visibleEvents.length - 1
                    ? '1px solid var(--ov-border-muted)'
                    : 'none',
                '&:hover': { bgcolor: 'var(--ov-state-hover)' },
              }}
            >
              <Box sx={{ color: config.color, mt: 0.25 }}>{config.icon}</Box>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Typography
                    sx={{
                      fontSize: 'var(--ov-text-xs)',
                      fontWeight: 'var(--ov-weight-semibold)',
                      color: 'var(--ov-fg-default)',
                    }}
                  >
                    {event.reason}
                  </Typography>
                  {event.count && event.count > 1 && (
                    <Chip
                      size="small"
                      label={`×${event.count}`}
                      sx={{
                        height: 16,
                        fontSize: '10px',
                        bgcolor: 'var(--ov-bg-surface-inset)',
                        color: 'var(--ov-fg-muted)',
                      }}
                    />
                  )}
                  {event.timestamp && (
                    <Typography
                      sx={{
                        fontSize: '10px',
                        color: 'var(--ov-fg-faint)',
                        ml: 'auto',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatTimestamp(event.timestamp)}
                    </Typography>
                  )}
                </Box>
                <Typography
                  sx={{
                    fontSize: 'var(--ov-text-xs)',
                    color: 'var(--ov-fg-muted)',
                    lineHeight: 1.4,
                    mt: 0.25,
                  }}
                >
                  {event.message}
                </Typography>
                {event.source && (
                  <Typography
                    sx={{
                      fontSize: '10px',
                      color: 'var(--ov-fg-faint)',
                      fontFamily: 'var(--ov-font-mono)',
                      mt: 0.25,
                    }}
                  >
                    {event.source}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Show more */}
      {(hasMore || onExpand) && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            gap: 1,
            py: 0.5,
            borderTop: '1px solid var(--ov-border-muted)',
          }}
        >
          {hasMore && (
            <Button
              size="small"
              onClick={() => setExpanded(true)}
              sx={{
                fontSize: 'var(--ov-text-xs)',
                color: 'var(--ov-fg-muted)',
                textTransform: 'none',
              }}
            >
              Show {events.length - maxEvents} more
            </Button>
          )}
          {onExpand && (
            <Button
              size="small"
              onClick={onExpand}
              sx={{
                fontSize: 'var(--ov-text-xs)',
                color: 'var(--ov-accent)',
                textTransform: 'none',
              }}
            >
              View all events
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}

AIEventList.displayName = 'AIEventList';
