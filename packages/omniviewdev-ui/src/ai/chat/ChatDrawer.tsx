import React from 'react';
import MuiDrawer from '@mui/material/Drawer';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
  width?: number | string;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}

export default function ChatDrawer({
  open,
  onClose,
  width = 480,
  children,
  sx,
}: ChatDrawerProps) {
  return (
    <MuiDrawer
      open={open}
      onClose={onClose}
      anchor="right"
      variant="temporary"
      slotProps={{
        paper: {
          sx: {
            width,
            bgcolor: 'var(--ov-bg-base)',
            borderColor: 'var(--ov-border-default)',
            display: 'flex',
            flexDirection: 'column',
            ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
          } as SxProps<Theme>,
        },
      }}
    >
      {children}
    </MuiDrawer>
  );
}

ChatDrawer.displayName = 'ChatDrawer';
