import React from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface PersistentTabPanelProps {
  children: React.ReactNode;
  value: string;
  activeValue: string;
  sx?: SxProps<Theme>;
}

export default function PersistentTabPanel({
  children,
  value,
  activeValue,
  sx,
}: PersistentTabPanelProps) {
  const isActive = value === activeValue;

  return (
    <Box
      role="tabpanel"
      hidden={!isActive}
      sx={{
        display: isActive ? 'block' : 'none',
        flex: 1,
        overflow: 'auto',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {children}
    </Box>
  );
}

PersistentTabPanel.displayName = 'PersistentTabPanel';
