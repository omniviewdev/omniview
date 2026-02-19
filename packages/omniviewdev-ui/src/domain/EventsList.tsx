import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';

import type { KubeEvent } from './types';

export interface EventsListProps {
  events: KubeEvent[];
  loading?: boolean;
  groupBy?: 'object' | 'time';
}

function formatAge(timestamp?: string): string {
  if (!timestamp) return '—';
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function EventRow({ event }: { event: KubeEvent }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        py: 1,
        px: 1.5,
        borderBottom: '1px solid var(--ov-border-muted)',
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      <Chip
        label={event.type}
        size="small"
        color={event.type === 'Warning' ? 'warning' : 'info'}
        variant="outlined"
        sx={{ fontSize: '0.625rem', height: 20, flexShrink: 0, mt: 0.25 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--ov-fg-base)' }}
        >
          {event.reason}
        </Typography>
        <Typography
          variant="body2"
          sx={{ fontSize: '0.75rem', color: 'var(--ov-fg-default)', mt: 0.25 }}
        >
          {event.message}
        </Typography>
        {event.involvedObject && (
          <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)', mt: 0.25, display: 'block' }}>
            {event.involvedObject.kind}/{event.involvedObject.name}
            {event.involvedObject.namespace ? ` (${event.involvedObject.namespace})` : ''}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        {event.count != null && event.count > 1 && (
          <Chip
            label={`×${event.count}`}
            size="small"
            sx={{ fontSize: '0.625rem', height: 18 }}
          />
        )}
        <Typography variant="caption" sx={{ color: 'var(--ov-fg-faint)', whiteSpace: 'nowrap' }}>
          {formatAge(event.lastTimestamp ?? event.firstTimestamp)}
        </Typography>
      </Box>
    </Box>
  );
}

export default function EventsList({
  events,
  loading = false,
}: EventsListProps) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (events.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4, color: 'var(--ov-fg-muted)' }}>
        <Typography variant="body2">No events</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {events.map((event, i) => (
        <EventRow key={i} event={event} />
      ))}
    </Box>
  );
}

EventsList.displayName = 'EventsList';
