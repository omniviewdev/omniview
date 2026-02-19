import React, { useState, useRef, useCallback } from 'react';
import Menu from '@mui/material/Menu';
import Divider from '@mui/material/Divider';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ComponentSize } from '../types';
import type { ContextMenuItem } from './types';
import NestedMenuItem from './NestedMenuItem';

export interface DropdownMenuProps {
  items: ContextMenuItem[];
  trigger: React.ReactNode;
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
  size?: ComponentSize;
  width?: number | string;
  sx?: SxProps<Theme>;
}

const placementMap: Record<string, { anchor: { vertical: 'top' | 'bottom'; horizontal: 'left' | 'right' }; transform: { vertical: 'top' | 'bottom'; horizontal: 'left' | 'right' } }> = {
  'bottom-start': { anchor: { vertical: 'bottom', horizontal: 'left' }, transform: { vertical: 'top', horizontal: 'left' } },
  'bottom-end': { anchor: { vertical: 'bottom', horizontal: 'right' }, transform: { vertical: 'top', horizontal: 'right' } },
  'top-start': { anchor: { vertical: 'top', horizontal: 'left' }, transform: { vertical: 'bottom', horizontal: 'left' } },
  'top-end': { anchor: { vertical: 'top', horizontal: 'right' }, transform: { vertical: 'bottom', horizontal: 'right' } },
};

export default function DropdownMenu({
  items,
  trigger,
  placement = 'bottom-start',
  width,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const handleClose = useCallback(() => setOpen(false), []);
  const handleToggle = useCallback(() => setOpen((prev) => !prev), []);

  const { anchor, transform } = placementMap[placement];

  return (
    <>
      <span
        ref={anchorRef}
        onClick={handleToggle}
        style={{ cursor: 'pointer', display: 'inline-flex' }}
      >
        {trigger}
      </span>

      <Menu
        open={open}
        anchorEl={anchorRef.current}
        onClose={handleClose}
        anchorOrigin={anchor}
        transformOrigin={transform}
        slotProps={{
          paper: {
            sx: {
              minWidth: width ?? 180,
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

DropdownMenu.displayName = 'DropdownMenu';
