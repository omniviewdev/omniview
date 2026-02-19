import React from 'react';

import OutlinedInput from '@mui/material/OutlinedInput';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
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
 * Search input with icon and clear button.
 */
const SearchInput: React.FC<Props> = ({ placeholder, value, onChange }) => {
  const handleClear = () => {
    onChange('');
  };

  const hasValue = React.useMemo(() => value !== '', [value]);

  return (
    <OutlinedInput
      size="small"
      autoComplete="off"
      type="text"
      placeholder={placeholder ?? 'Search'}
      startAdornment={
        <InputAdornment position="start">
          <SearchRoundedIcon color="primary" />
        </InputAdornment>
      }
      endAdornment={hasValue ? (
        <InputAdornment position="end">
          <IconButton size="small" onClick={handleClear} edge="end">
            <ClearIcon fontSize="small" />
          </IconButton>
        </InputAdornment>
      ) : undefined}
      value={value}
      onChange={e => {
        onChange(e.target.value);
      }}
      sx={{
        flexBasis: '500px',
        display: 'flex',
        boxShadow: 'none',
        minWidth: { md: 400, lg: 400, xl: 500 },
      }}
      inputProps={{
        autoCorrect: 'off',
        autoComplete: 'off',
      }}
    />
  );
};

SearchInput.displayName = 'SearchInput';

export default SearchInput;
