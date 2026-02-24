import React, { useRef, useMemo, useCallback } from 'react';
import Box from '@mui/material/Box';
import Popover from '@mui/material/Popover';
import { Button } from '@omniviewdev/ui/buttons';
import { Checkbox, TextField } from '@omniviewdev/ui/inputs';
import { Text } from '@omniviewdev/ui/typography';
import { LuChevronDown, LuSearch } from 'react-icons/lu';
import { useVirtualizer } from '@tanstack/react-virtual';

interface FilterSelectProps {
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
}

const VIRTUAL_THRESHOLD = 50;
const ROW_HEIGHT = 28;
const MAX_HEIGHT = 300;

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
  const anchorRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const showSearch = items.length >= searchThreshold;
  const indeterminate = selectedItems.size > 0 && !allSelected;

  const triggerLabel = allSelected
    ? `All ${label}`
    : `${selectedItems.size}/${items.length} ${label}`;

  const filteredItems = useMemo(() => {
    if (!search) return items;
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

  const handleToggle = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onOpenChange(!isOpen);
      if (isOpen) setSearch('');
    },
    [isOpen, onOpenChange],
  );

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setSearch('');
  }, [onOpenChange]);

  const renderRow = useCallback(
    (item: string, style?: React.CSSProperties) => (
      <Box
        key={item}
        sx={{
          display: 'flex',
          alignItems: 'center',
          height: ROW_HEIGHT,
          px: 1,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
          ...style,
        }}
        onClick={() => onToggleItem(item)}
      >
        <Checkbox
          size="sm"
          checked={selectedItems.has(item)}
          onChange={() => {}}
          sx={{ pointerEvents: 'none' }}
        />
        <Text
          variant="caption"
          size="xs"
          sx={{
            ml: 1,
            fontFamily: 'monospace',
            fontSize: '11px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {item}
        </Text>
      </Box>
    ),
    [selectedItems, onToggleItem],
  );

  return (
    <>
      <span ref={anchorRef} style={{ display: 'inline-flex' }}>
        <Button
          size="sm"
          emphasis={allSelected ? 'ghost' : 'soft'}
          color={allSelected ? 'neutral' : 'primary'}
          endAdornment={<LuChevronDown size={12} />}
          onClick={handleToggle}
          sx={{
            fontSize: '11px',
            fontWeight: 500,
            minHeight: 24,
            px: 1,
            py: 0,
            gap: 0.5,
          }}
        >
          {triggerLabel}
        </Button>
      </span>
      <Popover
        open={isOpen}
        anchorEl={anchorRef.current}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        disableAutoFocus
        disableEnforceFocus
        slotProps={{
          paper: {
            sx: {
              borderRadius: 1,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: 3,
              minWidth: 180,
              maxWidth: 300,
              overflow: 'hidden',
              mt: 0.5,
            },
          },
        }}
      >
        {showSearch && (
          <Box sx={{ p: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <TextField
              size="sm"
              placeholder={`Search ${label.toLowerCase()}...`}
              autoFocus
              value={search}
              onChange={(value) => setSearch(value)}
              startAdornment={<LuSearch size={12} />}
              sx={{ fontSize: '11px' }}
            />
          </Box>
        )}

        {/* All toggle */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            height: ROW_HEIGHT,
            px: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
          }}
          onClick={onToggleAll}
        >
          <Checkbox
            size="sm"
            checked={allSelected}
            indeterminate={indeterminate}
            onChange={() => {}}
            sx={{ pointerEvents: 'none' }}
          />
          <Text variant="caption" size="xs" sx={{ ml: 1, fontWeight: 600, fontSize: '11px' }}>
            All {label}
          </Text>
        </Box>

        {/* Item list */}
        <Box
          ref={listRef}
          sx={{
            maxHeight: MAX_HEIGHT,
            overflow: 'auto',
          }}
        >
          {useVirtual ? (
            <Box sx={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
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
            </Box>
          ) : (
            filteredItems.map((item) => renderRow(item))
          )}
        </Box>
      </Popover>
    </>
  );
};

export default React.memo(FilterSelect);
