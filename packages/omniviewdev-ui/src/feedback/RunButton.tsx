import MuiButton from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';
import { LuPlay, LuSquare } from 'react-icons/lu';

import type { SemanticColor, ComponentSize } from '../types';
import { toMuiSize } from '../types';

export interface RunButtonProps {
  running: boolean;
  onStart: () => void;
  onStop: () => void;
  loading?: boolean;
  color?: SemanticColor;
  size?: ComponentSize;
  label?: string;
  sx?: SxProps<Theme>;
}

const iconSizeMap: Record<ComponentSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
};

export default function RunButton({
  running,
  onStart,
  onStop,
  loading = false,
  size = 'sm',
  label,
  sx,
}: RunButtonProps) {
  const muiSize = toMuiSize(size) as any;
  const iconSize = iconSizeMap[size];

  const handleClick = () => {
    if (running) {
      onStop();
    } else {
      onStart();
    }
  };

  const icon = loading ? (
    <CircularProgress size={iconSize} color="inherit" />
  ) : running ? (
    <LuSquare size={iconSize} />
  ) : (
    <LuPlay size={iconSize} />
  );

  return (
    <MuiButton
      size={muiSize}
      variant="contained"
      onClick={handleClick}
      disabled={loading}
      startIcon={icon}
      sx={{
        bgcolor: running ? 'var(--ov-danger-default)' : 'var(--ov-success-default)',
        color: '#fff',
        textTransform: 'none',
        '&:hover': {
          bgcolor: running ? 'var(--ov-danger-default)' : 'var(--ov-success-default)',
          filter: 'brightness(0.9)',
        },
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {label ?? (running ? 'Stop' : 'Run')}
    </MuiButton>
  );
}

RunButton.displayName = 'RunButton';
