import { useState, useCallback, useRef, useEffect } from 'react';
import MuiDrawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import type { SxProps, Theme } from '@mui/material/styles';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  anchor?: 'left' | 'right' | 'bottom';
  size?: number | string;
  resizable?: boolean;
  persistent?: boolean;
  children: React.ReactNode;
  title?: string;
  sx?: SxProps<Theme>;
}

export default function Drawer({
  open,
  onClose,
  anchor = 'right',
  size = 360,
  resizable = false,
  persistent = false,
  children,
  title,
  sx,
}: DrawerProps) {
  const isHorizontal = anchor === 'left' || anchor === 'right';
  const [currentSize, setCurrentSize] = useState(typeof size === 'number' ? size : 360);
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startPos.current = isHorizontal ? e.clientX : e.clientY;
    startSize.current = currentSize;
    e.preventDefault();
  }, [isHorizontal, currentSize]);

  useEffect(() => {
    if (!resizable) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = isHorizontal
        ? (anchor === 'right' ? startPos.current - e.clientX : e.clientX - startPos.current)
        : startPos.current - e.clientY;
      setCurrentSize(Math.max(200, startSize.current + delta));
    };

    const handleMouseUp = () => {
      dragging.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizable, isHorizontal, anchor]);

  const sizeProp = isHorizontal
    ? { width: resizable ? currentSize : size }
    : { height: resizable ? currentSize : size };

  return (
    <MuiDrawer
      open={open}
      onClose={onClose}
      anchor={anchor}
      variant={persistent ? 'persistent' : 'temporary'}
      slotProps={{
        paper: {
          sx: {
            ...sizeProp,
            bgcolor: 'var(--ov-bg-surface)',
            borderColor: 'var(--ov-border-default)',
            ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
          } as SxProps<Theme>,
        },
      }}
    >
      {resizable && (
        <Box
          onMouseDown={handleMouseDown}
          sx={{
            position: 'absolute',
            ...(isHorizontal
              ? {
                  top: 0,
                  [anchor === 'right' ? 'left' : 'right']: 0,
                  width: 4,
                  height: '100%',
                  cursor: 'col-resize',
                }
              : {
                  left: 0,
                  top: 0,
                  height: 4,
                  width: '100%',
                  cursor: 'row-resize',
                }),
            zIndex: 1,
            '&:hover': { bgcolor: 'var(--ov-accent)' },
            transition: 'background-color 150ms',
          }}
        />
      )}

      {title && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1.5,
            borderBottom: '1px solid var(--ov-border-default)',
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'var(--ov-fg-base)' }}>
            {title}
          </Typography>
          <MuiIconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon fontSize="small" />
          </MuiIconButton>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', p: title ? 2 : 0 }}>
        {children}
      </Box>
    </MuiDrawer>
  );
}

Drawer.displayName = 'Drawer';
