import React, { ReactNode } from 'react';
import { SnackbarProvider as NotistackProvider } from 'notistack';
import { SnackbarProvider } from '@/providers/SnackbarProvider';

interface AppSnackbarProviderProps {
  children: ReactNode;
}

export const AppSnackbarProvider: React.FC<AppSnackbarProviderProps> = ({ children }) => (
  <NotistackProvider maxSnack={3}>
    <SnackbarProvider>{children}</SnackbarProvider>
  </NotistackProvider>
);
