import React from 'react';

// @omniviewdev/ui
import { TextField } from '@omniviewdev/ui/inputs';

// Icons
import { SearchRounded, Clear } from '@mui/icons-material';

type Props = {
  /** Placeholder for the search input. */
  placeholder?: string;
  /** Value for the text input. */
  value: string;
  /** Handler for the text input. */
  onChange: (value: string) => void;
  /** Whether to autofocus the input on mount. */
  autoFocus?: boolean;
};

/**
 * Search input component.
 */
const SearchInput: React.FC<Props> = ({ placeholder, value, onChange, autoFocus }) => {
  const handleClear = () => {
    onChange('');
  };

  // Recompute only if the value changes
  const hasValue = React.useMemo(() => value !== '', [value]);
  const endAdornment = React.useMemo(() => hasValue ? <Clear onClick={handleClear} sx={{ cursor: 'pointer' }} /> : null, [hasValue]);

  return (
    <TextField
      size='sm'
      autoComplete='off'
      type='text'
      placeholder={placeholder ?? 'Search'}
      autoFocus={autoFocus}
      startAdornment={<SearchRounded color='primary' />}
      endAdornment={endAdornment}
      value={value}
      onChange={e => {
        onChange(e);
      }}
      sx={{
        flexBasis: '500px',
        display: 'flex',
        boxShadow: 'none',
        minWidth: {
          md: 400,
          lg: 400,
          xl: 500,
        },
        '--wails-draggable': 'no-drag',
      }}
    />

  );
};

export default SearchInput;
