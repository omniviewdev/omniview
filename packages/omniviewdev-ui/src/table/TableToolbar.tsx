import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { SearchInput } from '../inputs';

export interface TableToolbarProps {
  title?: string;
  searchValue?: string;
  onSearch?: (value: string) => void;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  selectedCount?: number;
  sx?: SxProps<Theme>;
}

export default function TableToolbar({
  title,
  searchValue,
  onSearch,
  filters,
  actions,
  selectedCount,
  sx,
}: TableToolbarProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 1.5,
        py: 1,
        borderBottom: '1px solid var(--ov-border-default)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      }}
    >
      {title && (
        <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'var(--ov-fg-base)', mr: 1 }}>
          {title}
        </Typography>
      )}

      {selectedCount != null && selectedCount > 0 && (
        <Typography variant="body2" sx={{ color: 'var(--ov-accent-fg)', fontWeight: 500 }}>
          {selectedCount} selected
        </Typography>
      )}

      {onSearch && (
        <SearchInput
          value={searchValue ?? ''}
          onChange={onSearch}
          placeholder="Search..."
        />
      )}

      {filters && (
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          {filters}
        </Box>
      )}

      <Box sx={{ flex: 1 }} />

      {actions && (
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          {actions}
        </Box>
      )}
    </Box>
  );
}

TableToolbar.displayName = 'TableToolbar';
