import React from 'react';
import { Chip, Stack, Typography } from '@mui/joy';
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
          size='sm'
          variant={filters.providers?.includes(provider) ? 'soft' : 'outlined'}
          color={filters.providers?.includes(provider) ? 'primary' : 'neutral'}
          onClick={() => onToggleProvider(provider)}
          sx={{ cursor: 'pointer' }}
        >
          {getProviderLabel(provider)}
        </Chip>
      ))}

      {/* Status chips */}
      <Chip
        size='sm'
        variant={filters.status?.includes('connected') ? 'soft' : 'outlined'}
        color={filters.status?.includes('connected') ? 'success' : 'neutral'}
        onClick={() => onToggleStatus('connected')}
        sx={{ cursor: 'pointer' }}
      >
        Connected
      </Chip>
      <Chip
        size='sm'
        variant={filters.status?.includes('disconnected') ? 'soft' : 'outlined'}
        color={filters.status?.includes('disconnected') ? 'neutral' : 'neutral'}
        onClick={() => onToggleStatus('disconnected')}
        sx={{ cursor: 'pointer' }}
      >
        Disconnected
      </Chip>

      {/* Tag chips */}
      {showTags && (
        <>
          <Typography level='body-xs' sx={{ opacity: 0.5, px: 0.5 }}>|</Typography>
          {availableTags.map(tag => (
            <Chip
              key={`tag:${tag}`}
              size='sm'
              variant={filters.tags?.includes(tag) ? 'soft' : 'outlined'}
              color={filters.tags?.includes(tag) ? 'warning' : 'neutral'}
              onClick={() => onToggleTag(tag)}
              sx={{ cursor: 'pointer' }}
            >
              {tag}
            </Chip>
          ))}
        </>
      )}

      {/* Dynamic attribute filter chips */}
      {filterableAttrs.map(attr => (
        <React.Fragment key={`attr:${attr.key}`}>
          <Typography level='body-xs' sx={{ opacity: 0.5, px: 0.5 }}>|</Typography>
          {attr.distinctValues.map(val => {
            const isActive = filters.labels?.[attr.key]?.includes(val) ?? false;
            return (
              <Chip
                key={`${attr.key}:${val}`}
                size='sm'
                variant={isActive ? 'soft' : 'outlined'}
                color={isActive ? 'primary' : 'neutral'}
                onClick={() => onToggleLabelFilter(attr.key, val)}
                sx={{ cursor: 'pointer' }}
              >
                {val}
              </Chip>
            );
          })}
        </React.Fragment>
      ))}

      {/* Clear all */}
      {hasActiveFilters && (
        <Chip
          size='sm'
          variant='outlined'
          color='danger'
          onClick={onClearAll}
          endDecorator={<LuX size={12} />}
          sx={{ cursor: 'pointer' }}
        >
          Clear
        </Chip>
      )}
    </Stack>
  );
};

export default FilterChips;
