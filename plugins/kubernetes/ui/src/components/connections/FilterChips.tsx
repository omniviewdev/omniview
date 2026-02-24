import React from 'react';
import { Chip } from '@omniviewdev/ui';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { LuX } from 'react-icons/lu';
import type { FilterState, ConnectionAttribute } from '../../types/clusters';
import { getProviderLabel } from '../../utils/providers';

type Props = {
  filters: FilterState;
  availableProviders: string[];
  availableAttributes: ConnectionAttribute[];
  availableTags: string[];
  onToggleProvider: (provider: string) => void;
  onToggleStatus: (status: 'connected' | 'disconnected') => void;
  onToggleTag: (tag: string) => void;
  onToggleLabelFilter: (key: string, value: string) => void;
  onClearAll: () => void;
};

const FilterChips: React.FC<Props> = ({
  filters,
  availableProviders,
  availableAttributes,
  availableTags,
  onToggleProvider,
  onToggleStatus,
  onToggleTag,
  onToggleLabelFilter,
  onClearAll,
}) => {
  const hasActiveFilters =
    (filters.providers?.length ?? 0) > 0 ||
    (filters.status?.length ?? 0) > 0 ||
    (filters.tags?.length ?? 0) > 0 ||
    Object.values(filters.labels ?? {}).some(v => v.length > 0);

  const showProviders = availableProviders.length > 1;
  const showTags = availableTags.length > 0;

  // Show attribute filter chips for high-coverage attributes with 2-8 distinct values
  const filterableAttrs = availableAttributes.filter(
    a => a.coverage >= 0.3 && a.distinctValues.length >= 2 && a.distinctValues.length <= 8,
  );

  if (!showProviders && !showTags && filterableAttrs.length === 0 && !hasActiveFilters) return null;

  return (
    <Stack
      direction='row'
      gap={0.75}
      sx={{ flexWrap: 'wrap', alignItems: 'center' }}
    >
      {/* Provider chips */}
      {showProviders && availableProviders.map(provider => (
        <Chip
          key={provider}
          size='xs'
          emphasis={filters.providers?.includes(provider) ? 'soft' : 'outline'}
          color={filters.providers?.includes(provider) ? 'primary' : 'neutral'}
          onClick={() => onToggleProvider(provider)}
          sx={{ cursor: 'pointer' }}
          label={getProviderLabel(provider)}
        />
      ))}

      {/* Status chips */}
      <Chip
        size='xs'
        emphasis={filters.status?.includes('connected') ? 'soft' : 'outline'}
        color={filters.status?.includes('connected') ? 'success' : 'neutral'}
        onClick={() => onToggleStatus('connected')}
        sx={{ cursor: 'pointer' }}
        label='Connected'
      />
      <Chip
        size='xs'
        emphasis={filters.status?.includes('disconnected') ? 'soft' : 'outline'}
        color='neutral'
        onClick={() => onToggleStatus('disconnected')}
        sx={{ cursor: 'pointer' }}
        label='Disconnected'
      />

      {/* Tag chips */}
      {showTags && (
        <>
          <Text size='xs' sx={{ opacity: 0.5, px: 0.5 }}>|</Text>
          {availableTags.map(tag => (
            <Chip
              key={`tag:${tag}`}
              size='xs'
              emphasis={filters.tags?.includes(tag) ? 'soft' : 'outline'}
              color={filters.tags?.includes(tag) ? 'warning' : 'neutral'}
              onClick={() => onToggleTag(tag)}
              sx={{ cursor: 'pointer' }}
              label={tag}
            />
          ))}
        </>
      )}

      {/* Dynamic attribute filter chips */}
      {filterableAttrs.map(attr => (
        <React.Fragment key={`attr:${attr.key}`}>
          <Text size='xs' sx={{ opacity: 0.5, px: 0.5 }}>|</Text>
          {attr.distinctValues.map(val => {
            const isActive = filters.labels?.[attr.key]?.includes(val) ?? false;
            return (
              <Chip
                key={`${attr.key}:${val}`}
                size='xs'
                emphasis={isActive ? 'soft' : 'outline'}
                color={isActive ? 'primary' : 'neutral'}
                onClick={() => onToggleLabelFilter(attr.key, val)}
                sx={{ cursor: 'pointer' }}
                label={val}
              />
            );
          })}
        </React.Fragment>
      ))}

      {/* Clear all */}
      {hasActiveFilters && (
        <Chip
          size='xs'
          emphasis='outline'
          color='danger'
          onClick={onClearAll}
          endAdornment={<LuX size={12} />}
          sx={{ cursor: 'pointer' }}
          label='Clear'
        />
      )}
    </Stack>
  );
};

export default FilterChips;
