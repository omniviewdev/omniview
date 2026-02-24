import React, { type ReactNode } from 'react';
import { NotificationStackProvider } from '@omniviewdev/ui/feedback';
import { SnackbarProvider } from '@omniviewdev/runtime';

type AppSnackbarProviderProps = {
  children: ReactNode;
};

export const AppSnackbarProvider: React.FC<AppSnackbarProviderProps> = ({ children }) => (
  <NotificationStackProvider maxVisible={5} position="bottom-right">
    <SnackbarProvider>{children}</SnackbarProvider>
  </NotificationStackProvider>
);
