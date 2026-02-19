import { useState, useEffect } from 'react';

import OutlinedInput, { type OutlinedInputProps } from '@mui/material/OutlinedInput';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';

export type DebounceProps = {
  value: string;
  onChange: (value: string) => void;
  debounce?: number;
};

/**
 * A debounced text input with search icon and clear button.
 */
export function DebouncedInput({
  value: initialValue,
  onChange,
  debounce = 500,
  placeholder = 'Search',
  ...rest
}: Omit<OutlinedInputProps, 'onChange'> & DebounceProps) {
  const [value, setValue] = useState(initialValue);

  const handleClear = () => {
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
    <OutlinedInput
      {...rest}
      value={value}
      size="small"
      placeholder={placeholder}
      type="text"
      autoComplete="off"
      onChange={e => {
        setValue(e.target.value);
      }}
      startAdornment={
        <InputAdornment position="start">
          <SearchIcon fontSize="small" />
        </InputAdornment>
      }
      endAdornment={value ? (
        <InputAdornment position="end">
          <IconButton
            size="small"
            onClick={handleClear}
            edge="end"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </InputAdornment>
      ) : undefined}
      sx={{ flexGrow: 1, maxWidth: 500, minWidth: 300, minHeight: 36 }}
      inputProps={{
        autoCorrect: 'off',
        autoComplete: 'off',
      }}
    />
  );
}
