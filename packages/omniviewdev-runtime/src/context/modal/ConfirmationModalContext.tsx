import React from 'react';

export type ConfirmationModalProps = {
  title?: string | React.ReactNode;
  body?: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => Promise<void> | void;
};

export type ConfirmationModalContextType = {
  show: (props: ConfirmationModalProps) => void;
};

export const ConfirmationModalContext = React.createContext<ConfirmationModalContextType | undefined>(undefined);
