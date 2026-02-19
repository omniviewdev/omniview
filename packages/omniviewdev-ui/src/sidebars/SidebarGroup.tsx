import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import Chip from '@mui/material/Chip';
import { LuChevronRight, LuChevronDown } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

export interface SidebarGroupProps {
  title: string;
  count?: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
  sx?: SxProps<Theme>;
}

export default function SidebarGroup({
  title,
  count,
  defaultExpanded = true,
  children,
  actions,
  sx,
}: SidebarGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <Box sx={sx}>
      {/* Group header */}
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          px: 1,
          py: 0.5,
          cursor: 'pointer',
          userSelect: 'none',
          '&:hover': { bgcolor: 'var(--ov-state-hover)' },
          '&:hover .sidebar-group-actions': { opacity: 1 },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--ov-fg-faint)' }}>
          {expanded ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
        </Box>
        <Typography
          variant="caption"
          sx={{
            flex: 1,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--ov-fg-muted)',
            lineHeight: 1.4,
          }}
          noWrap
        >
          {title}
        </Typography>
        {count != null && (
          <Chip
            label={count}
            size="small"
            sx={{
              height: 16,
              fontSize: 10,
              fontWeight: 600,
              bgcolor: 'var(--ov-state-hover)',
              color: 'var(--ov-fg-muted)',
              '& .MuiChip-label': { px: 0.75 },
            }}
          />
        )}
        {actions && (
          <Box
            className="sidebar-group-actions"
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

      {/* Group content */}
      <Collapse in={expanded} unmountOnExit>
        {children}
      </Collapse>
    </Box>
  );
}

SidebarGroup.displayName = 'SidebarGroup';
