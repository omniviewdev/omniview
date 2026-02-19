import React, { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import MuiModal from '@mui/material/Modal';
import SearchIcon from '@mui/icons-material/Search';
import type { SxProps, Theme } from '@mui/material/styles';

export interface SpotlightResultItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  section?: string;
  onSelect: () => void;
}

export interface SpotlightProps {
  open: boolean;
  onClose: () => void;
  onSearch: (query: string) => SpotlightResultItem[] | Promise<SpotlightResultItem[]>;
  placeholder?: string;
  recentItems?: SpotlightResultItem[];
  width?: number;
  sx?: SxProps<Theme>;
}

export default function Spotlight({
  open,
  onClose,
  onSearch,
  placeholder = 'Search commands, files, settings...',
  recentItems,
  width = 560,
  sx,
}: SpotlightProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpotlightResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    let cancelled = false;
    const result = onSearch(query);
    if (result instanceof Promise) {
      result.then((items) => {
        if (!cancelled) {
          setResults(items);
          setSelectedIndex(0);
        }
      });
    } else {
      setResults(result);
      setSelectedIndex(0);
    }
    return () => { cancelled = true; };
  }, [query, onSearch]);

  const displayItems = query.trim() ? results : (recentItems ?? []);

  // Group items by section
  const sections = new Map<string, SpotlightResultItem[]>();
  for (const item of displayItems) {
    const section = item.section ?? '';
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(item);
  }

  // Flat list for keyboard navigation
  const flatItems = displayItems;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[selectedIndex];
      if (item) {
        item.onSelect();
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [flatItems, selectedIndex, onClose]);

  let flatIndex = -1;

  return (
    <MuiModal open={open} onClose={onClose} slotProps={{ backdrop: { sx: { bgcolor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' } } }}>
      <Box
        sx={{
          position: 'absolute',
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width,
          maxHeight: '60vh',
          bgcolor: 'var(--ov-bg-surface)',
          border: '1px solid var(--ov-border-default)',
          borderRadius: '8px',
          boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
        } as SxProps<Theme>}
      >
        {/* Search input */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: 2,
            py: 1.5,
            borderBottom: '1px solid var(--ov-border-default)',
            gap: 1,
          }}
        >
          <SearchIcon sx={{ color: 'var(--ov-fg-muted)', fontSize: 20 }} />
          <InputBase
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            fullWidth
            sx={{
              fontSize: 'var(--ov-text-sm)',
              color: 'var(--ov-fg-base)',
              '& input::placeholder': { color: 'var(--ov-fg-faint)', opacity: 1 },
            }}
          />
        </Box>

        {/* Results */}
        <Box sx={{ overflow: 'auto', maxHeight: 400 }}>
          {displayItems.length === 0 && query.trim() && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography sx={{ color: 'var(--ov-fg-faint)', fontSize: 'var(--ov-text-sm)' }}>
                No results for &ldquo;{query}&rdquo;
              </Typography>
            </Box>
          )}

          {Array.from(sections.entries()).map(([sectionName, items]) => (
            <Box key={sectionName}>
              {sectionName && (
                <Typography
                  sx={{
                    px: 2,
                    pt: 1.5,
                    pb: 0.5,
                    fontSize: 'var(--ov-text-xs)',
                    fontWeight: 600,
                    color: 'var(--ov-fg-faint)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {sectionName}
                </Typography>
              )}
              {items.map((item) => {
                flatIndex++;
                const isSelected = flatIndex === selectedIndex;
                const idx = flatIndex;
                return (
                  <Box
                    key={item.id}
                    onClick={() => { item.onSelect(); onClose(); }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 2,
                      py: 1,
                      cursor: 'pointer',
                      bgcolor: isSelected ? 'var(--ov-state-hover)' : 'transparent',
                      '&:hover': { bgcolor: 'var(--ov-state-hover)' },
                    }}
                  >
                    {item.icon && (
                      <Box sx={{ color: 'var(--ov-fg-muted)', flexShrink: 0, display: 'flex' }}>
                        {item.icon}
                      </Box>
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 'var(--ov-text-sm)', color: 'var(--ov-fg-base)' }}>
                        {item.label}
                      </Typography>
                      {item.description && (
                        <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.description}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>

        {/* Footer hints */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: 2,
            py: 1,
            borderTop: '1px solid var(--ov-border-default)',
            fontSize: 'var(--ov-text-xs)',
            color: 'var(--ov-fg-faint)',
          }}
        >
          <span><kbd style={{ fontFamily: 'var(--ov-font-mono)' }}>&uarr;&darr;</kbd> navigate</span>
          <span><kbd style={{ fontFamily: 'var(--ov-font-mono)' }}>&crarr;</kbd> select</span>
          <span><kbd style={{ fontFamily: 'var(--ov-font-mono)' }}>esc</kbd> close</span>
        </Box>
      </Box>
    </MuiModal>
  );
}

Spotlight.displayName = 'Spotlight';
