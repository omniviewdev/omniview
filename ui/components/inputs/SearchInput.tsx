import React from 'react';

import { SearchInput as BaseSearchInput } from '@omniviewdev/base-ui';

// Icons
import { LuSearch } from 'react-icons/lu';

import styles from './SearchInput.module.css';

type Props = {
  /** Placeholder for the search input. */
  placeholder?: string;
  /** Value for the text input. */
  value: string;
  /** Handler for the text input. */
  onChange: (value: string) => void;
};

/**
 * Search input component.
 */
const SearchInput: React.FC<Props> = ({ placeholder, value, onChange }) => {
  return (
    <BaseSearchInput
      size='sm'
      variant='outline'
      autoComplete='off'
      autoCorrect='off'
      placeholder={placeholder ?? 'Search'}
      aria-label={placeholder ?? 'Search'}
      startDecorator={<LuSearch className={styles.SearchIcon} />}
      clearable
      value={value}
      onValueChange={onChange}
      className={styles.Root}
    />
  );
};

export default SearchInput;
