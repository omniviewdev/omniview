import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

export interface LoadingOverlayProps {
  active: boolean;
  children: React.ReactNode;
  label?: string;
  blur?: boolean;
  sx?: SxProps<Theme>;
}

export default function LoadingOverlay({
  active,
  children,
  label,
  blur = false,
  sx,
}: LoadingOverlayProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {children}

      {active && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1.5,
            bgcolor: 'rgba(0, 0, 0, 0.3)',
            zIndex: 10,
            borderRadius: 'inherit',
            ...(blur && { backdropFilter: 'blur(3px)' }),
          }}
        >
          <CircularProgress size={28} sx={{ color: 'var(--ov-accent-fg)' }} />
          {label && (
            <Typography sx={{ fontSize: 'var(--ov-text-sm)', color: '#fff', fontWeight: 500 }}>
              {label}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

LoadingOverlay.displayName = 'LoadingOverlay';
