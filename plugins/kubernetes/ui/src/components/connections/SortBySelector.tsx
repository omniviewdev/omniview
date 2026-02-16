import React from 'react';
import { Divider, ListItemDecorator, Select, Option, IconButton, Stack } from '@mui/joy';
import { LuArrowUp, LuArrowDown, LuTextCursorInput, LuBox, LuCircle, LuClock, LuScanSearch } from 'react-icons/lu';
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
        variant='outlined'
        value={sortBy}
        onChange={(_e, newValue) => { if (newValue) onSortByChange(newValue as SortByField); }}
        sx={{ minWidth: 120 }}
        slotProps={{
          button: { sx: { whiteSpace: 'nowrap' } },
          listbox: {
            sx: {
              fontSize: '0.75rem',
              '--List-padding': '3px',
              '--ListItem-minHeight': '28px',
              '--ListItemDecorator-size': '22px',
              '--ListItem-paddingY': '2px',
              '--ListItem-paddingX': '6px',
              '--ListDivider-gap': '3px',
            },
          },
        }}
      >
        {/* Computed sort fields */}
        <Option value='name'>
          <ListItemDecorator><LuTextCursorInput size={12} /></ListItemDecorator>
          Name
        </Option>
        <Option value='provider'>
          <ListItemDecorator><LuBox size={12} /></ListItemDecorator>
          Provider
        </Option>
        <Option value='status'>
          <ListItemDecorator><LuCircle size={12} /></ListItemDecorator>
          Status
        </Option>
        <Option value='recency'>
          <ListItemDecorator><LuClock size={12} /></ListItemDecorator>
          Recently Used
        </Option>

        {/* Dynamic label-based sort */}
        {sortableAttrs.length > 0 && <Divider />}
        {sortableAttrs.length > 0 && (
          <Option value='__discovered_label__' disabled sx={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'text.tertiary', minHeight: 'auto', py: 0.25 }}>
            Discovered Attributes
          </Option>
        )}
        {sortableAttrs.map(attr => (
          <Option key={`label:${attr.key}`} value={`label:${attr.key}` as SortByField}>
            <ListItemDecorator><LuScanSearch size={12} /></ListItemDecorator>
            {attr.displayName}
          </Option>
        ))}
      </Select>
      <IconButton
        size='sm'
        variant='outlined'
        color='neutral'
        onClick={() => onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc')}
      >
        {sortDirection === 'asc' ? <LuArrowUp size={16} /> : <LuArrowDown size={16} />}
      </IconButton>
    </Stack>
  );
};

export default SortBySelector;
