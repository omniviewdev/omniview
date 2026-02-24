import React, { useState, useMemo, useDeferredValue, useCallback } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import { Chip, CircularProgress } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { useRightDrawer } from '@omniviewdev/runtime';
import { LuSearch } from 'react-icons/lu';

import { formatTimeDifference } from '../../../utils/time';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KubeEvent = {
  type?: string;
  involvedObject?: {
    kind?: string;
    name?: string;
    namespace?: string;
  };
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  firstTimestamp?: string;
  eventTime?: string;
  metadata?: {
    namespace?: string;
    creationTimestamp?: string;
  };
};

type DedupedEvent = {
  type: string;
  kind: string;
  name: string;
  namespace: string;
  reason: string;
  message: string;
  count: number;
  lastSeen: Date;
  firstSeen: Date;
};

type EventFilter = 'all' | 'Normal' | 'Warning';

type Props = {
  events: KubeEvent[];
  loading?: boolean;
  connectionID: string;
};

// ---------------------------------------------------------------------------
// Kind -> resource key mapping for sidebar navigation
// ---------------------------------------------------------------------------

const KIND_TO_KEY: Record<string, string> = {
  Pod: 'core::v1::Pod',
  Node: 'core::v1::Node',
  Service: 'core::v1::Service',
  Deployment: 'apps::v1::Deployment',
  StatefulSet: 'apps::v1::StatefulSet',
  DaemonSet: 'apps::v1::DaemonSet',
  ReplicaSet: 'apps::v1::ReplicaSet',
  Job: 'batch::v1::Job',
  CronJob: 'batch::v1::CronJob',
  ConfigMap: 'core::v1::ConfigMap',
  Secret: 'core::v1::Secret',
  Ingress: 'networking.k8s.io::v1::Ingress',
  PersistentVolumeClaim: 'core::v1::PersistentVolumeClaim',
  PersistentVolume: 'core::v1::PersistentVolume',
  Namespace: 'core::v1::Namespace',
  ServiceAccount: 'core::v1::ServiceAccount',
  Endpoints: 'core::v1::Endpoints',
  ReplicationController: 'core::v1::ReplicationController',
  HorizontalPodAutoscaler: 'autoscaling::v1::HorizontalPodAutoscaler',
  Lease: 'coordination.k8s.io::v1::Lease',
  EndpointSlice: 'discovery.k8s.io::v1::EndpointSlice',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTimestamp(event: KubeEvent): Date {
  const raw = event.lastTimestamp || event.eventTime || event.firstTimestamp || event.metadata?.creationTimestamp;
  return raw ? new Date(raw) : new Date(0);
}

function getFirstTimestamp(event: KubeEvent): Date {
  const raw = event.firstTimestamp || event.metadata?.creationTimestamp || event.eventTime || event.lastTimestamp;
  return raw ? new Date(raw) : new Date(0);
}

function deduplicateEvents(events: KubeEvent[]): DedupedEvent[] {
  const map = new Map<string, DedupedEvent>();

  for (const ev of events) {
    const io = ev.involvedObject;
    const kind = io?.kind ?? '';
    const name = io?.name ?? '';
    const ns = io?.namespace ?? ev.metadata?.namespace ?? '';
    const reason = ev.reason ?? '';
    const key = `${kind}/${ns}/${name}::${reason}`;

    const lastSeen = getTimestamp(ev);
    const firstSeen = getFirstTimestamp(ev);
    const count = ev.count ?? 1;

    const existing = map.get(key);
    if (existing) {
      existing.count += count;
      if (lastSeen > existing.lastSeen) {
        existing.lastSeen = lastSeen;
        existing.message = ev.message ?? existing.message;
        existing.type = ev.type ?? existing.type;
      }
      if (firstSeen < existing.firstSeen) {
        existing.firstSeen = firstSeen;
      }
    } else {
      map.set(key, {
        type: ev.type ?? 'Normal',
        kind,
        name,
        namespace: ns,
        reason,
        message: ev.message ?? '',
        count,
        lastSeen,
        firstSeen,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
}

// ---------------------------------------------------------------------------
// Event Row
// ---------------------------------------------------------------------------

const EventRow: React.FC<{
  event: DedupedEvent;
  onObjectClick?: (event: DedupedEvent) => void;
}> = React.memo(({ event, onObjectClick }) => {
  const hasLink = !!KIND_TO_KEY[event.kind] && !!event.name;
  const objectLabel = event.kind
    ? `${event.kind}/${event.name}${event.namespace ? ` (${event.namespace})` : ''}`
    : '';

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
      {/* Type badge */}
      <Chip
        size='xs'
        emphasis='soft'
        color={event.type === 'Warning' ? 'warning' : 'info'}
        label={event.type}
        sx={{ flexShrink: 0, mt: 0.25, minWidth: 56, justifyContent: 'center' }}
      />

      {/* Content */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
          <Text weight='semibold' size='xs' sx={{ color: 'var(--ov-fg-base)', flexShrink: 0 }}>
            {event.reason}
          </Text>
          <Box sx={{ width: '1px', height: 10, bgcolor: 'divider', flexShrink: 0, alignSelf: 'center' }} />
          <Text size='xs' sx={{ color: 'var(--ov-fg-default)' }} noWrap>
            {event.message}
          </Text>
        </Box>
        {objectLabel && (
          <Box
            component='span'
            onClick={hasLink && onObjectClick ? () => onObjectClick(event) : undefined}
            sx={{
              display: 'block',
              fontSize: '0.75rem',
              color: hasLink ? 'var(--ov-accent)' : 'var(--ov-fg-muted)',
              mt: 0.25,
              cursor: hasLink ? 'pointer' : 'default',
              '&:hover': hasLink ? { textDecoration: 'underline' } : undefined,
            }}
          >
            {objectLabel}
          </Box>
        )}
      </Box>

      {/* Count + Age */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        {event.count > 1 && (
          <Chip
            size='xs'
            emphasis='outline'
            color='neutral'
            label={`\u00d7${event.count}`}
          />
        )}
        <Text size='xs' sx={{ color: 'var(--ov-fg-faint)', whiteSpace: 'nowrap' }}>
          {event.lastSeen.getTime() > 0 ? formatTimeDifference(event.lastSeen) : '-'}
        </Text>
      </Box>
    </Box>
  );
});

EventRow.displayName = 'EventRow';

// ---------------------------------------------------------------------------
// EventsTable
// ---------------------------------------------------------------------------

const EventsTable: React.FC<Props> = ({ events, loading, connectionID }) => {
  const [filter, setFilter] = useState<EventFilter>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const { showResourceSidebar } = useRightDrawer();

  const deduped = useMemo(() => deduplicateEvents(events), [events]);

  const warningCount = useMemo(
    () => deduped.filter((e) => e.type === 'Warning').length,
    [deduped],
  );

  const filtered = useMemo(() => {
    let result = deduped;

    // Type filter
    if (filter !== 'all') {
      result = result.filter((e) => e.type === filter);
    }

    // Search filter
    if (deferredSearch) {
      const q = deferredSearch.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.reason.toLowerCase().includes(q) ||
          e.message.toLowerCase().includes(q),
      );
    }

    return result;
  }, [deduped, filter, deferredSearch]);

  const handleObjectClick = useCallback(
    (event: DedupedEvent) => {
      const resourceKey = KIND_TO_KEY[event.kind];
      if (!resourceKey || !connectionID) return;

      showResourceSidebar({
        pluginID: 'kubernetes',
        connectionID,
        resourceKey,
        resourceID: event.name,
        namespace: event.namespace || undefined,
      });
    },
    [connectionID, showResourceSidebar],
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
        <CircularProgress size='sm' />
      </Box>
    );
  }

  return (
    <Stack gap={0} sx={{ height: '100%' }}>
      {/* Toolbar: filter chips + search */}
      <Stack
        direction='row'
        align='center'
        justify='between'
        sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Stack direction='row' align='center' gap={0.5}>
          {(['all', 'Normal', 'Warning'] as EventFilter[]).map((f) => (
            <Chip
              key={f}
              label={f === 'all' ? 'All' : f}
              size='xs'
              emphasis={filter === f ? 'solid' : 'outline'}
              color={f === 'Warning' ? 'warning' : f === 'Normal' ? 'info' : 'neutral'}
              onClick={() => setFilter(f)}
            />
          ))}
          {warningCount > 0 && (
            <Chip
              label={`${warningCount} warning${warningCount !== 1 ? 's' : ''}`}
              color='warning'
              emphasis='soft'
              size='xs'
            />
          )}
        </Stack>

        <TextField
          size='small'
          placeholder='Search events...'
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position='start'>
                  <LuSearch size={12} />
                </InputAdornment>
              ),
            },
          }}
          sx={{
            width: 180,
            '--ov-input-height': '24px',
            '& .MuiInputBase-root': {
              fontSize: '0.6875rem',
              px: 0.75,
            },
            '& .MuiInputBase-input': {
              py: 0,
              px: 0.5,
            },
          } as any}
        />
      </Stack>

      {/* Event list */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
            <Text size='sm' sx={{ color: 'text.tertiary' }}>
              {events.length === 0 ? 'No recent events' : 'No matching events'}
            </Text>
          </Box>
        ) : (
          filtered.map((event, i) => (
            <EventRow key={`${event.kind}/${event.namespace}/${event.name}::${event.reason}::${i}`} event={event} onObjectClick={handleObjectClick} />
          ))
        )}
      </Box>
    </Stack>
  );
};

export default EventsTable;
