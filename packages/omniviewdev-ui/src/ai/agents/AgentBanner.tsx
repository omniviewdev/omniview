import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiButton from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AgentBannerProps {
  taskName: string;
  status: 'running' | 'paused' | 'completed' | 'error';
  onView?: () => void;
  onDismiss?: () => void;
  sx?: SxProps<Theme>;
}

const bannerColors: Record<AgentBannerProps['status'], string> = {
  running: 'var(--ov-accent)',
  paused: 'var(--ov-warning-default)',
  completed: 'var(--ov-success-default)',
  error: 'var(--ov-danger-default)',
};

export default function AgentBanner({
  taskName,
  status,
  onView,
  onDismiss,
  sx,
}: AgentBannerProps) {
  const color = bannerColors[status];

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 0.75,
        bgcolor: `color-mix(in srgb, ${color} 10%, transparent)`,
        borderLeft: `3px solid ${color}`,
        borderRadius: '0 4px 4px 0',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {status === 'running' && (
        <CircularProgress size={14} sx={{ color }} />
      )}

      <Typography
        sx={{
          flex: 1,
          fontSize: 'var(--ov-text-sm)',
          color: 'var(--ov-fg-default)',
        }}
      >
        {status === 'running' && 'Agent running: '}
        {status === 'paused' && 'Agent paused: '}
        {status === 'completed' && 'Agent completed: '}
        {status === 'error' && 'Agent error: '}
        <Typography component="span" sx={{ fontWeight: 600, fontSize: 'inherit' }}>
          {taskName}
        </Typography>
      </Typography>

      {onView && (
        <MuiButton
          size="small"
          variant="text"
          onClick={onView}
          sx={{
            fontSize: 'var(--ov-text-xs)',
            color,
            textTransform: 'none',
            minWidth: 'auto',
          }}
        >
          View
        </MuiButton>
      )}

      {onDismiss && (
        <MuiButton
          size="small"
          variant="text"
          onClick={onDismiss}
          sx={{
            fontSize: 'var(--ov-text-xs)',
            color: 'var(--ov-fg-faint)',
            textTransform: 'none',
            minWidth: 'auto',
          }}
        >
          Dismiss
        </MuiButton>
      )}
    </Box>
  );
}

AgentBanner.displayName = 'AgentBanner';
