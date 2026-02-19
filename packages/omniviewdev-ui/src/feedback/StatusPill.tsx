import Chip from '@mui/material/Chip';
import type { SxProps, Theme } from '@mui/material/styles';

import type { Status, ComponentSize } from '../types';
import { statusToColor, toMuiColor } from '../types';

export interface StatusPillProps {
  status: Status;
  size?: ComponentSize;
  label?: string;
  sx?: SxProps<Theme>;
}

export default function StatusPill({
  status,
  size = 'sm',
  label,
  sx,
}: StatusPillProps) {
  const semanticColor = statusToColor(status);
  const muiColor = toMuiColor(semanticColor) as any;
  const displayLabel = label ?? status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <Chip
      label={displayLabel}
      color={muiColor === 'default' || muiColor === 'inherit' ? undefined : muiColor}
      variant="outlined"
      size={size === 'xs' || size === 'sm' ? 'small' : 'medium'}
      sx={{
        fontWeight: 500,
        fontSize: size === 'xs' ? 'var(--ov-text-xs)' : 'var(--ov-text-sm)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    />
  );
}

StatusPill.displayName = 'StatusPill';
