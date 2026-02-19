import MuiPopover from '@mui/material/Popover';
import type { SxProps, Theme } from '@mui/material/styles';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorEl: HTMLElement | null;
  children: React.ReactNode;
  width?: number | string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  sx?: SxProps<Theme>;
}

const placementMap: Record<string, { anchorOrigin: { vertical: 'top' | 'bottom' | 'center'; horizontal: 'left' | 'right' | 'center' }; transformOrigin: { vertical: 'top' | 'bottom' | 'center'; horizontal: 'left' | 'right' | 'center' } }> = {
  top: { anchorOrigin: { vertical: 'top', horizontal: 'center' }, transformOrigin: { vertical: 'bottom', horizontal: 'center' } },
  bottom: { anchorOrigin: { vertical: 'bottom', horizontal: 'center' }, transformOrigin: { vertical: 'top', horizontal: 'center' } },
  left: { anchorOrigin: { vertical: 'center', horizontal: 'left' }, transformOrigin: { vertical: 'center', horizontal: 'right' } },
  right: { anchorOrigin: { vertical: 'center', horizontal: 'right' }, transformOrigin: { vertical: 'center', horizontal: 'left' } },
};

export default function Popover({
  open,
  onClose,
  anchorEl,
  children,
  width,
  placement = 'bottom',
  sx,
}: PopoverProps) {
  const origins = placementMap[placement];

  return (
    <MuiPopover
      open={open}
      onClose={onClose}
      anchorEl={anchorEl}
      anchorOrigin={origins.anchorOrigin}
      transformOrigin={origins.transformOrigin}
      slotProps={{
        paper: {
          sx: {
            width,
            mt: placement === 'bottom' ? 0.5 : undefined,
            mb: placement === 'top' ? 0.5 : undefined,
            bgcolor: 'var(--ov-bg-surface)',
            border: '1px solid var(--ov-border-default)',
            ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
          } as SxProps<Theme>,
        },
      }}
    >
      {children}
    </MuiPopover>
  );
}

Popover.displayName = 'Popover';
