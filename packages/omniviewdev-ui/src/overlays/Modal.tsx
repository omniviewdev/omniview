import MuiModal from '@mui/material/Modal';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  backdrop?: boolean;
  sx?: SxProps<Theme>;
}

const sizeWidthMap: Record<string, number> = {
  sm: 400,
  md: 600,
  lg: 800,
  xl: 1000,
};

export default function Modal({
  open,
  onClose,
  children,
  size = 'md',
  backdrop = true,
  sx,
}: ModalProps) {
  return (
    <MuiModal
      open={open}
      onClose={onClose}
      hideBackdrop={!backdrop}
    >
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: sizeWidthMap[size],
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflow: 'auto',
          bgcolor: 'var(--ov-bg-surface)',
          border: '1px solid var(--ov-border-default)',
          borderRadius: '8px',
          boxShadow: 24,
          p: 3,
          ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
        } as SxProps<Theme>}
      >
        {children}
      </Box>
    </MuiModal>
  );
}

Modal.displayName = 'Modal';
