import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ComponentSize } from '../types';
import { CopyButton } from '../buttons';
import type { DescriptionItem } from './types';

export interface DescriptionListProps {
  items: DescriptionItem[];
  columns?: 1 | 2 | 3;
  size?: ComponentSize;
}

const sizeMap: Record<string, { labelSize: string; valueSize: string; gap: number }> = {
  xs: { labelSize: '0.625rem', valueSize: '0.6875rem', gap: 1 },
  sm: { labelSize: '0.6875rem', valueSize: '0.75rem', gap: 1.5 },
  md: { labelSize: '0.75rem', valueSize: '0.8125rem', gap: 2 },
  lg: { labelSize: '0.8125rem', valueSize: '0.875rem', gap: 2.5 },
  xl: { labelSize: '0.875rem', valueSize: '1rem', gap: 3 },
};

export default function DescriptionList({
  items,
  columns = 1,
  size = 'md',
}: DescriptionListProps) {
  const s = sizeMap[size] || sizeMap.md;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: s.gap,
      }}
    >
      {items.map((item, i) => (
        <Box key={i}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
            {item.icon && (
              <Box sx={{ display: 'flex', alignItems: 'center', color: 'var(--ov-fg-muted)' }}>
                {item.icon}
              </Box>
            )}
            <Typography
              variant="caption"
              sx={{
                fontSize: s.labelSize,
                fontWeight: 600,
                color: 'var(--ov-fg-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {item.label}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography
              variant="body2"
              sx={{ fontSize: s.valueSize, color: 'var(--ov-fg-base)', wordBreak: 'break-word' }}
            >
              {item.value}
            </Typography>
            {item.copyable && (
              <CopyButton value={String(item.value)} size="xs" />
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

DescriptionList.displayName = 'DescriptionList';
