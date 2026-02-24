import React from 'react';
import { Select } from '@omniviewdev/ui/inputs';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { LuArrowUp, LuArrowDown } from 'react-icons/lu';
import type { SortByField, SortDirection, ConnectionAttribute } from '../../types/clusters';

type Props = {
  sortBy: SortByField;
  sortDirection: SortDirection;
  onSortByChange: (value: SortByField) => void;
  onSortDirectionChange: (value: SortDirection) => void;
  availableAttributes: ConnectionAttribute[];
};

const SortBySelector: React.FC<Props> = ({
  sortBy,
  sortDirection,
  onSortByChange,
  onSortDirectionChange,
  availableAttributes,
}) => {
  // Only show attributes with reasonable coverage for sorting
  const sortableAttrs = availableAttributes.filter(a => a.coverage >= 0.1);

  return (
    <Stack direction='row' alignItems='center' gap={0.5}>
      <Select
        size='sm'
        value={sortBy}
        onChange={(newValue) => { if (newValue) onSortByChange(newValue as SortByField); }}
        sx={{ minWidth: 120 }}
        options={[
          { value: 'name', label: 'Name' },
          { value: 'provider', label: 'Provider' },
          { value: 'status', label: 'Status' },
          { value: 'recency', label: 'Recently Used' },
          ...sortableAttrs.map(attr => ({
            value: `label:${attr.key}`,
            label: attr.displayName,
          })),
        ]}
      />
      <IconButton
        size='sm'
        emphasis='outline'
        color='neutral'
        onClick={() => onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc')}
      >
        {sortDirection === 'asc' ? <LuArrowUp size={16} /> : <LuArrowDown size={16} />}
      </IconButton>
    </Stack>
  );
};

export default SortBySelector;
