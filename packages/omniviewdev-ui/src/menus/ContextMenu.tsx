import React, { useState, useCallback } from 'react';
import Menu from '@mui/material/Menu';
import Divider from '@mui/material/Divider';

import type { ContextMenuItem } from './types';
import NestedMenuItem from './NestedMenuItem';

export interface ContextMenuProps {
  items: ContextMenuItem[];
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}

export default function ContextMenu({
  items,
  children,
  onOpenChange,
}: ContextMenuProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPosition({ top: e.clientY, left: e.clientX });
    onOpenChange?.(true);
  }, [onOpenChange]);

  const handleClose = useCallback(() => {
    setPosition(null);
    onOpenChange?.(false);
  }, [onOpenChange]);

  return (
    <>
      <span onContextMenu={handleContextMenu} style={{ display: 'contents' }}>
        {children}
      </span>

      <Menu
        open={position !== null}
        onClose={handleClose}
        anchorReference="anchorPosition"
        anchorPosition={position ?? undefined}
        slotProps={{
          paper: {
            sx: {
              minWidth: 180,
              bgcolor: 'var(--ov-bg-surface)',
              border: '1px solid var(--ov-border-default)',
            },
          },
        }}
      >
        {items.map((item) => (
          <React.Fragment key={item.key}>
            <NestedMenuItem item={item} onClose={handleClose} />
            {item.dividerAfter && <Divider />}
          </React.Fragment>
        ))}
      </Menu>
    </>
  );
}

ContextMenu.displayName = 'ContextMenu';
