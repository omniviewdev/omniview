import React from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface StatusBarProps {
  children: React.ReactNode;
  height?: number;
  sx?: SxProps<Theme>;
}

export default function StatusBar({
  children,
  height = 24,
  sx,
}: StatusBarProps) {
  const childArray = React.Children.toArray(children);

  const leftItems = childArray.filter((child) => {
    if (React.isValidElement(child)) {
      return (child.props as any).align !== 'right';
    }
    return true;
  });

  const rightItems = childArray.filter((child) => {
    if (React.isValidElement(child)) {
      return (child.props as any).align === 'right';
    }
    return false;
  });

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height,
        px: 1,
        bgcolor: 'var(--ov-bg-surface)',
        borderTop: '1px solid var(--ov-border-default)',
        fontSize: 'var(--ov-text-xs)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {leftItems}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {rightItems}
      </Box>
    </Box>
  );
}

StatusBar.displayName = 'StatusBar';
