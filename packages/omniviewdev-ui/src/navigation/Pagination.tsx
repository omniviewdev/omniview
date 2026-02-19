import MuiPagination from '@mui/material/Pagination';
import Box from '@mui/material/Box';
import MuiIconButton from '@mui/material/IconButton';
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ComponentSize } from '../types';
import { toMuiSize } from '../types';

export interface PaginationProps {
  count: number;
  page: number;
  onChange: (page: number) => void;
  variant?: 'compact' | 'full';
  size?: ComponentSize;
  sx?: SxProps<Theme>;
}

export default function Pagination({
  count,
  page,
  onChange,
  variant = 'full',
  size = 'md',
  sx,
}: PaginationProps) {
  if (variant === 'compact') {
    const muiSize = toMuiSize(size);
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}) }}>
        <MuiIconButton
          size={muiSize}
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <LuChevronLeft />
        </MuiIconButton>
        <Box sx={{ fontSize: '0.8125rem', color: 'var(--ov-fg-default)' }}>
          {page} / {count}
        </Box>
        <MuiIconButton
          size={muiSize}
          disabled={page >= count}
          onClick={() => onChange(page + 1)}
        >
          <LuChevronRight />
        </MuiIconButton>
      </Box>
    );
  }

  return (
    <MuiPagination
      count={count}
      page={page}
      onChange={(_, newPage) => onChange(newPage)}
      size={toMuiSize(size)}
      sx={sx}
    />
  );
}

Pagination.displayName = 'Pagination';
