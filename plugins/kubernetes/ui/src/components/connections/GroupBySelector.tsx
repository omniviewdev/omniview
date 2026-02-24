import React from 'react';
import { Select } from '@omniviewdev/ui/inputs';
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
      value={value}
      onChange={(newValue) => { if (newValue) onChange(newValue as GroupByMode); }}
      sx={{ minWidth: 140 }}
      options={[
        { value: 'none', label: 'No Grouping' },
        { value: 'favorites', label: 'Favorites' },
        { value: 'provider', label: 'Provider' },
        { value: 'status', label: 'Status' },
        ...(hasCustomGroups ? [{ value: 'custom', label: 'Custom Groups' }] : []),
        ...(hasTags ? [{ value: 'tags', label: 'Tags' }] : []),
        { value: 'recent', label: 'Recent' },
        ...baseAttrs.map(attr => ({
          value: `label:${attr.key}`,
          label: attr.displayName,
        })),
        ...cloudAttrs.map(attr => ({
          value: `label:${attr.key}`,
          label: attr.displayName,
        })),
      ]}
    />
  );
};

export default GroupBySelector;
