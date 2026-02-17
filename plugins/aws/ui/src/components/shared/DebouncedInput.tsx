import { useState, useEffect } from 'react';
import {
  Input,
  type InputProps,
  IconButton,
} from '@mui/joy';
import { Search, Close } from '@mui/icons-material';

export type DebounceProps = {
  value: string;
  onChange: (value: string) => void;
  debounce?: number;
};

export function DebouncedInput({
  value: initialValue,
  onChange,
  debounce = 500,
  placeholder = 'Search',
  ...rest
}: Omit<InputProps, 'onChange'> & DebounceProps) {
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
      name='resource-search'
      type='text'
      autoComplete='off'
      onChange={e => {
        setValue(e.target.value);
      }}
      startDecorator={<Search fontSize='small' />}
      endDecorator={value ? (
        <IconButton
          sx={{ padding: 0 }}
          onClick={handleClear}
        >
          <Close fontSize='small' />
        </IconButton>
      ) : undefined}
      sx={{
        flexGrow: 1,
        maxWidth: 500,
        minWidth: 300,
        maxHeight: 30,
      }}
      slotProps={{
        input: {
          autoCorrect: 'off',
          autoComplete: 'off',
        },
      }}
    />
  );
}
