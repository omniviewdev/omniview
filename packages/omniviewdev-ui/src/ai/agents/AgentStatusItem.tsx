import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiTooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';
import { LuBot } from 'react-icons/lu';

export type AgentStatus = 'idle' | 'running' | 'paused' | 'error' | 'completed';

export interface AgentStatusItemProps {
  status: AgentStatus;
  taskName?: string;
  progress?: number;
  onClick?: () => void;
  sx?: SxProps<Theme>;
}

const statusColors: Record<AgentStatus, string> = {
  idle: 'var(--ov-fg-faint)',
  running: 'var(--ov-accent)',
  paused: 'var(--ov-warning-default)',
  error: 'var(--ov-danger-default)',
  completed: 'var(--ov-success-default)',
};

const statusLabels: Record<AgentStatus, string> = {
  idle: 'Agent idle',
  running: 'Agent running',
  paused: 'Agent paused',
  error: 'Agent error',
  completed: 'Agent completed',
};

export default function AgentStatusItem({
  status,
  taskName,
  progress,
  onClick,
  sx,
}: AgentStatusItemProps) {
  const color = statusColors[status];
  const tooltip = taskName ? `${statusLabels[status]}: ${taskName}` : statusLabels[status];

  const content = (
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        height: 20,
        fontSize: 'var(--ov-text-xs)',
        color,
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: '3px',
        whiteSpace: 'nowrap',
        ...(onClick && {
          '&:hover': { bgcolor: 'var(--ov-state-hover)' },
        }),
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {status === 'running' ? (
        <CircularProgress size={10} sx={{ color }} />
      ) : (
        <Box
          component="span"
          sx={{ display: 'inline-flex', fontSize: '0.75rem' }}
        >
          <LuBot size={12} />
        </Box>
      )}

      <Typography component="span" sx={{ fontSize: 'inherit', color: 'inherit' }}>
        {taskName || statusLabels[status]}
      </Typography>

      {progress !== undefined && (
        <Typography component="span" sx={{ fontSize: 'inherit', color: 'var(--ov-fg-faint)' }}>
          {Math.round(progress)}%
        </Typography>
      )}
    </Box>
  );

  return <MuiTooltip title={tooltip}>{content}</MuiTooltip>;
}

AgentStatusItem.displayName = 'AgentStatusItem';
