import React, { useCallback } from 'react';
import Box from '@mui/material/Box';
import InputBase from '@mui/material/InputBase';
import MuiIconButton from '@mui/material/IconButton';
import MuiTooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import { LuChevronUp, LuChevronDown, LuCaseSensitive, LuRegex } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ComponentSize } from '../types';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  onRegexChange?: (enabled: boolean) => void;
  onCaseSensitiveChange?: (enabled: boolean) => void;
  matchCount?: number;
  currentMatch?: number;
  onNext?: () => void;
  onPrev?: () => void;
  size?: ComponentSize;
  sx?: SxProps<Theme>;
}

const heightMap: Record<ComponentSize, number> = {
  xs: 24,
  sm: 28,
  md: 32,
  lg: 36,
  xl: 40,
};

export default function SearchBar({
  value,
  onChange,
  placeholder = 'Search...',
  regex,
  caseSensitive,
  onRegexChange,
  onCaseSensitiveChange,
  matchCount,
  currentMatch,
  onNext,
  onPrev,
  size = 'sm',
  sx,
}: SearchBarProps) {
  const height = heightMap[size];
  const iconSize = size === 'xs' ? 12 : 14;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.shiftKey ? onPrev?.() : onNext?.();
    }
    if (e.key === 'Escape') {
      (e.target as HTMLInputElement).blur();
    }
  }, [onNext, onPrev]);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        height,
        border: '1px solid var(--ov-border-default)',
        borderRadius: '4px',
        bgcolor: 'var(--ov-bg-surface)',
        px: 0.5,
        gap: '2px',
        '&:focus-within': {
          borderColor: 'var(--ov-accent)',
        },
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <SearchIcon sx={{ fontSize: iconSize + 2, color: 'var(--ov-fg-muted)', ml: 0.25 }} />

      <InputBase
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        sx={{
          flex: 1,
          fontSize: size === 'xs' ? 'var(--ov-text-xs)' : 'var(--ov-text-sm)',
          color: 'var(--ov-fg-default)',
          '& input': { py: 0, px: 0.5 },
          '& input::placeholder': { color: 'var(--ov-fg-faint)', opacity: 1 },
        }}
      />

      {onCaseSensitiveChange && (
        <MuiTooltip title="Match Case">
          <MuiIconButton
            size="small"
            onClick={() => onCaseSensitiveChange(!caseSensitive)}
            sx={{
              borderRadius: '3px',
              p: '2px',
              color: caseSensitive ? 'var(--ov-accent-fg)' : 'var(--ov-fg-faint)',
              bgcolor: caseSensitive ? 'var(--ov-accent-subtle)' : 'transparent',
            }}
          >
            <LuCaseSensitive size={iconSize} />
          </MuiIconButton>
        </MuiTooltip>
      )}

      {onRegexChange && (
        <MuiTooltip title="Use Regular Expression">
          <MuiIconButton
            size="small"
            onClick={() => onRegexChange(!regex)}
            sx={{
              borderRadius: '3px',
              p: '2px',
              color: regex ? 'var(--ov-accent-fg)' : 'var(--ov-fg-faint)',
              bgcolor: regex ? 'var(--ov-accent-subtle)' : 'transparent',
            }}
          >
            <LuRegex size={iconSize} />
          </MuiIconButton>
        </MuiTooltip>
      )}

      {matchCount !== undefined && (
        <Typography
          sx={{
            fontSize: 'var(--ov-text-xs)',
            color: 'var(--ov-fg-muted)',
            whiteSpace: 'nowrap',
            px: 0.5,
          }}
        >
          {matchCount === 0 ? 'No results' : `${(currentMatch ?? 0) + 1}/${matchCount}`}
        </Typography>
      )}

      {onPrev && (
        <MuiIconButton size="small" onClick={onPrev} sx={{ p: '2px' }}>
          <LuChevronUp size={iconSize} />
        </MuiIconButton>
      )}
      {onNext && (
        <MuiIconButton size="small" onClick={onNext} sx={{ p: '2px' }}>
          <LuChevronDown size={iconSize} />
        </MuiIconButton>
      )}
    </Box>
  );
}

SearchBar.displayName = 'SearchBar';
