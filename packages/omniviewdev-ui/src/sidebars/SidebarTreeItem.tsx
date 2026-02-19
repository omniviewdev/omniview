import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuChevronRight, LuChevronDown } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

export interface SidebarTreeItemProps {
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  depth?: number;
  selected?: boolean;
  expanded?: boolean;
  hasChildren?: boolean;
  onClick?: () => void;
  onToggle?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  sx?: SxProps<Theme>;
}

export default function SidebarTreeItem({
  label,
  icon,
  badge,
  actions,
  depth = 0,
  selected = false,
  expanded = false,
  hasChildren = false,
  onClick,
  onToggle,
  onContextMenu,
  sx,
}: SidebarTreeItemProps) {
  return (
    <Box
      onClick={onClick}
      onContextMenu={onContextMenu}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        py: 0.25,
        pr: 1,
        pl: depth * 1.5 + 1,
        cursor: 'pointer',
        minHeight: 24,
        borderRadius: '4px',
        mx: 0.5,
        bgcolor: selected ? 'var(--ov-accent-subtle)' : 'transparent',
        color: selected ? 'var(--ov-accent-fg)' : 'var(--ov-fg-default)',
        '&:hover': {
          bgcolor: selected ? 'var(--ov-accent-subtle)' : 'var(--ov-state-hover)',
        },
        '&:hover .tree-item-actions': { opacity: 1 },
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Expand/collapse chevron */}
      {hasChildren ? (
        <Box
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            color: 'var(--ov-fg-faint)',
            '&:hover': { color: 'var(--ov-fg-default)' },
          }}
        >
          {expanded ? <LuChevronDown size={14} /> : <LuChevronRight size={14} />}
        </Box>
      ) : (
        <Box sx={{ width: 14, flexShrink: 0 }} />
      )}

      {/* Icon */}
      {icon && (
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, fontSize: 14 }}>
          {icon}
        </Box>
      )}

      {/* Label */}
      <Typography
        variant="body2"
        sx={{
          flex: 1,
          fontSize: 12,
          color: 'inherit',
          lineHeight: 1.4,
        }}
        noWrap
      >
        {label}
      </Typography>

      {/* Badge */}
      {badge}

      {/* Hover actions */}
      {actions && (
        <Box
          className="tree-item-actions"
          onClick={(e) => e.stopPropagation()}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.25,
            opacity: 0,
            transition: 'opacity 100ms ease',
          }}
        >
          {actions}
        </Box>
      )}
    </Box>
  );
}

SidebarTreeItem.displayName = 'SidebarTreeItem';
