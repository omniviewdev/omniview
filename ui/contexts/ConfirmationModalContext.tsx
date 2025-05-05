import React, { useState, ReactNode } from 'react';
import {
  Modal,
  ModalDialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Button,
  CircularProgress,
} from '@mui/joy';
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
      <Modal
        open={open}
        onClose={() => setOpen(false)}
      >
        <ModalDialog
          size='sm'
          variant="outlined"
          role="alertdialog"
          sx={{
            boxShadow: 'none'
          }}
        >
          <DialogTitle>{config?.title || 'Confirm'}</DialogTitle>
          <Divider />
          <DialogContent>{config?.body || 'Are you sure?'}</DialogContent>
          <DialogActions>
            <Button variant="solid" color="danger" onClick={handleConfirm} disabled={pending}>
              {pending ? <CircularProgress size="sm" /> : config?.confirmLabel || 'Confirm'}
            </Button>
            <Button variant="plain" onClick={() => setOpen(false)}>
              {config?.cancelLabel || 'Cancel'}
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
    </ConfirmationModalContext.Provider>
  );
};
