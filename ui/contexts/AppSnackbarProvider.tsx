import React, { type ReactNode } from 'react';
import { SnackbarProvider as NotistackProvider } from 'notistack';
import { SnackbarProvider } from '@omniviewdev/runtime';

type AppSnackbarProviderProps = {
  children: ReactNode;
};

export const AppSnackbarProvider: React.FC<AppSnackbarProviderProps> = ({ children }) => (
  <NotistackProvider maxSnack={3}>
    <SnackbarProvider>{children}</SnackbarProvider>
  </NotistackProvider>
);
