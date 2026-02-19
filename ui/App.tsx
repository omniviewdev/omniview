import React from 'react';

// ensure we preload deps first before anything
import { preloadSharedDeps } from './features/plugins/api/preloader';
preloadSharedDeps();

// In dev mode, eagerly export shared deps to window.__OMNIVIEW_SHARED__
// so that dev-mode plugins (loaded via native ESM from Vite) get the host's
// singleton instances of React, MUI, etc.
import { initDevSharedDeps } from './features/plugins/api/devSharedReady';
initDevSharedDeps(import.meta.env.DEV);

// Bridge Go-side Wails events (plugin/devserver/*) to the frontend devToolsChannel
// event bus so DevModeSection and other consumers receive real-time status updates.
import { initDevToolsBridge } from './features/devtools/wailsBridge';
initDevToolsBridge();

import { Provider } from 'react-redux';
import { store } from './store/store';

import './utils/globalutils';
import './providers/monaco/bootstrap';

import {
  experimental_extendTheme as materialExtendTheme,
  Experimental_CssVarsProvider as MaterialCssVarsProvider,
  THEME_ID as MATERIAL_THEME_ID,
} from '@mui/material/styles';

// Providers
import { CssVarsProvider, StyledEngineProvider } from '@mui/joy/styles';
import theme from './theme';
import { AppSnackbarProvider } from '@/contexts/AppSnackbarProvider';
import RightDrawerProvider from '@/providers/RightDrawerProvider';
import { ErrorBoundary } from 'react-error-boundary';
import { RootErrorFallback, FullPageErrorFallback, onBoundaryError } from '@/components/errors/ErrorFallback';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ExtensionProvider } from '@omniviewdev/runtime';
import BottomDrawerProvider from './providers/BottomDrawer/provider';
import { SettingsProvider } from '@omniviewdev/runtime';
import { EXTENSION_REGISTRY } from './features/extensions/store'
import { ConfirmationModalProvider } from './contexts/ConfirmationModalContext';
import { PluginRegistryProvider } from './features/plugins/PluginRegistryProvider';
import { RouteProvider } from './features/router/RouteProvider';
import log from '@/features/logger'

// 2. Global handlers for uncaught errors + promise rejections
window.addEventListener("error", event => {
  // event.error may be undefined (e.g. script load failures)
  const err = event.error || new Error(String(event.message));
  log.error(err, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});

window.addEventListener("unhandledrejection", event => {
  const reason = event.reason instanceof Error
    ? event.reason
    : new Error(JSON.stringify(event.reason));
  log.error(reason, { unhandledRejection: true });
});

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

const materialTheme = materialExtendTheme();

log.debug("starting up the application")

/**
 * Render out the core layout for the application
 */
const App: React.FC = () => (
  <ErrorBoundary FallbackComponent={RootErrorFallback}>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <ExtensionProvider registry={EXTENSION_REGISTRY}>
          <AppSnackbarProvider>
            <MaterialCssVarsProvider
              defaultMode="dark"
              theme={{ [MATERIAL_THEME_ID]: materialTheme }}
            >
              <StyledEngineProvider injectFirst>
                <Provider store={store}>
                  <CssVarsProvider
                    defaultMode='dark'
                    modeStorageKey='omniview_identify-system-mode'
                    // Set as root provider
                    disableNestedContext
                    theme={theme}
                  >
                    <ErrorBoundary
                      FallbackComponent={(props) => <FullPageErrorFallback {...props} boundary="Application" />}
                      onError={onBoundaryError}
                    >
                      <ConfirmationModalProvider>
                        <RightDrawerProvider>
                          <BottomDrawerProvider>
                            <PluginRegistryProvider>
                              <RouteProvider />
                            </PluginRegistryProvider>
                          </BottomDrawerProvider>
                        </RightDrawerProvider>
                      </ConfirmationModalProvider>
                    </ErrorBoundary>
                  </CssVarsProvider>
                </Provider>
              </StyledEngineProvider>
            </MaterialCssVarsProvider>
          </AppSnackbarProvider>
        </ExtensionProvider>
      </SettingsProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
