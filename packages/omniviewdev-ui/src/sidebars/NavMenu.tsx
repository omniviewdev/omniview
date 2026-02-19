import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import { LuChevronRight, LuChevronDown } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ComponentSize } from '../types';
import type { NavSection, NavMenuItem as NavMenuItemType } from './types';

export interface NavMenuProps {
  sections: NavSection[];
  selected?: string;
  onSelect?: (id: string) => void;
  size?: ComponentSize;
  sx?: SxProps<Theme>;
}

const fontSizeMap: Record<ComponentSize, number> = {
  xs: 11,
  sm: 12,
  md: 13,
  lg: 14,
  xl: 15,
};

function NavMenuItemComponent({
  item,
  depth,
  selected,
  onSelect,
  fontSize,
}: {
  item: NavMenuItemType;
  depth: number;
  selected?: string;
  onSelect?: (id: string) => void;
  fontSize: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selected === item.id;
  const hasChildren = item.children && item.children.length > 0;

  return (
    <Box>
      <Box
        onClick={() => {
          if (item.disabled) return;
          if (hasChildren) {
            setExpanded(!expanded);
          }
          onSelect?.(item.id);
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.5,
          py: 0.5,
          pl: depth * 1.5 + 1.5,
          cursor: item.disabled ? 'default' : 'pointer',
          opacity: item.disabled ? 0.5 : 1,
          borderRadius: '4px',
          mx: 0.5,
          my: 0.25,
          bgcolor: isSelected ? 'var(--ov-accent-subtle)' : 'transparent',
          color: isSelected ? 'var(--ov-accent-fg)' : 'var(--ov-fg-default)',
          fontWeight: isSelected ? 500 : 400,
          '&:hover': {
            bgcolor: isSelected ? 'var(--ov-accent-subtle)' : 'var(--ov-state-hover)',
          },
        }}
      >
        {hasChildren && (
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--ov-fg-faint)' }}>
            {expanded ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
          </Box>
        )}
        {item.icon && (
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, fontSize: fontSize + 2 }}>
            {item.icon}
          </Box>
        )}
        <Typography
          variant="body2"
          sx={{ flex: 1, fontSize, color: 'inherit', fontWeight: 'inherit' }}
          noWrap
        >
          {item.label}
        </Typography>
        {item.badge}
      </Box>
      {hasChildren && item.children && (
        <Collapse in={expanded} unmountOnExit>
          {item.children.map((child) => (
            <NavMenuItemComponent
              key={child.id}
              item={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              fontSize={fontSize}
            />
          ))}
        </Collapse>
      )}
    </Box>
  );
}

export default function NavMenu({
  sections,
  selected,
  onSelect,
  size = 'md',
  sx,
}: NavMenuProps) {
  const fontSize = fontSizeMap[size];

  return (
    <Box sx={sx}>
      {sections.map((section, i) => (
        <Box key={section.title} sx={{ mb: 1, mt: i === 0 ? 0 : 0.5 }}>
          <Typography
            variant="overline"
            sx={{
              display: 'block',
              px: 2,
              py: 0.5,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: 'var(--ov-fg-faint)',
              textTransform: 'uppercase',
            }}
          >
            {section.title}
          </Typography>
          {section.items.map((item) => (
            <NavMenuItemComponent
              key={item.id}
              item={item}
              depth={0}
              selected={selected}
              onSelect={onSelect}
              fontSize={fontSize}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}

NavMenu.displayName = 'NavMenu';
