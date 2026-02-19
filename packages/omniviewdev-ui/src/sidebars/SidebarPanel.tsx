import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';
import { LuSearch } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

export interface SidebarPanelProps {
  title: string;
  icon?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  searchable?: boolean;
  onSearch?: (query: string) => void;
  collapsible?: boolean;
  badge?: React.ReactNode;
  width?: number | string;
  sx?: SxProps<Theme>;
}

export default function SidebarPanel({
  title,
  icon,
  toolbar,
  children,
  searchable = false,
  onSearch,
  badge,
  width = 260,
  sx,
}: SidebarPanelProps) {
  const [search, setSearch] = useState('');

  const handleSearch = (value: string) => {
    setSearch(value);
    onSearch?.(value);
  };

  return (
    <Box
      sx={{
        width,
        minWidth: width,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'var(--ov-bg-surface)',
        borderRight: '1px solid var(--ov-border-default)',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.5,
          py: 1,
          minHeight: 36,
          borderBottom: '1px solid var(--ov-border-muted)',
        }}
      >
        {icon && (
          <Box sx={{ display: 'flex', alignItems: 'center', color: 'var(--ov-fg-muted)', fontSize: 14 }}>
            {icon}
          </Box>
        )}
        <Typography
          variant="subtitle2"
          sx={{
            flex: 1,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--ov-fg-muted)',
          }}
          noWrap
        >
          {title}
        </Typography>
        {badge}
        {toolbar}
      </Box>

      {/* Search */}
      {searchable && (
        <Box sx={{ px: 1, py: 0.75, borderBottom: '1px solid var(--ov-border-muted)' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 1,
              py: 0.25,
              borderRadius: 1,
              bgcolor: 'var(--ov-bg-base)',
              border: '1px solid var(--ov-border-default)',
            }}
          >
            <LuSearch size={13} color="var(--ov-fg-faint)" />
            <InputBase
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search..."
              sx={{
                flex: 1,
                fontSize: 12,
                '& input': { padding: 0 },
                '& input::placeholder': { color: 'var(--ov-fg-faint)', opacity: 1 },
              }}
            />
          </Box>
        </Box>
      )}

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'auto', py: 0.5 }}>
        {children}
      </Box>
    </Box>
  );
}

SidebarPanel.displayName = 'SidebarPanel';
