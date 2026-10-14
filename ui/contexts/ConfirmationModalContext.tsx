import React, { useState, type ReactNode } from 'react';
import { Button, Dialog, Spinner } from '@omniviewdev/base-ui';
import { ConfirmationModalContext, type ConfirmationModalProps } from '@omniviewdev/runtime';
import { orFallback } from '@/utils/orFallback';


export const ConfirmationModalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [config, setConfig] = useState<ConfirmationModalProps | null>(null);

  const show = (props: ConfirmationModalProps) => {
    setConfig(props);
    setOpen(true);
  };

  const handleConfirm = async () => {
    if (!config?.onConfirm) {
      return;
    }

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
      <Dialog open={open} onClose={() => {
        setOpen(false);
      }} size="sm">
        <Dialog.Title>{orFallback(config?.title, 'Confirm')}</Dialog.Title>
        <Dialog.Body>{orFallback(config?.body, 'Are you sure?')}</Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" color="neutral" onClick={() => {
            setOpen(false);
          }}>
            {orFallback(config?.cancelLabel, 'Cancel')}
          </Button>
          <Button variant="solid" color="danger" onClick={handleConfirm} disabled={pending}>
            {pending ? <Spinner size="sm" /> : orFallback(config?.confirmLabel, 'Confirm')}
          </Button>
        </Dialog.Footer>
      </Dialog>
    </ConfirmationModalContext.Provider>
  );
};
