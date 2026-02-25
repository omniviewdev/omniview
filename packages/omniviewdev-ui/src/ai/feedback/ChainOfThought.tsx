import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PendingIcon from '@mui/icons-material/Pending';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ChainOfThoughtStepProps {
  label: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  children?: React.ReactNode;
}

export function ChainOfThoughtStep({ label, status, children }: ChainOfThoughtStepProps) {
  const [expanded, setExpanded] = useState(status === 'active');

  const icon = {
    pending: <PendingIcon sx={{ fontSize: 16, color: 'var(--ov-fg-faint)' }} />,
    active: <CircularProgress size={14} sx={{ color: 'var(--ov-accent)' }} />,
    complete: <CheckCircleIcon sx={{ fontSize: 16, color: 'var(--ov-success-default)' }} />,
    error: <ErrorIcon sx={{ fontSize: 16, color: 'var(--ov-danger-default)' }} />,
  }[status];

  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      {/* Icon + connector */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: 20,
          flexShrink: 0,
          pt: '2px',
        }}
      >
        {icon}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minWidth: 0, pb: 1.5 }}>
        <Typography
          onClick={children ? () => setExpanded((p) => !p) : undefined}
          sx={{
            fontSize: 'var(--ov-text-sm)',
            fontWeight: status === 'active' ? 600 : 400,
            color: status === 'pending' ? 'var(--ov-fg-faint)' : 'var(--ov-fg-default)',
            cursor: children ? 'pointer' : 'default',
            '&:hover': children ? { color: 'var(--ov-accent-fg)' } : {},
          }}
        >
          {label}
        </Typography>

        {children && expanded && (
          <Box
            sx={{
              mt: 0.5,
              fontSize: 'var(--ov-text-sm)',
              color: 'var(--ov-fg-muted)',
              lineHeight: 1.5,
              animation: 'ov-ai-msg-enter 200ms ease-out',
              '@keyframes ov-ai-msg-enter': {
                from: { opacity: 0, transform: 'translateY(4px)' },
                to: { opacity: 1, transform: 'translateY(0)' },
              },
            }}
          >
            {children}
          </Box>
        )}
      </Box>
    </Box>
  );
}

ChainOfThoughtStep.displayName = 'ChainOfThoughtStep';

export interface ChainOfThoughtProps {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}

export default function ChainOfThought({ children, sx }: ChainOfThoughtProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '6px',
        border: '1px solid var(--ov-border-default)',
        bgcolor: 'var(--ov-bg-surface)',
        px: 1.5,
        py: 1,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {children}
    </Box>
  );
}

ChainOfThought.displayName = 'ChainOfThought';
