import React, { useState, useEffect } from 'react';

import { SearchInput } from '@omniviewdev/base-ui';

export type DebounceProps = {
  value: string;
  onChange: (value: string) => void;
  debounce?: number;
  placeholder?: string;
  autoFocus?: boolean;
};

const searchStyle: React.CSSProperties = { flex: 1, maxWidth: 360 };

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
    <SearchInput
      size='sm'
      variant='outline'
      value={value}
      onValueChange={setValue}
      onClear={handleClear}
      clearable
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoComplete='off'
      style={searchStyle}
    />
  );
}
