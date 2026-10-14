import React from 'react';

import { Checkbox, Popover, RadioGroup } from '@omniviewdev/base-ui';

import styles from './PluginFilterPopover.module.css';

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
    <Popover.Root
      open={open && Boolean(anchorEl)}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      modal
    >
      <Popover.Portal>
        <Popover.Positioner anchor={anchorEl} side='bottom' align='end' sideOffset={4}>
          <Popover.Popup className={styles.Popup}>
            {/* Category */}
            <div className={styles.SectionTitle}>Category</div>
            <div className={styles.Options}>
              {CATEGORIES.map(cat => (
                <Checkbox
                  key={cat.value}
                  size='sm'
                  checked={filters.categories.has(cat.value)}
                  onCheckedChange={() => {
                    toggleCategory(cat.value);
                  }}
                  className={styles.Option}
                >
                  {cat.label}
                </Checkbox>
              ))}
            </div>

            {/* Sort */}
            <div className={`${styles.SectionTitle} ${styles.SortTitle}`}>Sort by</div>
            <div className={styles.SortOptions}>
              <RadioGroup
                size='sm'
                value={filters.sort}
                onValueChange={(v) => {
                  setSort(v as SortOption);
                }}
                aria-label='Sort by'
              >
                {SORT_OPTIONS.map(opt => (
                  <RadioGroup.Item key={opt.value} value={opt.value} className={styles.Option}>
                    {opt.label}
                  </RadioGroup.Item>
                ))}
              </RadioGroup>
            </div>

            {/* Clear all */}
            {activeCount > 0 && (
              <div className={styles.Footer}>
                <button type='button' onClick={clearAll} className={styles.ClearButton}>
                  Clear all filters
                </button>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
};

export function getActiveFilterCount(filters: FilterState): number {
  return filters.categories.size + (filters.sort !== 'name' ? 1 : 0);
}

export default PluginFilterPopover;
