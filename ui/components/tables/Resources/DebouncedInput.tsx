import { useState, useEffect } from 'react';

import { SearchInput } from '@omniviewdev/base-ui';
import { LuSearch } from 'react-icons/lu';

import styles from './DebouncedInput.module.css';

export type DebounceProps = {
  value: string;
  onChange: (value: string) => void;
  debounce?: number;
  autoFocus?: boolean;
};

// A debounced input react component
export function DebouncedInput({
  value: initialValue,
  onChange,
  debounce = 500,
  placeholder = 'Search',
  autoFocus = true,
  ...rest
}: DebounceProps & Record<string, any>) {
  const [value, setValue] = useState(initialValue);

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
      {...rest}
      value={value}
      size='sm'
      variant='outline'
      placeholder={placeholder}
      aria-label={placeholder}
      name='pod-search'
      autoFocus={autoFocus}
      autoComplete='off'
      autoCorrect='off'
      onValueChange={setValue}
      startDecorator={<LuSearch size={16} />}
      // Clearing should not be debounced
      clearable
      onClear={() => {
        onChange('');
      }}
      className={styles.Root}
    />
  );
}
