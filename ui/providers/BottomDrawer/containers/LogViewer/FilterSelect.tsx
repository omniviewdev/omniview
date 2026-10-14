import React, { useRef, useMemo, useCallback } from 'react';
import { Button, Checkbox, Popover, SearchInput } from '@omniviewdev/base-ui';
import { LuChevronDown, LuSearch } from 'react-icons/lu';
import { useVirtualizer } from '@tanstack/react-virtual';
import styles from './FilterSelect.module.css';

type FilterSelectProps = {
  label: string;
  items: string[];
  selectedItems: Set<string>;
  allSelected: boolean;
  onToggleItem: (item: string) => void;
  onToggleAll: () => void;
  searchThreshold?: number;
  /** Controlled open state — parent manages which dropdown is open. */
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const VIRTUAL_THRESHOLD = 50;
const ROW_HEIGHT = 28;

const FilterSelect: React.FC<FilterSelectProps> = ({
  label,
  items,
  selectedItems,
  allSelected,
  onToggleItem,
  onToggleAll,
  searchThreshold = 10,
  isOpen,
  onOpenChange,
}) => {
  const [search, setSearch] = React.useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const showSearch = items.length >= searchThreshold;
  const indeterminate = selectedItems.size > 0 && !allSelected;

  const triggerLabel = allSelected
    ? `All ${label}`
    : `${selectedItems.size}/${items.length} ${label}`;

  const filteredItems = useMemo(() => {
    if (!search) {
      return items;
    }

    const lower = search.toLowerCase();
    return items.filter((item) => item.toLowerCase().includes(lower));
  }, [items, search]);

  const useVirtual = filteredItems.length > VIRTUAL_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    enabled: useVirtual,
  });

  const handleOpenChange = useCallback(
    (open: boolean) => {
      onOpenChange(open);
      if (!open) {
        setSearch('');
      }
    },
    [onOpenChange],
  );

  const renderRow = useCallback(
    (item: string, style?: React.CSSProperties) => (
      <div key={item} className={styles.Row} style={style}>
        <Checkbox
          size='sm'
          checked={selectedItems.has(item)}
          onCheckedChange={() => {
            onToggleItem(item); 
          }}
          className={styles.Check}
        >
          <span className={styles.ItemLabel}>{item}</span>
        </Checkbox>
      </div>
    ),
    [selectedItems, onToggleItem],
  );

  return (
    <Popover.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Popover.Trigger
        render={
          <Button
            size='sm'
            variant={allSelected ? 'ghost' : 'soft'}
            color={allSelected ? 'neutral' : 'brand'}
            endDecorator={<LuChevronDown size={12} />}
            className={styles.Trigger}
          >
            {triggerLabel}
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner align='start' sideOffset={4}>
          <Popover.Popup className={styles.Popup} initialFocus={showSearch}>
            {showSearch && (
              <div className={styles.SearchBox}>
                <SearchInput
                  size='sm'
                  placeholder={`Search ${label.toLowerCase()}...`}
                  value={search}
                  onValueChange={setSearch}
                  startDecorator={<LuSearch size={12} />}
                />
              </div>
            )}

            {/* All toggle */}
            <div className={`${styles.Row} ${styles.AllRow}`}>
              <Checkbox
                size='sm'
                checked={allSelected}
                indeterminate={indeterminate}
                onCheckedChange={onToggleAll}
                className={styles.Check}
              >
                <span className={styles.AllLabel}>All {label}</span>
              </Checkbox>
            </div>

            {/* Item list */}
            <div ref={listRef} className={styles.List}>
              {useVirtual ? (
                <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const item = filteredItems[virtualRow.index];
                    return renderRow(item, {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    });
                  })}
                </div>
              ) : (
                filteredItems.map((item) => renderRow(item))
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default React.memo(FilterSelect);
