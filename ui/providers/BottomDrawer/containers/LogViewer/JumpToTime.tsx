import React, { useRef, useState } from 'react';
import Box from '@mui/joy/Box';
import IconButton from '@mui/joy/IconButton';
import Tooltip from '@mui/joy/Tooltip';
import Popover from '@mui/material/Popover';
import { LuCalendarClock } from 'react-icons/lu';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { MultiSectionDigitalClock } from '@mui/x-date-pickers/MultiSectionDigitalClock';

interface Props {
  onJumpToTime: (date: Date) => void;
}

const r = 'var(--joy-radius-sm, 6px)';

/** Compact dark panel matching Joy UI theme conventions. */
const panelSx = {
  display: 'flex',
  width: 'fit-content',
  bgcolor: 'var(--joy-palette-background-surface)',
  backgroundImage: 'none',
  color: 'var(--joy-palette-text-primary)',

  // ── Calendar ──
  '& .MuiDateCalendar-root': {
    width: 264,
    height: 'auto',
  },
  '& .MuiPickersCalendarHeader-root': {
    minHeight: 'auto',
    px: 1.5,
    mt: 1,
    mb: 0,
  },
  '& .MuiPickersCalendarHeader-label': {
    fontSize: '0.8rem',
    fontWeight: 600,
  },
  '& .MuiPickersCalendarHeader-switchViewButton, & .MuiPickersArrowSwitcher-button': {
    p: 0.5,
    color: 'var(--joy-palette-text-secondary)',
    borderRadius: r,
    '&:hover': { bgcolor: 'var(--joy-palette-background-level1)' },
  },
  '& .MuiDayCalendar-weekDayLabel': {
    width: 32,
    height: 32,
    fontSize: '0.7rem',
    color: 'var(--joy-palette-text-tertiary)',
  },
  '& .MuiPickersDay-root': {
    width: 32,
    height: 32,
    fontSize: '0.75rem',
    borderRadius: r,
    color: 'inherit',
    '&:hover': { bgcolor: 'var(--joy-palette-background-level2)' },
    '&.Mui-selected': {
      bgcolor: 'var(--joy-palette-primary-500)',
      color: '#fff',
      borderRadius: r,
      '&:hover': { bgcolor: 'var(--joy-palette-primary-600)' },
    },
    '&.MuiPickersDay-today': {
      border: '1px solid var(--joy-palette-primary-400)',
      borderRadius: r,
    },
  },
  '& .MuiDayCalendar-slideTransition': {
    minHeight: 196,
  },

  // Year picker
  '& .MuiYearCalendar-root': {
    maxHeight: 240,
    width: 264,
  },
  '& .MuiPickersYear-yearButton': {
    fontSize: '0.75rem',
    borderRadius: r,
    color: 'inherit',
    '&.Mui-selected': {
      bgcolor: 'var(--joy-palette-primary-500)',
      color: '#fff',
    },
    '&:hover': { bgcolor: 'var(--joy-palette-background-level2)' },
  },

  // ── Time columns ──
  '& .MuiMultiSectionDigitalClock-root': {
    width: 'auto !important',
    maxWidth: 'none',
    overflow: 'visible',
    borderLeft: '1px solid var(--joy-palette-divider)',
  },
  '& .MuiMultiSectionDigitalClockSection-root': {
    maxHeight: 240,
    width: 'auto',
    '&::after': { display: 'none' },
  },
  '& .MuiMultiSectionDigitalClockSection-item': {
    fontSize: '0.75rem',
    minWidth: 36,
    px: 0.75,
    py: 0.25,
    mx: 0.5,
    borderRadius: r,
    color: 'inherit',
    '&:hover': { bgcolor: 'var(--joy-palette-background-level2)' },
    '&.Mui-selected': {
      bgcolor: 'var(--joy-palette-primary-500)',
      color: '#fff',
      '&:hover': { bgcolor: 'var(--joy-palette-primary-600)' },
    },
  },
};

const JumpToTime: React.FC<Props> = ({ onJumpToTime }) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<Date | null>(new Date());
  const anchorRef = useRef<HTMLButtonElement>(null);

  const handleJump = () => {
    if (value) onJumpToTime(value);
    setOpen(false);
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Tooltip title="Jump to time">
        <IconButton
          ref={anchorRef}
          size="sm"
          variant="plain"
          color="neutral"
          onClick={() => setOpen(true)}
        >
          <LuCalendarClock size={14} />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              bgcolor: 'transparent',
              backgroundImage: 'none',
              boxShadow: 'var(--joy-shadow-lg, 0 4px 20px rgba(0,0,0,0.5))',
              border: '1px solid var(--joy-palette-divider)',
              borderRadius: 'var(--joy-radius-md, 8px)',
              overflow: 'hidden',
            },
          },
        }}
      >
        <Box sx={panelSx}>
          <DateCalendar
            value={value}
            onChange={(date) => setValue(date)}
          />
          <MultiSectionDigitalClock
            value={value}
            onChange={(date) => setValue(date)}
            ampm={false}
          />
        </Box>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            px: 1.5,
            py: 0.75,
            bgcolor: 'var(--joy-palette-background-surface)',
            borderTop: '1px solid var(--joy-palette-divider)',
          }}
        >
          <Box
            component="button"
            onClick={handleJump}
            sx={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 600,
              fontFamily: 'var(--joy-fontFamily-body)',
              color: 'var(--joy-palette-primary-400)',
              px: 1.5,
              py: 0.5,
              borderRadius: r,
              '&:hover': {
                bgcolor: 'var(--joy-palette-primary-900, rgba(25,118,210,0.12))',
              },
            }}
          >
            Jump
          </Box>
        </Box>
      </Popover>
    </LocalizationProvider>
  );
};

export default React.memo(JumpToTime);
