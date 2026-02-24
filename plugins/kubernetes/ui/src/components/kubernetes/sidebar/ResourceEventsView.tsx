import React, { useState, useMemo } from 'react';
import Box from '@mui/material/Box';
import { Chip } from '@omniviewdev/ui';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { EventsList, Timeline } from '@omniviewdev/ui/domain';
import { LuList, LuGitCommitHorizontal } from 'react-icons/lu';
import type { DrawerContext } from '@omniviewdev/runtime';

import { useResourceEvents } from '../../../hooks/useResourceEvents';

type EventFilter = 'all' | 'Normal' | 'Warning';

type ResourceEventsViewProps = {
  ctx: DrawerContext;
};

const ResourceEventsView: React.FC<ResourceEventsViewProps> = ({ ctx }) => {
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [filter, setFilter] = useState<EventFilter>('all');

  const data = (ctx.data ?? {}) as Record<string, unknown>;
  const metadata = data.metadata as Record<string, unknown> | undefined;
  const resourceName = (metadata?.name as string) ?? '';
  const namespace = (metadata?.namespace as string) ?? '';

  const pluginID = ctx.resource?.pluginID ?? '';
  const connectionID = ctx.resource?.connectionID ?? '';
  const resourceKey = ctx.resource?.key ?? '';

  const { events, timelineEvents, isLoading, warningCount } = useResourceEvents({
    pluginID,
    connectionID,
    resourceKey,
    resourceName,
    namespace,
    enabled: !!pluginID && !!connectionID && !!resourceKey && !!resourceName,
  });

  const filteredEvents = useMemo(
    () => (filter === 'all' ? events : events.filter((e) => e.type === filter)),
    [events, filter],
  );

  const filteredTimelineEvents = useMemo(() => {
    if (filter === 'all') return timelineEvents;
    const color = filter === 'Warning' ? 'warning' : 'info';
    return timelineEvents.filter((e) => e.color === color);
  }, [timelineEvents, filter]);

  if (!pluginID || !connectionID || !resourceKey) {
    return null;
  }

  return (
    <Stack direction="column" gap={0} sx={{ width: '100%', flex: 1 }}>
      {/* Header bar */}
      <Stack
        direction="row"
        align="center"
        justify="between"
        sx={{ px: 1.5, py: 1, borderBottom: '1px solid var(--ov-border-muted)' }}
      >
        <Stack direction="row" align="center" gap={1}>
          <Text weight="semibold" size="sm">
            {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
          </Text>
          {warningCount > 0 && (
            <Chip
              label={`${warningCount} warning${warningCount !== 1 ? 's' : ''}`}
              color="warning"
              emphasis="soft"
              size="xs"
            />
          )}
        </Stack>

        <Stack direction="row" align="center" gap={0.5}>
          <IconButton
            emphasis={viewMode === 'list' ? 'soft' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
          >
            <LuList size={14} />
          </IconButton>
          <IconButton
            emphasis={viewMode === 'timeline' ? 'soft' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('timeline')}
          >
            <LuGitCommitHorizontal size={14} />
          </IconButton>
        </Stack>
      </Stack>

      {/* Filter chips */}
      <Stack direction="row" gap={0.5} sx={{ px: 1.5, py: 0.75 }}>
        {(['all', 'Normal', 'Warning'] as EventFilter[]).map((f) => (
          <Chip
            key={f}
            label={f === 'all' ? 'All' : f}
            size="xs"
            emphasis={filter === f ? 'soft' : 'outline'}
            color={f === 'Warning' ? 'warning' : f === 'Normal' ? 'info' : 'neutral'}
            onClick={() => setFilter(f)}
          />
        ))}
      </Stack>

      {/* Content */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: viewMode === 'timeline' ? 1.5 : 0, py: viewMode === 'timeline' ? 1 : 0 }}>
        {viewMode === 'list' ? (
          <EventsList events={filteredEvents} loading={isLoading} />
        ) : (
          <Timeline events={filteredTimelineEvents} size="sm" />
        )}
      </Box>
    </Stack>
  );
};

export default ResourceEventsView;
