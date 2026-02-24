import React, { useState, ReactNode } from 'react';
import Divider from '@mui/material/Divider';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CircularProgress from '@mui/material/CircularProgress';
import { Button } from '@omniviewdev/ui/buttons';
import { ConfirmationModalContext, ConfirmationModalProps } from '@omniviewdev/runtime';


export const ConfirmationModalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [config, setConfig] = useState<ConfirmationModalProps | null>(null);

  const show = (props: ConfirmationModalProps) => {
    setConfig(props);
    setOpen(true);
  };

  const handleConfirm = async () => {
    if (!config?.onConfirm) return;
    try {
      setPending(true);
      await config.onConfirm();
      setOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <ConfirmationModalContext.Provider value={{ show }}>
      {children}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            boxShadow: 'none',
          },
        }}
      >
        <DialogTitle>{config?.title || 'Confirm'}</DialogTitle>
        <Divider />
        <DialogContent>{config?.body || 'Are you sure?'}</DialogContent>
        <DialogActions>
          <Button emphasis="ghost" onClick={() => setOpen(false)}>
            {config?.cancelLabel || 'Cancel'}
          </Button>
          <Button emphasis="solid" color="danger" onClick={handleConfirm} disabled={pending}>
            {pending ? <CircularProgress size={16} /> : config?.confirmLabel || 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmationModalContext.Provider>
  );
};
