import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import MuiDialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';
import SearchIcon from '@mui/icons-material/Search';


export interface CommandItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  category?: string;
  shortcut?: string;
  description?: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
  onSelect: (item: CommandItem) => void;
  placeholder?: string;
  recentItems?: CommandItem[];
  categories?: string[];
}

export default function CommandPalette({
  open,
  onClose,
  items,
  onSelect,
  placeholder = 'Type a command...',
  recentItems,
  categories,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filteredItems = useMemo(() => {
    if (!query && recentItems && recentItems.length > 0) {
      return recentItems;
    }
    if (!query) return items;
    const lower = query.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(lower) ||
        item.description?.toLowerCase().includes(lower) ||
        item.category?.toLowerCase().includes(lower),
    );
  }, [query, items, recentItems]);

  const grouped = useMemo(() => {
    if (!categories || !query) return null;
    const map = new Map<string, CommandItem[]>();
    for (const item of filteredItems) {
      const cat = item.category ?? 'Other';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return map;
  }, [filteredItems, categories, query]);

  const handleSelect = useCallback(
    (item: CommandItem) => {
      onSelect(item);
      onClose();
    },
    [onSelect, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[activeIndex]) {
          handleSelect(filteredItems[activeIndex]);
        }
      }
    },
    [filteredItems, activeIndex, handleSelect],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector(`[data-index="${activeIndex}"]`);
      activeEl?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const renderItem = (item: CommandItem, index: number) => (
    <Box
      key={item.id}
      data-index={index}
      onClick={() => handleSelect(item)}
      onMouseEnter={() => setActiveIndex(index)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 0.75,
        cursor: 'pointer',
        bgcolor: index === activeIndex ? 'var(--ov-accent-subtle)' : 'transparent',
        '&:hover': { bgcolor: 'var(--ov-accent-subtle)' },
        borderRadius: '4px',
        mx: 0.5,
      }}
    >
      {item.icon && (
        <Box sx={{ display: 'flex', alignItems: 'center', color: 'var(--ov-fg-muted)', flexShrink: 0 }}>
          {item.icon}
        </Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontSize: '0.8125rem', color: 'var(--ov-fg-base)' }} noWrap>
          {item.label}
        </Typography>
        {item.description && (
          <Typography variant="caption" sx={{ color: 'var(--ov-fg-muted)' }} noWrap>
            {item.description}
          </Typography>
        )}
      </Box>
      {item.shortcut && (
        <Typography
          variant="caption"
          sx={{
            fontFamily: 'var(--ov-font-mono)',
            fontSize: '0.6875rem',
            color: 'var(--ov-fg-faint)',
            bgcolor: 'var(--ov-bg-surface-inset)',
            px: 0.75,
            py: 0.25,
            borderRadius: '3px',
            flexShrink: 0,
          }}
        >
          {item.shortcut}
        </Typography>
      )}
    </Box>
  );

  return (
    <MuiDialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'var(--ov-bg-surface)',
            border: '1px solid var(--ov-border-default)',
            borderRadius: '12px',
            mt: '15vh',
            maxHeight: '60vh',
          },
        },
        backdrop: { sx: { bgcolor: 'rgba(0,0,0,0.5)' } },
      }}
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1.5,
          borderBottom: '1px solid var(--ov-border-default)',
        }}
      >
        <SearchIcon sx={{ color: 'var(--ov-fg-muted)', fontSize: 20 }} />
        <InputBase
          inputRef={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          fullWidth
          sx={{ fontSize: '0.875rem', color: 'var(--ov-fg-base)' }}
        />
      </Box>

      <Box ref={listRef} sx={{ overflow: 'auto', py: 0.5, maxHeight: 400 }}>
        {filteredItems.length === 0 && (
          <Typography
            variant="body2"
            sx={{ px: 2, py: 3, textAlign: 'center', color: 'var(--ov-fg-muted)' }}
          >
            No results found
          </Typography>
        )}

        {grouped
          ? Array.from(grouped.entries()).map(([category, groupItems]) => (
              <Box key={category}>
                <Typography
                  variant="overline"
                  sx={{
                    px: 2,
                    py: 0.5,
                    display: 'block',
                    fontSize: '0.625rem',
                    fontWeight: 600,
                    color: 'var(--ov-fg-faint)',
                    letterSpacing: '0.08em',
                  }}
                >
                  {category}
                </Typography>
                {groupItems.map((item) => {
                  const globalIdx = filteredItems.indexOf(item);
                  return renderItem(item, globalIdx);
                })}
              </Box>
            ))
          : filteredItems.map((item, i) => renderItem(item, i))}

        {!query && recentItems && recentItems.length > 0 && (
          <Typography
            variant="caption"
            sx={{ px: 2, pt: 0.5, display: 'block', color: 'var(--ov-fg-faint)' }}
          >
            Recent commands
          </Typography>
        )}
      </Box>
    </MuiDialog>
  );
}

CommandPalette.displayName = 'CommandPalette';
