import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Popover from '@mui/material/Popover';
import type { SxProps, Theme } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';

export interface TimeRange {
  from: Date;
  to: Date;
}

export interface TimeRangePreset {
  label: string;
  duration: number; // milliseconds
}

export interface TimeRangePickerProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  presets?: TimeRangePreset[];
  customRange?: boolean;
  sx?: SxProps<Theme>;
}

const defaultPresets: TimeRangePreset[] = [
  { label: 'Last 15m', duration: 15 * 60 * 1000 },
  { label: 'Last 1h', duration: 60 * 60 * 1000 },
  { label: 'Last 6h', duration: 6 * 60 * 60 * 1000 },
  { label: 'Last 24h', duration: 24 * 60 * 60 * 1000 },
  { label: 'Last 7d', duration: 7 * 24 * 60 * 60 * 1000 },
];

export default function TimeRangePicker({
  value,
  onChange,
  presets = defaultPresets,
  customRange = true,
  sx,
}: TimeRangePickerProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [customFrom, setCustomFrom] = useState<Date | null>(value.from);
  const [customTo, setCustomTo] = useState<Date | null>(value.to);

  const handlePreset = (preset: TimeRangePreset) => {
    const to = new Date();
    const from = new Date(to.getTime() - preset.duration);
    onChange({ from, to });
  };

  const handleCustomApply = () => {
    if (customFrom && customTo && !isNaN(customFrom.getTime()) && !isNaN(customTo.getTime())) {
      onChange({ from: customFrom, to: customTo });
      setAnchorEl(null);
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ...sx as Record<string, unknown> }}>
      {presets.map((preset) => (
        <Button
          key={preset.label}
          size="small"
          variant="outlined"
          onClick={() => handlePreset(preset)}
          sx={{ fontSize: '0.75rem', textTransform: 'none', minWidth: 0, px: 1 }}
        >
          {preset.label}
        </Button>
      ))}
      {customRange && (
        <>
          <Button
            size="small"
            variant="outlined"
            onClick={(e) => {
              setCustomFrom(value.from);
              setCustomTo(value.to);
              setAnchorEl(e.currentTarget);
            }}
            sx={{ fontSize: '0.75rem', textTransform: 'none', minWidth: 0, px: 1 }}
          >
            Custom
          </Button>
          <Popover
            open={Boolean(anchorEl)}
            anchorEl={anchorEl}
            onClose={() => setAnchorEl(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <LocalizationProvider dateAdapter={AdapterDateFns}>
              <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 300 }}>
                <DateTimePicker
                  label="From"
                  value={customFrom}
                  onChange={(v) => setCustomFrom(v)}
                  slotProps={{ textField: { size: 'small' } }}
                />
                <DateTimePicker
                  label="To"
                  value={customTo}
                  onChange={(v) => setCustomTo(v)}
                  slotProps={{ textField: { size: 'small' } }}
                />
                <Button size="small" variant="contained" onClick={handleCustomApply}>
                  Apply
                </Button>
              </Box>
            </LocalizationProvider>
          </Popover>
        </>
      )}
    </Box>
  );
}

TimeRangePicker.displayName = 'TimeRangePicker';
