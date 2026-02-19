import MuiTextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toMuiInputSize, toMuiColor, INPUT_HEIGHTS } from '../types';

export interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  size?: ComponentSize;
  color?: SemanticColor;
  autosize?: boolean;
  maxLength?: number;
  showCount?: boolean;
  rows?: number;
  maxRows?: number;
  label?: string;
  helperText?: string;
  error?: boolean | string;
  placeholder?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

export default function TextArea({
  value,
  onChange,
  size = 'md',
  color = 'neutral',
  autosize = false,
  maxLength,
  showCount = false,
  rows = 3,
  maxRows = 8,
  label,
  helperText,
  error,
  placeholder,
  fullWidth,
  disabled,
  sx,
}: TextAreaProps) {
  const muiSize = toMuiInputSize(size);
  const muiColor = toMuiColor(color) as any;
  const hasError = typeof error === 'string' ? !!error : error;
  const errorText = typeof error === 'string' ? error : undefined;

  const countText =
    showCount && maxLength
      ? `${value.length} / ${maxLength}`
      : showCount
        ? `${value.length}`
        : undefined;

  return (
    <Box sx={sx}>
      <MuiTextField
        value={value}
        onChange={(e) => {
          const next = maxLength ? e.target.value.slice(0, maxLength) : e.target.value;
          onChange(next);
        }}
        size={muiSize}
        color={muiColor === 'default' || muiColor === 'inherit' ? undefined : muiColor}
        label={label}
        helperText={errorText ?? helperText}
        error={hasError}
        placeholder={placeholder}
        fullWidth={fullWidth}
        disabled={disabled}
        multiline
        minRows={autosize ? rows : rows}
        maxRows={autosize ? maxRows : rows}
        style={{ '--ov-input-height': INPUT_HEIGHTS[size] } as React.CSSProperties}
        slotProps={{
          htmlInput: { maxLength },
        }}
      />
      {countText && (
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            textAlign: 'right',
            mt: 0.25,
            color: 'var(--ov-fg-faint)',
            fontSize: 'var(--ov-text-xs)',
          }}
        >
          {countText}
        </Typography>
      )}
    </Box>
  );
}

TextArea.displayName = 'TextArea';
