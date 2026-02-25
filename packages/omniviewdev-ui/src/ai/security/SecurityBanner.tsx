import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ShieldIcon from '@mui/icons-material/Shield';
import type { SxProps, Theme } from '@mui/material/styles';

export interface SecurityBannerProps {
  connection: string;
  level: 'read-only' | 'read-write' | 'full-access' | 'restricted';
  permissions?: string[];
  sx?: SxProps<Theme>;
}

const levelColors: Record<SecurityBannerProps['level'], string> = {
  'read-only': 'var(--ov-info-default)',
  'read-write': 'var(--ov-warning-default)',
  'full-access': 'var(--ov-danger-default)',
  restricted: 'var(--ov-fg-faint)',
};

export default function SecurityBanner({
  connection,
  level,
  permissions,
  sx,
}: SecurityBannerProps) {
  const color = levelColors[level];

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 0.75,
        bgcolor: `color-mix(in srgb, ${color} 8%, transparent)`,
        borderBottom: '1px solid var(--ov-border-default)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <ShieldIcon sx={{ fontSize: 16, color }} />

      <Typography
        sx={{
          fontSize: 'var(--ov-text-sm)',
          color: 'var(--ov-fg-default)',
        }}
      >
        <Typography component="span" sx={{ fontWeight: 600, fontSize: 'inherit' }}>
          {connection}
        </Typography>
        {' \u2014 '}
        <Typography component="span" sx={{ color, fontSize: 'inherit', fontWeight: 600 }}>
          {level.replace('-', ' ')}
        </Typography>
      </Typography>

      {permissions && permissions.length > 0 && (
        <Typography
          sx={{
            fontSize: 'var(--ov-text-xs)',
            color: 'var(--ov-fg-faint)',
            ml: 'auto',
          }}
        >
          {permissions.join(', ')}
        </Typography>
      )}
    </Box>
  );
}

SecurityBanner.displayName = 'SecurityBanner';
