import React, { useState, useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import Divider from '@mui/material/Divider';
import type { SxProps, Theme } from '@mui/material/styles';

import type { MenuBarItem } from './types';
import NestedMenuItem from './NestedMenuItem';

export interface MenuBarProps {
  menus: MenuBarItem[];
  sx?: SxProps<Theme>;
}

export default function MenuBar({ menus, sx }: MenuBarProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const handleClose = useCallback(() => setActiveKey(null), []);

  const handleClick = useCallback((key: string) => {
    setActiveKey((prev) => (prev === key ? null : key));
  }, []);

  const handleMouseEnter = useCallback((key: string) => {
    if (activeKey !== null) {
      setActiveKey(key);
    }
  }, [activeKey]);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        height: 32,
        bgcolor: 'var(--ov-bg-surface)',
        borderBottom: '1px solid var(--ov-border-default)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {menus.map((menu) => (
        <React.Fragment key={menu.key}>
          <Box
            component="button"
            ref={(el: HTMLButtonElement | null) => { refs.current[menu.key] = el; }}
            onClick={() => handleClick(menu.key)}
            onMouseEnter={() => handleMouseEnter(menu.key)}
            sx={{
              border: 'none',
              background: activeKey === menu.key ? 'var(--ov-state-hover)' : 'transparent',
              color: 'var(--ov-fg-default)',
              fontSize: 'var(--ov-text-sm)',
              fontFamily: 'var(--ov-font-ui)',
              px: 1.5,
              py: 0.5,
              cursor: 'pointer',
              borderRadius: '4px',
              '&:hover': { bgcolor: 'var(--ov-state-hover)' },
            }}
          >
            {menu.label}
          </Box>

          <Menu
            open={activeKey === menu.key}
            anchorEl={refs.current[menu.key]}
            onClose={handleClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{
              paper: {
                sx: {
                  minWidth: 200,
                  bgcolor: 'var(--ov-bg-surface)',
                  border: '1px solid var(--ov-border-default)',
                },
              },
            }}
          >
            {menu.items.map((item) => (
              <React.Fragment key={item.key}>
                <NestedMenuItem item={item} onClose={handleClose} />
                {item.dividerAfter && <Divider />}
              </React.Fragment>
            ))}
          </Menu>
        </React.Fragment>
      ))}
    </Box>
  );
}

MenuBar.displayName = 'MenuBar';
