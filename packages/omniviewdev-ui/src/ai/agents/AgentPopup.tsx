import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Popover from '@mui/material/Popover';
import type { SxProps, Theme } from '@mui/material/styles';

import AgentTaskList from './AgentTaskList';
import AgentControls from './AgentControls';
import type { AgentTask } from './AgentTaskList';
import type { AgentStatus } from './AgentStatusItem';

export interface AgentPopupProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  agent: {
    id: string;
    status: AgentStatus;
    taskName: string;
    startedAt: string;
    tasks: AgentTask[];
    output?: string[];
  };
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onDetach?: () => void;
  sx?: SxProps<Theme>;
}

export default function AgentPopup({
  open,
  anchorEl,
  onClose,
  agent,
  onPause,
  onResume,
  onCancel,
  onDetach,
  sx,
}: AgentPopupProps) {
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      slotProps={{
        paper: {
          sx: {
            width: 380,
            maxHeight: 480,
            bgcolor: 'var(--ov-bg-surface)',
            border: '1px solid var(--ov-border-default)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
          } as SxProps<Theme>,
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 1,
          borderBottom: '1px solid var(--ov-border-default)',
        }}
      >
        <Box>
          <Typography
            sx={{
              fontSize: 'var(--ov-text-sm)',
              fontWeight: 600,
              color: 'var(--ov-fg-default)',
            }}
          >
            {agent.taskName}
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--ov-text-xs)',
              color: 'var(--ov-fg-faint)',
            }}
          >
            Started {agent.startedAt}
          </Typography>
        </Box>

        <AgentControls
          status={agent.status}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
          onDetach={onDetach}
        />
      </Box>

      {/* Tasks */}
      {agent.tasks.length > 0 && (
        <Box sx={{ flex: 1, overflow: 'auto', px: 1.5, py: 1 }}>
          <AgentTaskList tasks={agent.tasks} />
        </Box>
      )}

      {/* Output log */}
      {agent.output && agent.output.length > 0 && (
        <Box
          sx={{
            borderTop: '1px solid var(--ov-border-default)',
            maxHeight: 150,
            overflow: 'auto',
            px: 1.5,
            py: 1,
            bgcolor: 'var(--ov-bg-surface-inset)',
          }}
        >
          <pre
            style={{
              margin: 0,
              fontFamily: 'var(--ov-font-mono)',
              fontSize: '11px',
              lineHeight: 1.5,
              color: 'var(--ov-fg-muted)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {agent.output.join('\n')}
          </pre>
        </Box>
      )}
    </Popover>
  );
}

AgentPopup.displayName = 'AgentPopup';
