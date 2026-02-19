import { useState, useRef } from 'react';
import Popover from '@mui/material/Popover';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { ButtonProps } from './Button';
import Button from './Button';

export interface ConfirmButtonProps extends Omit<ButtonProps, 'onClick'> {
  onConfirm: () => void;
  confirmMessage?: string;
}

export default function ConfirmButton({
  onConfirm,
  confirmMessage = 'Are you sure?',
  children,
  ...buttonProps
}: ConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Box component="span" ref={anchorRef} sx={{ display: 'inline-flex' }}>
        <Button {...buttonProps} onClick={() => setOpen(true)}>
          {children}
        </Button>
      </Box>

      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{
          paper: {
            sx: {
              p: 2,
              mt: 0.5,
              minWidth: 200,
              bgcolor: 'var(--ov-bg-surface)',
              border: '1px solid var(--ov-border-default)',
            },
          },
        }}
      >
        <Typography
          variant="body2"
          sx={{ color: 'var(--ov-fg-default)', mb: 1.5 }}
        >
          {confirmMessage}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button
            size="xs"
            emphasis="ghost"
            color="neutral"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            size="xs"
            emphasis="solid"
            color="danger"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            Confirm
          </Button>
        </Box>
      </Popover>
    </>
  );
}

ConfirmButton.displayName = 'ConfirmButton';
