import MuiAutocomplete from '@mui/material/Autocomplete';
import MuiTextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toMuiInputSize, toMuiColor, INPUT_HEIGHTS } from '../types';

export interface AutocompleteOption {
  value: string;
  label: string;
}

export interface AutocompleteProps {
  options: AutocompleteOption[];
  value: AutocompleteOption | AutocompleteOption[] | null;
  onChange: (value: AutocompleteOption | AutocompleteOption[] | null) => void;
  size?: ComponentSize;
  color?: SemanticColor;
  creatable?: boolean;
  loading?: boolean;
  groupBy?: (option: AutocompleteOption) => string;
  renderOption?: (option: AutocompleteOption) => React.ReactNode;
  label?: string;
  helperText?: string;
  placeholder?: string;
  error?: boolean | string;
  multiple?: boolean;
  fullWidth?: boolean;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

export default function Autocomplete({
  options,
  value,
  onChange,
  size = 'md',
  color = 'neutral',
  creatable = false,
  loading = false,
  groupBy,
  renderOption,
  label,
  helperText,
  placeholder,
  error,
  multiple = false,
  fullWidth,
  disabled,
  sx,
}: AutocompleteProps) {
  const muiSize = toMuiInputSize(size);
  const muiColor = toMuiColor(color) as any;
  const hasError = typeof error === 'string' ? !!error : error;
  const errorText = typeof error === 'string' ? error : undefined;

  return (
    <MuiAutocomplete
      options={options}
      value={value}
      onChange={(_, newVal) => onChange(newVal as AutocompleteOption | AutocompleteOption[] | null)}
      getOptionLabel={(opt) => (typeof opt === 'string' ? opt : opt.label)}
      isOptionEqualToValue={(opt, val) => opt.value === val.value}
      multiple={multiple}
      freeSolo={creatable}
      loading={loading}
      disabled={disabled}
      groupBy={groupBy}
      size={muiSize}
      fullWidth={fullWidth}
      renderOption={
        renderOption
          ? (props, option) => (
              <li {...props} key={option.value}>
                {renderOption(option)}
              </li>
            )
          : undefined
      }
      renderInput={(params) => (
        <MuiTextField
          {...params}
          label={label}
          placeholder={placeholder}
          helperText={errorText ?? helperText}
          error={hasError}
          color={muiColor === 'default' || muiColor === 'inherit' ? undefined : muiColor}
          slotProps={{
            input: {
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading && <CircularProgress color="inherit" size={16} />}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
      style={{ '--ov-input-height': INPUT_HEIGHTS[size] } as React.CSSProperties}
      sx={sx}
    />
  );
}

Autocomplete.displayName = 'Autocomplete';
