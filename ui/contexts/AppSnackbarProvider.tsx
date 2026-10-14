import React, { type ReactNode } from 'react';
import { ToastProvider } from '@omniviewdev/base-ui';
import { SnackbarProvider } from '@omniviewdev/runtime';

type AppSnackbarProviderProps = {
  children: ReactNode;
};

export const AppSnackbarProvider: React.FC<AppSnackbarProviderProps> = ({ children }) => (
  <ToastProvider maxVisible={5} position="bottom-right">
    <SnackbarProvider>{children}</SnackbarProvider>
  </ToastProvider>
);
