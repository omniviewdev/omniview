import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toCssColor } from '../types';

export interface TimelineEvent {
  id: string;
  title: string;
  description?: string;
  timestamp: string | Date;
  icon?: React.ReactNode;
  color?: SemanticColor;
}

export interface TimelineProps {
  events: TimelineEvent[];
  size?: ComponentSize;
  sx?: SxProps<Theme>;
}

const dotSizeMap: Record<ComponentSize, number> = {
  xs: 8,
  sm: 10,
  md: 12,
  lg: 14,
  xl: 16,
};

export default function Timeline({
  events,
  size = 'sm',
  sx,
}: TimelineProps) {
  const dotSize = dotSizeMap[size];

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {events.map((event, index) => {
        const color = event.color ? toCssColor(event.color) : 'var(--ov-fg-muted)';
        const isLast = index === events.length - 1;

        return (
          <Box key={event.id} sx={{ display: 'flex', gap: 1.5 }}>
            {/* Timeline column */}
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: dotSize + 8,
                flexShrink: 0,
              }}
            >
              {/* Dot or icon */}
              {event.icon ? (
                <Box sx={{ color, display: 'flex', mt: 0.25 }}>
                  {event.icon}
                </Box>
              ) : (
                <Box
                  sx={{
                    width: dotSize,
                    height: dotSize,
                    borderRadius: '50%',
                    bgcolor: color,
                    mt: 0.5,
                    flexShrink: 0,
                  }}
                />
              )}
              {/* Connector line */}
              {!isLast && (
                <Box
                  sx={{
                    width: 2,
                    flex: 1,
                    bgcolor: 'var(--ov-border-muted)',
                    minHeight: 16,
                  }}
                />
              )}
            </Box>

            {/* Content */}
            <Box sx={{ flex: 1, pb: isLast ? 0 : 2, minWidth: 0 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.25 }}>
                <Typography
                  sx={{
                    fontSize: size === 'xs' ? 'var(--ov-text-xs)' : 'var(--ov-text-sm)',
                    fontWeight: 500,
                    color: 'var(--ov-fg-base)',
                  }}
                >
                  {event.title}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 'var(--ov-text-xs)',
                    color: 'var(--ov-fg-faint)',
                    whiteSpace: 'nowrap',
                    ml: 1,
                    flexShrink: 0,
                  }}
                >
                  {typeof event.timestamp === 'string'
                    ? event.timestamp
                    : event.timestamp.toLocaleTimeString()}
                </Typography>
              </Box>
              {event.description && (
                <Typography
                  sx={{
                    fontSize: 'var(--ov-text-xs)',
                    color: 'var(--ov-fg-muted)',
                    lineHeight: 1.5,
                  }}
                >
                  {event.description}
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

Timeline.displayName = 'Timeline';
