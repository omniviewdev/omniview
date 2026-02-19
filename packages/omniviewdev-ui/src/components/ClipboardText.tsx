import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { CopyButton } from '../buttons';

export interface ClipboardTextProps {
  value: string;
  truncate?: boolean;
  maxWidth?: number | string;
  sx?: SxProps<Theme>;
}

export default function ClipboardText({
  value,
  truncate = true,
  maxWidth,
  sx,
}: ClipboardTextProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        maxWidth,
        ...sx as Record<string, unknown>,
      }}
    >
      <Typography
        variant="body2"
        sx={{
          fontSize: '0.8125rem',
          color: 'var(--ov-fg-default)',
          fontFamily: 'var(--ov-font-mono)',
          ...(truncate && {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }),
        }}
      >
        {value}
      </Typography>
      {hovered && <CopyButton value={value} size="xs" />}
    </Box>
  );
}

ClipboardText.displayName = 'ClipboardText';
