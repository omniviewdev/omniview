import React from 'react';

// Material-ui
import Input from '@mui/joy/Input';

// Icons
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ClearIcon from '@mui/icons-material/Clear';

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
  const handleClear = () => {
    onChange('');
  };

  // Recompute only if the value changes
  const hasValue = React.useMemo(() => value !== '', [value]);
  const endDecorator = React.useMemo(() => hasValue ? <ClearIcon onClick={handleClear} /> : null, [hasValue]);

  return (
    <Input
      size='sm'
      variant='outlined'
      autoComplete='off'
      type='text'
      placeholder={placeholder ?? 'Search'}
      startDecorator={<SearchRoundedIcon color='primary' />}
      endDecorator={endDecorator}
      value={value}
      onChange={e => {
        onChange(e.target.value);
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
};

export default SearchInput;
