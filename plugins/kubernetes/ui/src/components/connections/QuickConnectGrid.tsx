import React, { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import { IconButton } from '@omniviewdev/ui/buttons';
import { TextField } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';
import { Tooltip } from '@omniviewdev/ui/overlays';
import { Text } from '@omniviewdev/ui/typography';
import { LuSearch, LuFolderPlus } from 'react-icons/lu';
import type { EnrichedConnection } from '../../types/clusters';
import RowHandler from './RowHandler';

type Props = {
  connections: EnrichedConnection[];
  onRecordAccess: (connectionId: string) => void;
  onToggleFavorite: (connectionId: string) => void;
  onCreateFolder?: () => void;
};

const QuickConnectGrid: React.FC<Props> = ({
  connections,
  onRecordAccess,
  onToggleFavorite,
  onCreateFolder,
}) => {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return connections;
    return connections.filter(c => {
      if (c.displayName.toLowerCase().includes(q)) return true;
      if (c.connection.name.toLowerCase().includes(q)) return true;
      if (c.provider.toLowerCase().includes(q)) return true;
      // Search label values
      const labels = c.connection.labels;
      if (labels) {
        for (const v of Object.values(labels)) {
          if (typeof v === 'string' && v.toLowerCase().includes(q)) return true;
        }
      }
      return false;
    });
  }, [connections, search]);

  return (
    <Stack gap={1} sx={{ px: 0.5, pt: 0.5 }}>
      <Stack direction='row' alignItems='center' justifyContent='space-between' gap={1}>
        <Stack direction='row' alignItems='center' gap={0.75}>
          <Text weight='semibold'>
            All Clusters ({connections.length})
          </Text>
          {onCreateFolder && (
            <Tooltip content='Create folder'>
              <IconButton
                size='sm'
                emphasis='ghost'
                color='neutral'
                onClick={() => onCreateFolder?.()}
              >
                <LuFolderPlus size={16} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <TextField
          size='sm'
          placeholder='Search clusters...'
          startAdornment={<LuSearch size={14} />}
          value={search}
          onChange={e => setSearch(e)}
          autoFocus
          sx={{ maxWidth: 240 }}
        />
      </Stack>
      {filtered.length === 0 ? (
        <Text size='sm' sx={{ textAlign: 'center', py: 3, opacity: 0.5 }}>
          No clusters match '{search}'
        </Text>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 1,
          }}
        >
          {filtered.map(enriched => (
            <RowHandler
              key={enriched.connection.id}
              enriched={enriched}
              sectionId='all-clusters'
              showFavorite
              onRecordAccess={() => onRecordAccess(enriched.connection.id)}
              onToggleFavorite={() => onToggleFavorite(enriched.connection.id)}
            />
          ))}
        </Box>
      )}
    </Stack>
  );
};

export default QuickConnectGrid;
