import MuiDialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import MuiIconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import Button from '../buttons/Button';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen';
  variant?: 'default' | 'confirm' | 'danger';
  actions?: React.ReactNode;
  disableBackdropClose?: boolean;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}

const sizeToMaxWidth: Record<string, 'xs' | 'sm' | 'md' | 'lg' | 'xl'> = {
  sm: 'xs',
  md: 'sm',
  lg: 'md',
  xl: 'lg',
};

export default function Dialog({
  open,
  onClose,
  title,
  icon,
  size = 'md',
  variant = 'default',
  actions,
  disableBackdropClose = false,
  children,
  sx,
}: DialogProps) {
  const isFullscreen = size === 'fullscreen';

  const handleClose = (_: unknown, reason: string) => {
    if (reason === 'backdropClick' && disableBackdropClose) return;
    onClose();
  };

  const renderActions = () => {
    if (actions) return actions;
    if (variant === 'confirm') {
      return (
        <>
          <Button emphasis="ghost" color="neutral" size="sm" onClick={onClose}>Cancel</Button>
          <Button emphasis="solid" color="primary" size="sm" onClick={onClose}>Confirm</Button>
        </>
      );
    }
    if (variant === 'danger') {
      return (
        <>
          <Button emphasis="ghost" color="neutral" size="sm" onClick={onClose}>Cancel</Button>
          <Button emphasis="solid" color="danger" size="sm" onClick={onClose}>Delete</Button>
        </>
      );
    }
    return null;
  };

  const footerActions = renderActions();

  return (
    <MuiDialog
      open={open}
      onClose={handleClose}
      fullScreen={isFullscreen}
      maxWidth={isFullscreen ? false : sizeToMaxWidth[size]}
      fullWidth
      sx={sx}
    >
      {title && (
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}>
          {icon && (
            <Box sx={{ display: 'flex', color: 'var(--ov-fg-muted)' }}>{icon}</Box>
          )}
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <MuiIconButton
            size="small"
            onClick={onClose}
            sx={{ position: 'absolute', right: 8, top: 8, color: 'var(--ov-fg-faint)' }}
            aria-label="Close"
          >
            <CloseIcon fontSize="small" />
          </MuiIconButton>
        </DialogTitle>
      )}

      <DialogContent>{children}</DialogContent>

      {footerActions && (
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {footerActions}
        </DialogActions>
      )}
    </MuiDialog>
  );
}

Dialog.displayName = 'Dialog';
