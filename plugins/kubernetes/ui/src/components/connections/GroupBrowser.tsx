import React from 'react';
import { Box, Button, Card, Chip, Select, Option, Stack, Typography } from '@mui/joy';
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

  // Build groups — skip connections without a value for the attribute
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
            variant='plain'
            color='neutral'
            startDecorator={<LuArrowLeft size={14} />}
            onClick={() => setDrillDown(null)}
          >
            Back
          </Button>
          <Typography level='title-sm'>
            {selectedAttr?.displayName}: {drillDown}
          </Typography>
          <Chip size='sm' variant='soft' color='neutral'>{groupConns.length}</Chip>
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
        <Typography level='title-sm'>Browse by</Typography>
        <Select
          size='sm'
          variant='outlined'
          value={browseBy}
          onChange={(_e, val) => { if (val) setBrowseBy(val); }}
          sx={{ minWidth: 120 }}
        >
          {filteredAttributes.map(attr => (
            <Option key={attr.key} value={attr.key}>{attr.displayName}</Option>
          ))}
        </Select>
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
              '&:hover': { borderColor: 'primary.outlinedHoverBorder', boxShadow: 'sm' },
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
          >
            <Typography level='title-sm' noWrap>{value}</Typography>
            <Typography level='body-xs' sx={{ opacity: 0.6 }}>
              {conns.length} cluster{conns.length !== 1 ? 's' : ''}
            </Typography>
          </Card>
        ))}
      </Box>
    </Box>
  );
};

export default GroupBrowser;
