import { useState, useRef, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiTextField from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ComponentSize } from '../types';

export interface InlineEditProps {
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  size?: ComponentSize;
  sx?: SxProps<Theme>;
}

const sizeMap: Record<ComponentSize, string> = {
  xs: '0.6875rem',
  sm: '0.8125rem',
  md: '0.875rem',
  lg: '1rem',
  xl: '1.125rem',
};

export default function InlineEdit({
  value,
  onSave,
  placeholder = 'Click to edit',
  size = 'sm',
  sx,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleSave = () => {
    setEditing(false);
    if (draft !== value) {
      onSave(draft);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    return (
      <Box sx={sx}>
        <MuiTextField
          inputRef={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
          variant="outlined"
          size="small"
          fullWidth
          slotProps={{
            input: {
              sx: { fontSize: sizeMap[size], py: 0.25, px: 0.5 },
            },
          }}
        />
      </Box>
    );
  }

  return (
    <Box
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      sx={{
        cursor: 'pointer',
        borderRadius: '4px',
        px: 0.5,
        py: 0.25,
        '&:hover': { bgcolor: 'var(--ov-state-hover)' },
        ...sx as Record<string, unknown>,
      }}
    >
      <Typography
        variant="body2"
        sx={{
          fontSize: sizeMap[size],
          color: value ? 'var(--ov-fg-default)' : 'var(--ov-fg-faint)',
        }}
      >
        {value || placeholder}
      </Typography>
    </Box>
  );
}

InlineEdit.displayName = 'InlineEdit';
