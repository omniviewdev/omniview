import React from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  Sheet,
  Table,
  Typography,
} from '@mui/joy';
import { formatTimeDifference } from '../../../utils/time';

type KubeEvent = {
  type?: string;
  involvedObject?: {
    kind?: string;
    name?: string;
  };
  reason?: string;
  message?: string;
  lastTimestamp?: string;
  eventTime?: string;
  metadata?: {
    namespace?: string;
    creationTimestamp?: string;
  };
};

type Props = {
  events: KubeEvent[];
  loading?: boolean;
};

function getEventTime(event: KubeEvent): Date {
  const raw = event.lastTimestamp || event.eventTime || event.metadata?.creationTimestamp;
  return raw ? new Date(raw) : new Date(0);
}

const EventsTable: React.FC<Props> = ({ events, loading }) => {
  const sorted = React.useMemo(() => {
    return [...events]
      .sort((a, b) => getEventTime(b).getTime() - getEventTime(a).getTime())
      .slice(0, 25);
  }, [events]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
        <CircularProgress size='sm' />
      </Box>
    );
  }

  if (sorted.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
        <Typography level='body-sm' sx={{ color: 'text.tertiary' }}>No recent events</Typography>
      </Box>
    );
  }

  return (
    <Sheet variant='outlined' sx={{ borderRadius: 'sm', overflow: 'auto' }}>
      <Table size='sm' stickyHeader sx={{ '& td': { py: 0.75 }, '& th': { py: 0.75 } }}>
        <thead>
          <tr>
            <th style={{ width: 80 }}>Type</th>
            <th style={{ width: 180 }}>Object</th>
            <th style={{ width: 130 }}>Reason</th>
            <th>Message</th>
            <th style={{ width: 70 }}>Age</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((event, i) => {
            const time = getEventTime(event);
            const obj = event.involvedObject;
            return (
              <tr key={i}>
                <td>
                  <Chip
                    size='sm'
                    variant='soft'
                    color={event.type === 'Warning' ? 'warning' : 'neutral'}
                  >
                    {event.type ?? 'Unknown'}
                  </Chip>
                </td>
                <td>
                  <Typography level='body-xs' noWrap>
                    {obj ? `${obj.kind?.toLowerCase() ?? ''}/${obj.name ?? ''}` : '-'}
                  </Typography>
                </td>
                <td>
                  <Typography level='body-xs'>{event.reason ?? '-'}</Typography>
                </td>
                <td>
                  <Typography level='body-xs' noWrap sx={{ maxWidth: 400 }}>
                    {event.message ?? '-'}
                  </Typography>
                </td>
                <td>
                  <Typography level='body-xs'>
                    {time.getTime() > 0 ? formatTimeDifference(time) : '-'}
                  </Typography>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Sheet>
  );
};

export default EventsTable;
