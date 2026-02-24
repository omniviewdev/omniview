import React from 'react';
import Box from '@mui/material/Box';
import { Card, Chip } from '@omniviewdev/ui';
import { Button } from '@omniviewdev/ui/buttons';
import { Select } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { LuArrowLeft } from 'react-icons/lu';
import type { ConnectionAttribute, EnrichedConnection } from '../../types/clusters';
import CompactClusterCard from './CompactClusterCard';

type Props = {
  connections: EnrichedConnection[];
  availableAttributes: ConnectionAttribute[];
  onConnectionClick: (connectionId: string) => void;
};

const MIN_COVERAGE = 0.3;

const GroupBrowser: React.FC<Props> = ({ connections, availableAttributes, onConnectionClick }) => {
  // Filter attributes to those with sufficient coverage
  const filteredAttributes = React.useMemo(
    () => availableAttributes.filter(a => a.coverage >= MIN_COVERAGE),
    [availableAttributes],
  );

  // Pick best default attribute
  const defaultAttr = React.useMemo(() => {
    if (filteredAttributes.length === 0) return undefined;
    const preferred = ['region', 'account', 'project', 'subscription', 'kubeconfig'];
    for (const key of preferred) {
      const attr = filteredAttributes.find(a => a.key === key);
      if (attr) return attr.key;
    }
    return filteredAttributes[0].key;
  }, [filteredAttributes]);

  const [browseBy, setBrowseBy] = React.useState<string>(defaultAttr ?? '');
  const [drillDown, setDrillDown] = React.useState<string | null>(null);

  // Update browseBy if default changes
  React.useEffect(() => {
    if (defaultAttr && !browseBy) setBrowseBy(defaultAttr);
  }, [defaultAttr]);

  if (filteredAttributes.length === 0) return null;

  const selectedAttr = filteredAttributes.find(a => a.key === browseBy);

  // Build groups -- skip connections without a value for the attribute
  const groups = React.useMemo(() => {
    if (!browseBy) return [];
    const map = new Map<string, EnrichedConnection[]>();
    for (const conn of connections) {
      const raw = conn.connection.labels?.[browseBy];
      if (raw === undefined || raw === null || raw === '') continue;
      const val = String(raw);
      const existing = map.get(val);
      if (existing) {
        existing.push(conn);
      } else {
        map.set(val, [conn]);
      }
    }
    // Sort by cluster count descending
    return Array.from(map.entries())
      .sort(([, a], [, b]) => b.length - a.length);
  }, [browseBy, connections]);

  // Drill-down view
  if (drillDown !== null) {
    const groupConns = groups.find(([key]) => key === drillDown)?.[1] ?? [];
    return (
      <Box>
        <Stack direction='row' alignItems='center' gap={1} sx={{ mb: 1 }}>
          <Button
            size='sm'
            emphasis='ghost'
            color='neutral'
            startAdornment={<LuArrowLeft size={14} />}
            onClick={() => setDrillDown(null)}
          >
            Back
          </Button>
          <Text weight='semibold' size='sm'>
            {selectedAttr?.displayName}: {drillDown}
          </Text>
          <Chip size='sm' emphasis='soft' color='neutral' label={String(groupConns.length)} />
        </Stack>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 1.5,
          }}
        >
          {groupConns.map(conn => (
            <CompactClusterCard
              key={conn.connection.id}
              enriched={conn}
              onClick={() => onConnectionClick(conn.connection.id)}
            />
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction='row' alignItems='center' gap={1} sx={{ mb: 1 }}>
        <Text weight='semibold' size='sm'>Browse by</Text>
        <Select
          size='sm'
          value={browseBy}
          onChange={(val) => { if (val) setBrowseBy(val as string); }}
          sx={{ minWidth: 120 }}
          options={filteredAttributes.map(attr => ({
            value: attr.key,
            label: attr.displayName,
          }))}
        />
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 1.5,
        }}
      >
        {groups.map(([value, conns]) => (
          <Card
            key={value}
            variant='outlined'
            onClick={() => setDrillDown(value)}
            sx={{
              cursor: 'pointer',
              p: 1.5,
              border: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
              bgcolor: 'var(--ov-bg-surface, rgba(255,255,255,0.03))',
              '&:hover': {
                borderColor: 'var(--ov-border-emphasis, rgba(255,255,255,0.15))',
                bgcolor: 'var(--ov-bg-surface-hover, rgba(255,255,255,0.05))',
                boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
              },
              transition: 'border-color 0.15s, background-color 0.15s, box-shadow 0.15s',
            }}
          >
            <Text weight='semibold' size='sm' noWrap>{value}</Text>
            <Text size='xs' sx={{ opacity: 0.6 }}>
              {conns.length} cluster{conns.length !== 1 ? 's' : ''}
            </Text>
          </Card>
        ))}
      </Box>
    </Box>
  );
};

export default GroupBrowser;
