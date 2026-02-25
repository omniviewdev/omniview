import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PendingIcon from '@mui/icons-material/Pending';
import type { SxProps, Theme } from '@mui/material/styles';

export interface AgentTask {
  id: string;
  label: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  detail?: string;
  timestamp?: string;
}

export interface AgentTaskListProps {
  tasks: AgentTask[];
  sx?: SxProps<Theme>;
}

const statusIcons: Record<AgentTask['status'], React.ReactNode> = {
  queued: <PendingIcon sx={{ fontSize: 14, color: 'var(--ov-fg-faint)' }} />,
  running: <CircularProgress size={12} sx={{ color: 'var(--ov-accent)' }} />,
  complete: <CheckCircleIcon sx={{ fontSize: 14, color: 'var(--ov-success-default)' }} />,
  failed: <ErrorIcon sx={{ fontSize: 14, color: 'var(--ov-danger-default)' }} />,
};

export default function AgentTaskList({ tasks, sx }: AgentTaskListProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {tasks.map((task) => (
        <Box
          key={task.id}
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1,
            py: 0.5,
          }}
        >
          <Box sx={{ pt: '2px' }}>
            {statusIcons[task.status]}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: 'var(--ov-text-sm)',
                color: task.status === 'queued' ? 'var(--ov-fg-faint)' : 'var(--ov-fg-default)',
                fontWeight: task.status === 'running' ? 600 : 400,
              }}
            >
              {task.label}
            </Typography>
            {task.detail && (
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-fg-faint)',
                  mt: 0.25,
                }}
              >
                {task.detail}
              </Typography>
            )}
          </Box>
          {task.timestamp && (
            <Typography
              sx={{
                fontSize: 'var(--ov-text-xs)',
                color: 'var(--ov-fg-faint)',
                whiteSpace: 'nowrap',
              }}
            >
              {task.timestamp}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}

AgentTaskList.displayName = 'AgentTaskList';
