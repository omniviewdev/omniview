import React from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ToolbarGroupProps {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}

export default function ToolbarGroup({ children, sx }: ToolbarGroupProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {children}
    </Box>
  );
}

ToolbarGroup.displayName = 'ToolbarGroup';
