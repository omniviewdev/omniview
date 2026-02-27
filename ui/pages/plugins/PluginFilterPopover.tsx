import React from 'react';

import Box from '@mui/material/Box';
import Popover from '@mui/material/Popover';
import Checkbox from '@mui/material/Checkbox';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import { styled } from '@mui/material/styles';

const CATEGORIES = [
  { label: 'Cloud', value: 'cloud' },
  { label: 'Database', value: 'database' },
  { label: 'Monitoring', value: 'monitoring' },
  { label: 'Networking', value: 'networking' },
  { label: 'Security', value: 'security' },
  { label: 'DevOps', value: 'devops' },
  { label: 'Development', value: 'development' },
] as const;

export const SORT_OPTIONS = [
  { label: 'Name', value: 'name' },
  { label: 'Downloads', value: 'downloads' },
  { label: 'Rating', value: 'rating' },
  { label: 'Recently Updated', value: 'updated' },
] as const;

export type SortOption = typeof SORT_OPTIONS[number]['value'];

export type FilterState = {
  categories: Set<string>;
  sort: SortOption;
};

const SectionTitle = styled('div')({
  fontSize: '0.6875rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--ov-fg-faint, #8b949e)',
  padding: '8px 12px 4px',
});

const SmallFormLabel = styled(FormControlLabel)({
  marginLeft: -4,
  marginRight: 0,
  '& .MuiTypography-root': {
    fontSize: '0.75rem',
  },
  '& .MuiCheckbox-root, & .MuiRadio-root': {
    padding: 4,
  },
});

type Props = {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
};

const PluginFilterPopover: React.FC<Props> = ({
  anchorEl,
  open,
  onClose,
  filters,
  onFiltersChange,
}) => {
  const toggleCategory = (value: string) => {
    const next = new Set(filters.categories);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onFiltersChange({ ...filters, categories: next });
  };

  const setSort = (value: SortOption) => {
    onFiltersChange({ ...filters, sort: value });
  };

  const clearAll = () => {
    onFiltersChange({ categories: new Set(), sort: 'name' });
  };

  const activeCount = filters.categories.size + (filters.sort !== 'name' ? 1 : 0);

  return (
    <Popover
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          sx: {
            width: 200,
            backgroundColor: 'var(--ov-bg-surface, #161b22)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            mt: 0.5,
          },
        },
      }}
    >
      {/* Category */}
      <SectionTitle>Category</SectionTitle>
      <Box sx={{ px: 1, display: 'flex', flexDirection: 'column' }}>
        {CATEGORIES.map(cat => (
          <SmallFormLabel
            key={cat.value}
            control={
              <Checkbox
                size='small'
                checked={filters.categories.has(cat.value)}
                onChange={() => toggleCategory(cat.value)}
                sx={{ '& .MuiSvgIcon-root': { fontSize: 16 } }}
              />
            }
            label={cat.label}
          />
        ))}
      </Box>

      {/* Sort */}
      <SectionTitle sx={{ mt: 0.5 }}>Sort by</SectionTitle>
      <Box sx={{ px: 1, pb: 1 }}>
        <RadioGroup value={filters.sort} onChange={(_, v) => setSort(v as SortOption)}>
          {SORT_OPTIONS.map(opt => (
            <SmallFormLabel
              key={opt.value}
              value={opt.value}
              control={<Radio size='small' sx={{ '& .MuiSvgIcon-root': { fontSize: 16 } }} />}
              label={opt.label}
            />
          ))}
        </RadioGroup>
      </Box>

      {/* Clear all */}
      {activeCount > 0 && (
        <Box sx={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          px: 1.5,
          py: 1,
          display: 'flex',
          justifyContent: 'center',
        }}>
          <Box
            component='button'
            onClick={clearAll}
            sx={{
              fontSize: '0.6875rem',
              color: 'rgba(56,139,253,0.9)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              '&:hover': { color: 'rgba(56,139,253,1)' },
            }}
          >
            Clear all filters
          </Box>
        </Box>
      )}
    </Popover>
  );
};

export function getActiveFilterCount(filters: FilterState): number {
  return filters.categories.size + (filters.sort !== 'name' ? 1 : 0);
}

export default PluginFilterPopover;
