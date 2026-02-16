import React from 'react';
import { Divider, ListItemDecorator, Select, Option } from '@mui/joy';
import { LuLayoutList, LuStar, LuBox, LuCircle, LuFolderOpen, LuLayers, LuTag, LuClock, LuScanSearch } from 'react-icons/lu';
import type { GroupByMode, ConnectionAttribute } from '../../types/clusters';

type Props = {
  value: GroupByMode;
  onChange: (value: GroupByMode) => void;
  hasCustomGroups: boolean;
  availableAttributes: ConnectionAttribute[];
  availableTags: string[];
};

// Base connection attributes always shown (if they have 2+ distinct values)
const BASE_ATTRIBUTES = new Set(['kubeconfig', 'cluster', 'user']);

const GroupBySelector: React.FC<Props> = ({
  value,
  onChange,
  hasCustomGroups,
  availableAttributes,
  availableTags,
}) => {
  const baseAttrs = availableAttributes.filter(a => BASE_ATTRIBUTES.has(a.key));
  const cloudAttrs = availableAttributes.filter(a => !BASE_ATTRIBUTES.has(a.key));
  const hasTags = availableTags.length > 0;

  return (
    <Select
      size='sm'
      variant='outlined'
      value={value}
      onChange={(_e, newValue) => { if (newValue) onChange(newValue as GroupByMode); }}
      sx={{ minWidth: 140 }}
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
      {/* Special modes */}
      <Option value='none'>
        <ListItemDecorator><LuLayoutList size={12} /></ListItemDecorator>
        No Grouping
      </Option>
      <Option value='favorites'>
        <ListItemDecorator><LuStar size={12} /></ListItemDecorator>
        Favorites
      </Option>
      <Option value='provider'>
        <ListItemDecorator><LuBox size={12} /></ListItemDecorator>
        Provider
      </Option>
      <Option value='status'>
        <ListItemDecorator><LuCircle size={12} /></ListItemDecorator>
        Status
      </Option>
      {hasCustomGroups && (
        <Option value='custom'>
          <ListItemDecorator><LuFolderOpen size={12} /></ListItemDecorator>
          Custom Groups
        </Option>
      )}
      {hasTags && (
        <Option value='tags'>
          <ListItemDecorator><LuTag size={12} /></ListItemDecorator>
          Tags
        </Option>
      )}
      <Option value='recent'>
        <ListItemDecorator><LuClock size={12} /></ListItemDecorator>
        Recent
      </Option>

      {/* Base connection attributes */}
      {baseAttrs.length > 0 && <Divider />}
      {baseAttrs.map(attr => (
        <Option key={`label:${attr.key}`} value={`label:${attr.key}` as GroupByMode}>
          <ListItemDecorator><LuLayers size={12} /></ListItemDecorator>
          {attr.displayName}
        </Option>
      ))}

      {/* Cloud/dynamic attributes */}
      {cloudAttrs.length > 0 && <Divider />}
      {cloudAttrs.length > 0 && (
        <Option value='__discovered_label__' disabled sx={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'text.tertiary', minHeight: 'auto', py: 0.25 }}>
          Discovered Attributes
        </Option>
      )}
      {cloudAttrs.map(attr => (
        <Option key={`label:${attr.key}`} value={`label:${attr.key}` as GroupByMode}>
          <ListItemDecorator><LuScanSearch size={12} /></ListItemDecorator>
          {attr.displayName}
        </Option>
      ))}
    </Select>
  );
};

export default GroupBySelector;
