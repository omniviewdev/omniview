/**
 * The provider stack a screen renders inside, mirroring ui/App.tsx minus the
 * router and plugin loader. Each mount gets a fresh QueryClient so data is
 * fetched through the (fake) backend every time, as on a cold screen.
 *
 * When the app shell changes (e.g. the base-ui shell migration), update this to
 * match App.tsx so benches keep measuring the real environment.
 */
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ExtensionProvider,
  OperationsProvider,
  PluginContextProvider,
  SettingsProvider,
} from '@omniviewdev/runtime';

import { store } from '@/store/store';
import AppThemeController from '@/theme/AppThemeController';
import { AppSnackbarProvider } from '@/contexts/AppSnackbarProvider';
import RightDrawerProvider from '@/providers/RightDrawerProvider';
import BottomDrawerProvider from '@/providers/BottomDrawer/provider';
import { EXTENSION_REGISTRY } from '@/features/extensions/store';
import { ConfirmationModalProvider } from '@/contexts/ConfirmationModalContext';
import { ConnectionStateProvider } from '@/features/connectionState';

export function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } } });
}

export interface AppProvidersProps {
  children: React.ReactNode;
  queryClient?: QueryClient;
}

export function AppProviders({ children, queryClient }: AppProvidersProps) {
  const [client] = React.useState(() => queryClient ?? newQueryClient());
  return (
    <QueryClientProvider client={client}>
      <SettingsProvider>
        <ExtensionProvider registry={EXTENSION_REGISTRY}>
          <AppSnackbarProvider>
            <Provider store={store}>
              <AppThemeController>
                <OperationsProvider>
                  <ConfirmationModalProvider>
                    <ConnectionStateProvider>
                      <RightDrawerProvider>
                        <BottomDrawerProvider>{children}</BottomDrawerProvider>
                      </RightDrawerProvider>
                    </ConnectionStateProvider>
                  </ConfirmationModalProvider>
                </OperationsProvider>
              </AppThemeController>
            </Provider>
          </AppSnackbarProvider>
        </ExtensionProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}

export interface PluginScreenProps {
  pluginId: string;
  /** Route pattern the screen expects, e.g. "/connection/:id/pods". */
  path: string;
  /** Concrete URL to render, e.g. "/connection/bench/pods". */
  url: string;
  children: React.ReactNode;
}

/** A plugin page as PluginRenderer mounts it: plugin context + router params. */
export function PluginScreen({ pluginId, path, url, children }: PluginScreenProps) {
  return (
    <AppProviders>
      <MemoryRouter initialEntries={[url]}>
        <PluginContextProvider pluginId={pluginId}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100vh' }}>
            <Routes>
              <Route path={path} element={children} />
            </Routes>
          </div>
        </PluginContextProvider>
      </MemoryRouter>
    </AppProviders>
  );
}
