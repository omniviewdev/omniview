import { useState, useEffect } from 'react';

import InputBase from '@mui/material/InputBase';
import Box from '@mui/material/Box';
import { Search, Close } from '@mui/icons-material';

export type DebounceProps = {
  value: string;
  onChange: (value: string) => void;
  debounce?: number;
  placeholder?: string;
  autoFocus?: boolean;
};

/**
 * A compact debounced search input matching IDETable style.
 */
export function DebouncedInput({
  value: initialValue,
  onChange,
  debounce = 500,
  placeholder = 'Search',
  autoFocus = true,
}: DebounceProps) {
  const [value, setValue] = useState(initialValue);

  const handleClear = () => {
    setValue('');
    onChange('');
  };

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      onChange(value);
    }, debounce);

    return () => {
      clearTimeout(timeout);
    };
  }, [value]);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flex: 1,
        maxWidth: 360,
        height: 28,
        border: '1px solid var(--ov-border-default)',
        borderRadius: '4px',
        bgcolor: 'var(--ov-bg-base)',
        px: 0.75,
        '&:focus-within': { borderColor: 'var(--ov-accent)' },
      }}
    >
      <Search sx={{ fontSize: 14, color: 'var(--ov-fg-faint)', mr: 0.5 }} />
      <InputBase
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete='off'
        sx={{
          flex: 1,
          fontSize: '0.75rem',
          color: 'var(--ov-fg-default)',
          '& input': { py: 0, px: 0 },
          '& input::placeholder': { color: 'var(--ov-fg-faint)', opacity: 1 },
        }}
      />
      {value && (
        <Close
          sx={{
            fontSize: 14,
            color: 'var(--ov-fg-faint)',
            cursor: 'pointer',
            ml: 0.5,
            '&:hover': { color: 'var(--ov-fg-default)' },
          }}
          onClick={handleClear}
        />
      )}
    </Box>
  );
}
