import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AILoaderProps {
  label?: string;
  size?: number;
  sx?: SxProps<Theme>;
}

export default function AILoader({
  label = 'Processing...',
  size = 20,
  sx,
}: AILoaderProps) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 0.75,
        borderRadius: '6px',
        bgcolor: 'var(--ov-bg-surface)',
        border: '1px solid var(--ov-border-default)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <CircularProgress size={size} sx={{ color: 'var(--ov-accent)' }} />
      {label && (
        <Typography
          sx={{
            fontSize: 'var(--ov-text-sm)',
            color: 'var(--ov-fg-muted)',
          }}
        >
          {label}
        </Typography>
      )}
    </Box>
  );
}

AILoader.displayName = 'AILoader';
