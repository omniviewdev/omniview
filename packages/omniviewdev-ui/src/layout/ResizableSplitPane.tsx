import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import useResizablePanel from './useResizablePanel';

export interface ResizableSplitPaneProps {
  direction?: 'horizontal' | 'vertical';
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  onResize?: (size: number) => void;
  children: [ReactNode, ReactNode];
  handleSize?: number;
  id?: string;
  sx?: SxProps<Theme>;
}

export default function ResizableSplitPane({
  direction = 'horizontal',
  defaultSize = 300,
  minSize = 100,
  maxSize,
  onResize,
  children,
  handleSize = 4,
  id,
  sx,
}: ResizableSplitPaneProps) {
  const { size, isDragging, handleProps } = useResizablePanel({
    direction,
    defaultSize,
    minSize,
    maxSize,
    onResize,
    storageKey: id ? `ov-split-${id}` : undefined,
  });

  const isHorizontal = direction === 'horizontal';

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        userSelect: isDragging ? 'none' : undefined,
        ...sx as Record<string, unknown>,
      }}
    >
      <Box
        sx={{
          [isHorizontal ? 'width' : 'height']: size,
          flexShrink: 0,
          overflow: 'auto',
        }}
      >
        {children[0]}
      </Box>

      <Box
        {...handleProps}
        sx={{
          [isHorizontal ? 'width' : 'height']: handleSize,
          flexShrink: 0,
          cursor: isHorizontal ? 'col-resize' : 'row-resize',
          bgcolor: isDragging ? 'var(--ov-accent)' : 'transparent',
          transition: isDragging ? 'none' : 'background-color 0.15s',
          '&:hover': {
            bgcolor: 'var(--ov-border-default)',
          },
        }}
      />

      <Box sx={{ flex: 1, overflow: 'auto', minWidth: 0, minHeight: 0 }}>
        {children[1]}
      </Box>
    </Box>
  );
}

ResizableSplitPane.displayName = 'ResizableSplitPane';
