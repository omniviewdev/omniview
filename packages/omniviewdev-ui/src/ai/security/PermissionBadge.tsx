import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiTooltip from '@mui/material/Tooltip';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import type { SxProps, Theme } from '@mui/material/styles';

export interface PermissionBadgeProps {
  level: 'read-only' | 'read-write' | 'full-access' | 'restricted';
  tooltip?: string;
  sx?: SxProps<Theme>;
}

const levelConfig: Record<
  PermissionBadgeProps['level'],
  { color: string; label: string; icon: React.ReactNode }
> = {
  'read-only': {
    color: 'var(--ov-info-default)',
    label: 'Read-only',
    icon: <LockIcon sx={{ fontSize: 12 }} />,
  },
  'read-write': {
    color: 'var(--ov-warning-default)',
    label: 'Read-write',
    icon: <LockOpenIcon sx={{ fontSize: 12 }} />,
  },
  'full-access': {
    color: 'var(--ov-danger-default)',
    label: 'Full access',
    icon: <LockOpenIcon sx={{ fontSize: 12 }} />,
  },
  restricted: {
    color: 'var(--ov-fg-faint)',
    label: 'Restricted',
    icon: <LockIcon sx={{ fontSize: 12 }} />,
  },
};

export default function PermissionBadge({
  level,
  tooltip,
  sx,
}: PermissionBadgeProps) {
  const config = levelConfig[level];

  const badge = (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        py: 0.25,
        borderRadius: '4px',
        bgcolor: `color-mix(in srgb, ${config.color} 15%, transparent)`,
        color: config.color,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {config.icon}
      <Typography sx={{ fontSize: 'var(--ov-text-xs)', fontWeight: 600 }}>
        {config.label}
      </Typography>
    </Box>
  );

  if (tooltip) {
    return <MuiTooltip title={tooltip}>{badge}</MuiTooltip>;
  }

  return badge;
}

PermissionBadge.displayName = 'PermissionBadge';
