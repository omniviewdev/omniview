import { useState, useEffect } from 'react';

// Material-ui
import Input, { type InputProps } from '@mui/joy/Input';
import IconButton from '@mui/joy/IconButton';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';

export type DebounceProps = {
  value: string;
  onChange: (value: string) => void;
  debounce?: number;
};

// A debounced input react component
export function DebouncedInput({
  value: initialValue,
  onChange,
  debounce = 500,
  placeholder = 'Search',
  ...rest
}: InputProps & DebounceProps) {
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
    <Input
      {...rest}
      value={value}
      size='sm'
      placeholder={placeholder}
      name='pod-search'
      type='text'
      autoComplete='off'
      onChange={e => {
        setValue(e.target.value);
      }}
      startDecorator={<SearchIcon fontSize='small' />}
      // Clearing should not be debounced
      endDecorator={value ? (
        <IconButton
          sx={{ padding: 0 }}
          onClick={handleClear}
        >
          <CloseIcon fontSize='small' />
        </IconButton>

      ) : undefined}
      sx={{ flexGrow: 1, maxWidth: 500, minWidth: 300, minHeight: 36 }}
      slotProps={{
        input: {
          // Keep the input from auto capitalizing and autocorrecting, doesn't work
          // without both the input and the inputProps
          autoCorrect: 'off',
          autoComplete: 'off',
        },
      }}
    />
  );
}
