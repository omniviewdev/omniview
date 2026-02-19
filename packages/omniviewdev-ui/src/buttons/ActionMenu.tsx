import React, { useState, useRef } from 'react';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import MoreVertIcon from '@mui/icons-material/MoreVert';

import type { ComponentSize, SemanticColor } from '../types';
import IconButton from './IconButton';

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  color?: SemanticColor;
  disabled?: boolean;
  dividerAfter?: boolean;
  onClick: () => void;
}

export interface ActionMenuProps {
  items: ActionMenuItem[];
  trigger?: React.ReactNode;
  size?: ComponentSize;
}

export default function ActionMenu({
  items,
  trigger,
  size = 'sm',
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const handleClose = () => setOpen(false);

  return (
    <>
      <span ref={anchorRef as any}>
        {trigger ? (
          <span onClick={() => setOpen(true)} style={{ cursor: 'pointer' }}>
            {trigger}
          </span>
        ) : (
          <IconButton
            size={size}
            color="neutral"
            onClick={() => setOpen(true)}
            aria-label="Actions"
          >
            <MoreVertIcon fontSize="inherit" />
          </IconButton>
        )}
      </span>

      <Menu
        open={open}
        anchorEl={anchorRef.current}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 160,
              bgcolor: 'var(--ov-bg-surface)',
              border: '1px solid var(--ov-border-default)',
            },
          },
        }}
      >
        {items.map((item) => [
          <MenuItem
            key={item.key}
            disabled={item.disabled}
            onClick={() => {
              handleClose();
              item.onClick();
            }}
            sx={{
              fontSize: 'var(--ov-text-sm)',
              color: item.color === 'danger' || item.color === 'error'
                ? 'var(--ov-danger-default)'
                : 'var(--ov-fg-default)',
            }}
          >
            {item.icon && (
              <ListItemIcon sx={{ color: 'inherit', minWidth: 28 }}>
                {item.icon}
              </ListItemIcon>
            )}
            <ListItemText>{item.label}</ListItemText>
          </MenuItem>,
          item.dividerAfter && <Divider key={`${item.key}-divider`} />,
        ])}
      </Menu>
    </>
  );
}

ActionMenu.displayName = 'ActionMenu';
