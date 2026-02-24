import { useState, useEffect, useRef, useCallback } from 'react';
import MuiTextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toMuiInputSize, toMuiColor, INPUT_HEIGHTS } from '../types';

export interface TextFieldProps {
  value?: string;
  onChange?: (value: string) => void;
  size?: ComponentSize;
  color?: SemanticColor;
  readOnly?: boolean;
  monospace?: boolean;
  debounced?: boolean;
  debounceMs?: number;
  label?: string;
  helperText?: string;
  error?: boolean | string;
  placeholder?: string;
  fullWidth?: boolean;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
  disabled?: boolean;
  type?: string;
  variant?: 'outlined' | 'filled' | 'standard';
  autoFocus?: boolean;
  autoComplete?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  onFocus?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  name?: string;
  id?: string;
  /** Pass-through HTML input attributes (e.g. min, max, step) */
  inputProps?: Record<string, unknown>;
  /** Pass-through slotProps for MUI TextField */
  slotProps?: Record<string, unknown>;
  sx?: SxProps<Theme>;
}

export default function TextField({
  value = '',
  onChange,
  size = 'md',
  color = 'neutral',
  readOnly = false,
  monospace = false,
  debounced = false,
  debounceMs = 300,
  label,
  helperText,
  error,
  placeholder,
  fullWidth,
  startAdornment,
  endAdornment,
  disabled,
  type,
  variant = 'outlined',
  autoFocus,
  autoComplete,
  onKeyDown,
  onBlur,
  onFocus,
  name,
  id,
  inputProps,
  sx,
}: TextFieldProps) {
  const [internal, setInternal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setInternal(value);
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      if (debounced) {
        setInternal(next);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => onChange?.(next), debounceMs);
      } else {
        setInternal(next);
        onChange?.(next);
      }
    },
    [debounced, debounceMs, onChange],
  );

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const muiSize = toMuiInputSize(size);
  const muiColor = toMuiColor(color) as any;
  const hasError = typeof error === 'string' ? !!error : error;
  const errorText = typeof error === 'string' ? error : undefined;

  return (
    <MuiTextField
      value={internal}
      onChange={handleChange}
      size={muiSize}
      color={muiColor === 'default' || muiColor === 'inherit' ? undefined : muiColor}
      variant={variant}
      label={label}
      helperText={errorText ?? helperText}
      error={hasError}
      placeholder={placeholder}
      fullWidth={fullWidth}
      disabled={disabled}
      type={type}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onFocus={onFocus}
      name={name}
      id={id}
      slotProps={{
        input: {
          readOnly,
          startAdornment: startAdornment ? (
            <InputAdornment position="start">{startAdornment}</InputAdornment>
          ) : undefined,
          endAdornment: endAdornment ? (
            <InputAdornment position="end">{endAdornment}</InputAdornment>
          ) : undefined,
          sx: monospace ? { fontFamily: 'var(--ov-font-mono)' } : undefined,
        },
        htmlInput: inputProps,
      }}
      style={{ '--ov-input-height': INPUT_HEIGHTS[size] } as React.CSSProperties}
      sx={sx}
    />
  );
}

TextField.displayName = 'TextField';
