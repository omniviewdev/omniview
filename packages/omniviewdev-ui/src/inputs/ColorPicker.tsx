import { useState } from 'react';
import Box from '@mui/material/Box';
import MuiTextField from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  presets?: string[];
  allowCustom?: boolean;
  sx?: SxProps<Theme>;
}

const defaultPresets = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#0ea5e9', '#06b6d4', '#10b981', '#84cc16', '#a3e635',
  '#fbbf24', '#fb923c', '#f87171', '#a78bfa', '#c084fc',
];

export default function ColorPicker({
  value,
  onChange,
  presets = defaultPresets,
  allowCustom = true,
  sx,
}: ColorPickerProps) {
  const [customValue, setCustomValue] = useState(value);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ...sx as Record<string, unknown> }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, 28px)',
          gap: '6px',
        }}
      >
        {presets.map((color) => (
          <Box
            key={color}
            onClick={() => {
              onChange(color);
              setCustomValue(color);
            }}
            sx={{
              width: 28,
              height: 28,
              borderRadius: '4px',
              bgcolor: color,
              cursor: 'pointer',
              border: value === color
                ? '2px solid var(--ov-fg-base)'
                : '2px solid transparent',
              '&:hover': {
                transform: 'scale(1.1)',
              },
              transition: 'transform 0.1s, border 0.1s',
            }}
          />
        ))}
      </Box>
      {allowCustom && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: '4px',
              bgcolor: customValue,
              border: '1px solid var(--ov-border-default)',
              flexShrink: 0,
            }}
          />
          <MuiTextField
            value={customValue}
            onChange={(e) => {
              setCustomValue(e.target.value);
              if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(e.target.value)) {
                onChange(e.target.value);
              }
            }}
            size="small"
            placeholder="#000000"
            slotProps={{
              input: {
                sx: { fontFamily: 'var(--ov-font-mono)', fontSize: '0.8125rem' },
              },
            }}
            sx={{ flex: 1, maxWidth: 120 }}
          />
        </Box>
      )}
    </Box>
  );
}

ColorPicker.displayName = 'ColorPicker';
