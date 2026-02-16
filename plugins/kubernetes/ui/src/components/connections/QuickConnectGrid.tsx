import React, { useMemo, useState } from 'react';
import { Box, IconButton, Input, Stack, Tooltip, Typography } from '@mui/joy';
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
          <Typography level='title-md'>
            All Clusters ({connections.length})
          </Typography>
          {onCreateFolder && (
            <Tooltip title='Create folder' size='sm'>
              <IconButton
                size='sm'
                variant='plain'
                color='neutral'
                onClick={() => onCreateFolder?.()}
                sx={{ '--IconButton-size': '28px' }}
              >
                <LuFolderPlus size={16} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <Input
          size='sm'
          placeholder='Search clusters...'
          startDecorator={<LuSearch size={14} />}
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
          sx={{ maxWidth: 240 }}
        />
      </Stack>
      {filtered.length === 0 ? (
        <Typography level='body-sm' textAlign='center' sx={{ py: 3, opacity: 0.5 }}>
          No clusters match '{search}'
        </Typography>
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
