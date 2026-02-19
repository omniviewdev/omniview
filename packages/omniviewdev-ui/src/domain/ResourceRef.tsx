import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import type { ComponentSize } from '../types';

export interface ResourceRefProps {
  kind: string;
  name: string;
  namespace?: string;
  icon?: React.ReactNode;
  onNavigate?: () => void;
  size?: ComponentSize;
  interactive?: boolean;
}

const sizeMap: Record<string, { fontSize: string; chipSize: 'small' | 'medium' }> = {
  xs: { fontSize: '0.6875rem', chipSize: 'small' },
  sm: { fontSize: '0.75rem', chipSize: 'small' },
  md: { fontSize: '0.8125rem', chipSize: 'small' },
  lg: { fontSize: '0.875rem', chipSize: 'medium' },
  xl: { fontSize: '1rem', chipSize: 'medium' },
};

export default function ResourceRef({
  kind,
  name,
  namespace,
  icon,
  onNavigate,
  size = 'sm',
  interactive = false,
}: ResourceRefProps) {
  const s = sizeMap[size] || sizeMap.sm;

  const content = (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        cursor: interactive ? 'pointer' : undefined,
        '&:hover': interactive
          ? { '& .resource-name': { textDecoration: 'underline' } }
          : undefined,
      }}
      onClick={interactive ? onNavigate : undefined}
    >
      {icon && (
        <Box sx={{ display: 'flex', alignItems: 'center', color: 'var(--ov-fg-muted)', fontSize: s.fontSize }}>
          {icon}
        </Box>
      )}
      <Chip
        label={kind}
        size={s.chipSize}
        variant="outlined"
        sx={{
          height: 'auto',
          fontSize: '0.625rem',
          fontWeight: 600,
          color: 'var(--ov-fg-muted)',
          borderColor: 'var(--ov-border-default)',
          py: 0,
          '& .MuiChip-label': { px: 0.5, py: 0 },
        }}
      />
      <Typography
        className="resource-name"
        variant="body2"
        sx={{
          fontSize: s.fontSize,
          fontWeight: 500,
          color: interactive ? 'var(--ov-accent-fg)' : 'var(--ov-fg-base)',
        }}
        noWrap
      >
        {name}
      </Typography>
      {namespace && (
        <Typography variant="caption" sx={{ color: 'var(--ov-fg-faint)', fontSize: s.fontSize }}>
          ({namespace})
        </Typography>
      )}
    </Box>
  );

  return content;
}

ResourceRef.displayName = 'ResourceRef';
