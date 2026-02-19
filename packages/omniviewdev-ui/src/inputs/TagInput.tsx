import { useState, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import OutlinedInput from '@mui/material/OutlinedInput';
import Popper from '@mui/material/Popper';
import Paper from '@mui/material/Paper';
import MenuItem from '@mui/material/MenuItem';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toMuiSize } from '../types';

export interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  maxTags?: number;
  creatable?: boolean;
  size?: ComponentSize;
  color?: SemanticColor;
  placeholder?: string;
  sx?: SxProps<Theme>;
}

export default function TagInput({
  value,
  onChange,
  suggestions,
  maxTags,
  creatable = true,
  size = 'sm',
  placeholder = 'Add tag...',
  sx,
}: TagInputProps) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const muiSize = toMuiSize(size) as 'small' | 'medium';

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim();
      if (!trimmed) return;
      if (value.includes(trimmed)) return;
      if (maxTags && value.length >= maxTags) return;
      if (!creatable && suggestions && !suggestions.includes(trimmed)) return;
      onChange([...value, trimmed]);
      setInput('');
      setShowSuggestions(false);
    },
    [value, onChange, maxTags, creatable, suggestions],
  );

  const removeTag = useCallback(
    (tag: string) => {
      onChange(value.filter((t) => t !== tag));
    },
    [value, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  const filtered = suggestions?.filter(
    (s) =>
      s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s),
  );

  return (
    <ClickAwayListener onClickAway={() => setShowSuggestions(false)}>
      <Box ref={anchorRef} sx={sx}>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.5,
            alignItems: 'center',
            border: '1px solid var(--ov-border-default)',
            borderRadius: 'var(--ov-radius-md, 6px)',
            padding: '4px 8px',
            bgcolor: 'var(--ov-bg-surface)',
            minHeight: muiSize === 'small' ? 36 : 40,
            '&:focus-within': {
              borderColor: 'var(--ov-accent)',
            },
          }}
        >
          {value.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              size="small"
              onDelete={() => removeTag(tag)}
              sx={{ fontSize: 'var(--ov-text-xs)' }}
            />
          ))}
          <OutlinedInput
            inputRef={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (suggestions) setShowSuggestions(true);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions && input) setShowSuggestions(true);
            }}
            placeholder={value.length === 0 ? placeholder : ''}
            size="small"
            sx={{
              flex: 1,
              minWidth: 80,
              height: 'auto',
              backgroundColor: 'transparent !important',
              '& fieldset': { border: 'none' },
              '& input': { p: '2px 0', fontSize: 'var(--ov-text-sm)' },
            }}
          />
        </Box>
        {showSuggestions && filtered && filtered.length > 0 && (
          <Popper
            open
            anchorEl={anchorRef.current}
            placement="bottom-start"
            style={{ zIndex: 1300, width: anchorRef.current?.clientWidth }}
          >
            <Paper
              sx={{
                mt: 0.5,
                maxHeight: 200,
                overflow: 'auto',
                border: '1px solid var(--ov-border-default)',
              }}
            >
              {filtered.map((s) => (
                <MenuItem
                  key={s}
                  onClick={() => addTag(s)}
                  sx={{ fontSize: 'var(--ov-text-sm)' }}
                >
                  {s}
                </MenuItem>
              ))}
            </Paper>
          </Popper>
        )}
      </Box>
    </ClickAwayListener>
  );
}

TagInput.displayName = 'TagInput';
