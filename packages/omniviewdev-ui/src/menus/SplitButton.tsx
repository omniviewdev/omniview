import { useState, useRef, useCallback } from 'react';
import MuiButton from '@mui/material/Button';
import MuiButtonGroup from '@mui/material/ButtonGroup';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import { LuChevronDown } from 'react-icons/lu';

import type { SemanticColor, Emphasis, ComponentSize } from '../types';
import { toMuiColor, toMuiVariant, toMuiSize } from '../types';
import type { SplitButtonOption } from './types';

export interface SplitButtonProps {
  options: SplitButtonOption[];
  onSelect: (option: SplitButtonOption) => void;
  defaultIndex?: number;
  color?: SemanticColor;
  emphasis?: Emphasis;
  size?: ComponentSize;
}

export default function SplitButton({
  options,
  onSelect,
  defaultIndex = 0,
  color = 'primary',
  emphasis = 'soft',
  size = 'sm',
}: SplitButtonProps) {
  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  const muiColor = toMuiColor(color) as any;
  const muiVariant = toMuiVariant(emphasis) as any;
  const muiSize = toMuiSize(size) as any;

  const handleClick = useCallback(() => {
    const option = options[selectedIndex];
    if (option && !option.disabled) {
      onSelect(option);
    }
  }, [options, selectedIndex, onSelect]);

  const handleMenuItemClick = useCallback((index: number) => {
    setSelectedIndex(index);
    setOpen(false);
    onSelect(options[index]);
  }, [options, onSelect]);

  const selected = options[selectedIndex];

  return (
    <>
      <MuiButtonGroup
        ref={anchorRef}
        variant={muiVariant}
        color={muiColor}
        size={muiSize}
      >
        <MuiButton
          onClick={handleClick}
          disabled={selected?.disabled}
          startIcon={selected?.icon}
        >
          {selected?.label}
        </MuiButton>
        <MuiButton
          onClick={() => setOpen((prev) => !prev)}
          sx={{ px: 0.5, minWidth: 'auto' }}
          aria-label="Select option"
        >
          <LuChevronDown size={14} />
        </MuiButton>
      </MuiButtonGroup>

      <Menu
        open={open}
        anchorEl={anchorRef.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
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
        {options.map((option, index) => (
          <MenuItem
            key={option.key}
            disabled={option.disabled}
            selected={index === selectedIndex}
            onClick={() => handleMenuItemClick(index)}
            sx={{ fontSize: 'var(--ov-text-sm)' }}
          >
            {option.icon && (
              <ListItemIcon sx={{ minWidth: 28 }}>{option.icon}</ListItemIcon>
            )}
            <ListItemText>{option.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

SplitButton.displayName = 'SplitButton';
