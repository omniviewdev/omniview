import React from 'react';
import Box from '@mui/material/Box';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { SiKubernetes } from 'react-icons/si';
import SearchInput from '../shared/SearchInput';
import GroupBySelector from './GroupBySelector';
import SortBySelector from './SortBySelector';
import ViewModeToggle from './ViewModeToggle';
import type { GroupByMode, SortByField, SortDirection, ViewMode, ConnectionAttribute } from '../../types/clusters';

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  groupBy: GroupByMode;
  onGroupByChange: (value: GroupByMode) => void;
  sortBy: SortByField;
  onSortByChange: (value: SortByField) => void;
  sortDirection: SortDirection;
  onSortDirectionChange: (value: SortDirection) => void;
  viewMode: ViewMode;
  onViewModeChange: (value: ViewMode) => void;
  totalCount: number;
  filteredCount: number;
  hasCustomGroups: boolean;
  availableAttributes: ConnectionAttribute[];
  availableTags: string[];
};

const ClustersToolbar: React.FC<Props> = ({
  search,
  onSearchChange,
  groupBy,
  onGroupByChange,
  sortBy,
  onSortByChange,
  sortDirection,
  onSortDirectionChange,
  viewMode,
  onViewModeChange,
  totalCount,
  filteredCount,
  hasCustomGroups,
  availableAttributes,
  availableTags,
}) => (
  <Box
    sx={{
      px: 1,
      py: 0.5,
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      borderRadius: 'var(--ov-radius-md, 6px)',
      gap: 0.5,
      border: '1px solid var(--ov-border-default, rgba(255,255,255,0.08))',
      bgcolor: 'var(--ov-bg-surface, rgba(255,255,255,0.03))',
    }}
  >
    <Stack
      direction='row'
      alignItems='center'
      justifyContent='space-between'
      gap={1}
    >
      {/* Left: title + count */}
      <Stack direction='row' alignItems='center' gap={0.75} pl={0.25}>
        <SiKubernetes size={16} />
        <Text size='sm' weight='semibold'>Clusters</Text>
        <Chip size='xs' emphasis='soft' color='neutral' label={filteredCount < totalCount ? `${filteredCount}/${totalCount}` : String(totalCount)} />
      </Stack>

      {/* Right: controls */}
      <Stack direction='row' alignItems='center' gap={0.75}>
        <SearchInput
          placeholder='Search clusters...'
          value={search}
          onChange={onSearchChange}
          autoFocus
        />
        <GroupBySelector
          value={groupBy}
          onChange={onGroupByChange}
          hasCustomGroups={hasCustomGroups}
          availableAttributes={availableAttributes}
          availableTags={availableTags}
        />
        <SortBySelector
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSortByChange={onSortByChange}
          onSortDirectionChange={onSortDirectionChange}
          availableAttributes={availableAttributes}
        />
        <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
      </Stack>
    </Stack>
  </Box>
);

export default ClustersToolbar;
