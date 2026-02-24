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
  /** "mono" renders with monospace font (default); "inherit" inherits parent styling */
  variant?: 'mono' | 'inherit';
}

export default function ClipboardText({
  value,
  truncate = true,
  maxWidth,
  sx,
  variant = 'mono',
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
        minWidth: 0,
        ...sx as Record<string, unknown>,
      }}
    >
      {variant === 'mono' ? (
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
      ) : (
        <span style={{
          ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const } : {}),
        }}>
          {value}
        </span>
      )}
      <span
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          visibility: hovered ? 'visible' : 'hidden',
          flexShrink: 0,
        }}
      >
        <CopyButton value={value} size="xs" />
      </span>
    </Box>
  );
}

ClipboardText.displayName = 'ClipboardText';
