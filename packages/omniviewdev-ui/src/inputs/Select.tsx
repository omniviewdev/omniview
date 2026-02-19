import { useState, useMemo } from 'react';
import MuiSelect from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import FormHelperText from '@mui/material/FormHelperText';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import CircularProgress from '@mui/material/CircularProgress';
import OutlinedInput from '@mui/material/OutlinedInput';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import type { SxProps, Theme } from '@mui/material/styles';
import type { SelectChangeEvent } from '@mui/material/Select';

import type { SemanticColor, ComponentSize } from '../types';
import { toMuiInputSize, toMuiColor, INPUT_HEIGHTS } from '../types';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export interface SelectProps {
  options: SelectOption[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  size?: ComponentSize;
  color?: SemanticColor;
  label?: string;
  helperText?: string;
  placeholder?: string;
  searchable?: boolean;
  multiple?: boolean;
  loading?: boolean;
  error?: boolean | string;
  fullWidth?: boolean;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

export default function Select({
  options,
  value,
  onChange,
  size = 'md',
  color = 'neutral',
  label,
  helperText,
  placeholder,
  searchable = false,
  multiple = false,
  loading = false,
  error,
  fullWidth,
  disabled,
  sx,
}: SelectProps) {
  const [search, setSearch] = useState('');
  const muiSize = toMuiInputSize(size);
  const muiColor = toMuiColor(color) as any;
  const hasError = typeof error === 'string' ? !!error : error;
  const errorText = typeof error === 'string' ? error : undefined;

  const filteredOptions = useMemo(() => {
    if (!searchable || !search) return options;
    const lower = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
  }, [options, search, searchable]);

  const handleChange = (e: SelectChangeEvent<string | string[]>) => {
    onChange(e.target.value);
  };

  return (
    <FormControl
      size={muiSize}
      fullWidth={fullWidth}
      error={hasError}
      disabled={disabled}
      style={{ '--ov-input-height': INPUT_HEIGHTS[size] } as React.CSSProperties}
      sx={sx}
    >
      {label && (
        <InputLabel
          color={muiColor === 'default' || muiColor === 'inherit' ? undefined : muiColor}
          shrink={!!placeholder || undefined}
        >
          {label}
        </InputLabel>
      )}
      <MuiSelect
        value={value}
        onChange={handleChange}
        multiple={multiple}
        displayEmpty={!!placeholder}
        label={label}
        notched={!!placeholder || undefined}
        input={multiple ? <OutlinedInput label={label} /> : undefined}
        renderValue={
          multiple
            ? (selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'nowrap', gap: 0.5, overflow: 'hidden' }}>
                  {(selected as string[]).map((val) => {
                    const opt = options.find((o) => o.value === val);
                    return <Chip key={val} label={opt?.label ?? val} size="small" />;
                  })}
                </Box>
              )
            : placeholder && !value
              ? () => (
                  <Box sx={{ color: 'var(--ov-fg-faint)' }}>{placeholder}</Box>
                )
              : undefined
        }
        MenuProps={{
          PaperProps: { sx: { maxHeight: 300 } },
        }}
      >
        {searchable && (
          <Box sx={{ px: 1.5, pb: 1, pt: 0.5 }} onKeyDown={(e) => e.stopPropagation()}>
            <OutlinedInput
              size="small"
              fullWidth
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              startAdornment={
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              }
              sx={{ fontSize: 'var(--ov-text-sm)' }}
            />
          </Box>
        )}
        {loading && (
          <MenuItem disabled>
            <CircularProgress size={16} sx={{ mr: 1 }} /> Loading...
          </MenuItem>
        )}
        {filteredOptions.map((opt) => (
          <MenuItem key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.icon && <ListItemIcon sx={{ minWidth: 28 }}>{opt.icon}</ListItemIcon>}
            <ListItemText>{opt.label}</ListItemText>
          </MenuItem>
        ))}
        {filteredOptions.length === 0 && !loading && (
          <MenuItem disabled>No options</MenuItem>
        )}
      </MuiSelect>
      {(errorText || helperText) && (
        <FormHelperText>{errorText ?? helperText}</FormHelperText>
      )}
    </FormControl>
  );
}

Select.displayName = 'Select';
