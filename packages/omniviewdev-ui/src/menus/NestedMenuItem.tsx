import React, { useState, useRef } from 'react';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import { LuChevronRight } from 'react-icons/lu';

import type { ContextMenuItem } from './types';
import HotkeyHint from '../components/HotkeyHint';

export interface NestedMenuItemProps {
  item: ContextMenuItem;
  onClose: () => void;
}

export default function NestedMenuItem({ item, onClose }: NestedMenuItemProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  const handleClick = () => {
    if (item.onClick) {
      item.onClick();
      onClose();
    }
  };

  if (!item.children?.length) {
    return (
      <MenuItem
        ref={ref}
        disabled={item.disabled}
        onClick={handleClick}
        sx={{
          fontSize: 'var(--ov-text-sm)',
          color: item.color === 'danger' || item.color === 'error'
            ? 'var(--ov-danger-default)'
            : 'var(--ov-fg-default)',
          gap: 0.5,
        }}
      >
        {item.icon && (
          <ListItemIcon sx={{ color: 'inherit', minWidth: 24 }}>
            {item.icon}
          </ListItemIcon>
        )}
        <ListItemText>{item.label}</ListItemText>
        {item.shortcut && (
          <HotkeyHint keys={item.shortcut} />
        )}
      </MenuItem>
    );
  }

  return (
    <>
      <MenuItem
        ref={ref}
        disabled={item.disabled}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onClick={handleOpen}
        sx={{
          fontSize: 'var(--ov-text-sm)',
          color: item.color === 'danger' || item.color === 'error'
            ? 'var(--ov-danger-default)'
            : 'var(--ov-fg-default)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 0.5,
        }}
      >
        {item.icon && (
          <ListItemIcon sx={{ color: 'inherit', minWidth: 24 }}>
            {item.icon}
          </ListItemIcon>
        )}
        <ListItemText>{item.label}</ListItemText>
        <LuChevronRight size={14} />
      </MenuItem>

      <Menu
        open={open}
        anchorEl={ref.current}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 160,
              bgcolor: 'var(--ov-bg-surface)',
              border: '1px solid var(--ov-border-default)',
              pointerEvents: 'auto',
            },
            onMouseEnter: handleOpen,
            onMouseLeave: handleClose,
          },
        }}
        sx={{ pointerEvents: 'none' }}
        disableAutoFocus
        disableEnforceFocus
      >
        {item.children!.map((child) => (
          <React.Fragment key={child.key}>
            <NestedMenuItem item={child} onClose={onClose} />
            {child.dividerAfter && (
              <hr style={{
                margin: '4px 0',
                border: 'none',
                borderTop: '1px solid var(--ov-border-muted)',
              }} />
            )}
          </React.Fragment>
        ))}
      </Menu>
    </>
  );
}

NestedMenuItem.displayName = 'NestedMenuItem';
