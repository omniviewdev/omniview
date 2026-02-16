import React from 'react';
import { Sheet, Stack, Typography, Chip } from '@mui/joy';
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
  <Sheet
    sx={{
      px: 1,
      py: 0.75,
      backgroundColor: 'background.surface',
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      borderRadius: 'sm',
      gap: 0.75,
    }}
    variant='outlined'
  >
    <Stack
      direction='row'
      alignItems='center'
      justifyContent='space-between'
      gap={1}
    >
      {/* Left: title + count */}
      <Stack direction='row' alignItems='center' gap={1} pl={0.5}>
        <SiKubernetes size={20} />
        <Typography fontSize={16} fontWeight={600}>Clusters</Typography>
        <Chip size='sm' variant='soft' color='neutral'>
          {filteredCount < totalCount ? `${filteredCount}/${totalCount}` : totalCount}
        </Chip>
      </Stack>

      {/* Right: controls */}
      <Stack direction='row' alignItems='center' gap={1}>
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
  </Sheet>
);

export default ClustersToolbar;
