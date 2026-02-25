import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiButton from '@mui/material/Button';
import LockIcon from '@mui/icons-material/Lock';
import type { SxProps, Theme } from '@mui/material/styles';

export interface PermissionGateProps {
  allowed: boolean;
  children: React.ReactNode;
  onRequest?: () => void;
  message?: string;
  sx?: SxProps<Theme>;
}

export default function PermissionGate({
  allowed,
  children,
  onRequest,
  message = 'Permission required to view this content',
  sx,
}: PermissionGateProps) {
  if (allowed) {
    return <>{children}</>;
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        p: 3,
        border: '1px dashed var(--ov-border-default)',
        borderRadius: '8px',
        bgcolor: 'var(--ov-bg-surface)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <LockIcon sx={{ fontSize: 24, color: 'var(--ov-fg-faint)' }} />

      <Typography
        sx={{
          fontSize: 'var(--ov-text-sm)',
          color: 'var(--ov-fg-muted)',
          textAlign: 'center',
        }}
      >
        {message}
      </Typography>

      {onRequest && (
        <MuiButton
          variant="outlined"
          size="small"
          onClick={onRequest}
          sx={{
            textTransform: 'none',
            borderColor: 'var(--ov-border-default)',
            color: 'var(--ov-fg-default)',
          }}
        >
          Request Access
        </MuiButton>
      )}
    </Box>
  );
}

PermissionGate.displayName = 'PermissionGate';
