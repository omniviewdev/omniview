import React, { useRef, useMemo, useCallback } from 'react';
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Checkbox from '@mui/joy/Checkbox';
import Input from '@mui/joy/Input';
import Typography from '@mui/joy/Typography';
import { Unstable_Popup as BasePopup } from '@mui/base/Unstable_Popup';
import { ClickAwayListener } from '@mui/base';
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
  const anchorRef = useRef<HTMLButtonElement>(null);
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
          '&:hover': { bgcolor: 'neutral.800' },
          ...style,
        }}
        onClick={() => onToggleItem(item)}
      >
        <Checkbox
          size="sm"
          checked={selectedItems.has(item)}
          tabIndex={-1}
          sx={{ pointerEvents: 'none' }}
        />
        <Typography
          level="body-xs"
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
        </Typography>
      </Box>
    ),
    [selectedItems, onToggleItem],
  );

  return (
    <>
      <Button
        ref={anchorRef}
        size="sm"
        variant={allSelected ? 'plain' : 'soft'}
        color={allSelected ? 'neutral' : 'primary'}
        endDecorator={<LuChevronDown size={12} />}
        onClick={handleToggle}
        sx={{
          fontSize: '11px',
          fontWeight: 500,
          minHeight: 24,
          px: 1,
          py: 0,
          gap: 0.5,
          '--Button-gap': '4px',
        }}
      >
        {triggerLabel}
      </Button>
      {isOpen && (
        <BasePopup open={isOpen} anchor={anchorRef.current} placement="bottom-start" style={{ zIndex: 9999 }}>
          <ClickAwayListener onClickAway={handleClose}>
            <Box
              sx={{
                borderRadius: 'sm',
                bgcolor: 'background.surface',
                border: '1px solid',
                borderColor: 'divider',
                boxShadow: 'md',
                minWidth: 180,
                maxWidth: 300,
                overflow: 'hidden',
              }}
            >
              {showSearch && (
                <Box sx={{ p: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Input
                    size="sm"
                    placeholder={`Search ${label.toLowerCase()}...`}
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    startDecorator={<LuSearch size={12} />}
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
                  '&:hover': { bgcolor: 'neutral.800' },
                }}
                onClick={onToggleAll}
              >
                <Checkbox
                  size="sm"
                  checked={allSelected}
                  indeterminate={indeterminate}
                  tabIndex={-1}
                  sx={{ pointerEvents: 'none' }}
                />
                <Typography level="body-xs" sx={{ ml: 1, fontWeight: 600, fontSize: '11px' }}>
                  All {label}
                </Typography>
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
            </Box>
          </ClickAwayListener>
        </BasePopup>
      )}
    </>
  );
};

export default React.memo(FilterSelect);
