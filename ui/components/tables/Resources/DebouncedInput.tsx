import { useState, useEffect, useLayoutEffect, useRef } from 'react';

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

  const [previousInitialValue, setPreviousInitialValue] = useState(initialValue);
  if (previousInitialValue !== initialValue) {
    setPreviousInitialValue(initialValue);
    setValue(initialValue);
  }

  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      onChangeRef.current(value);
    }, debounce);

    return () => {
      clearTimeout(timeout);
    };
  }, [value, debounce]);

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
