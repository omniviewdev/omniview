import Box from '@mui/material/Box';
import MuiIconButton from '@mui/material/IconButton';
import MuiTooltip from '@mui/material/Tooltip';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { SxProps, Theme } from '@mui/material/styles';

import type { AgentStatus } from './AgentStatusItem';

export interface AgentControlsProps {
  status: AgentStatus;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onDetach?: () => void;
  sx?: SxProps<Theme>;
}

export default function AgentControls({
  status,
  onPause,
  onResume,
  onCancel,
  onDetach,
  sx,
}: AgentControlsProps) {
  const btnSx = {
    color: 'var(--ov-fg-muted)',
    '&:hover': { color: 'var(--ov-fg-default)' },
  };

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {status === 'running' && onPause && (
        <MuiTooltip title="Pause">
          <MuiIconButton size="small" onClick={onPause} sx={btnSx}>
            <PauseIcon sx={{ fontSize: 16 }} />
          </MuiIconButton>
        </MuiTooltip>
      )}

      {status === 'paused' && onResume && (
        <MuiTooltip title="Resume">
          <MuiIconButton size="small" onClick={onResume} sx={btnSx}>
            <PlayArrowIcon sx={{ fontSize: 16 }} />
          </MuiIconButton>
        </MuiTooltip>
      )}

      {(status === 'running' || status === 'paused') && onCancel && (
        <MuiTooltip title="Cancel">
          <MuiIconButton
            size="small"
            onClick={onCancel}
            sx={{ color: 'var(--ov-danger-default)', '&:hover': { color: 'var(--ov-danger-default)' } }}
          >
            <StopIcon sx={{ fontSize: 16 }} />
          </MuiIconButton>
        </MuiTooltip>
      )}

      {status === 'running' && onDetach && (
        <MuiTooltip title="Run in background">
          <MuiIconButton size="small" onClick={onDetach} sx={btnSx}>
            <OpenInNewIcon sx={{ fontSize: 14 }} />
          </MuiIconButton>
        </MuiTooltip>
      )}
    </Box>
  );
}

AgentControls.displayName = 'AgentControls';
