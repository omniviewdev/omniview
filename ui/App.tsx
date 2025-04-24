import React from 'react';
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
import { WindowProvider } from '@/providers/WindowProvider';
import { AppSnackbarProvider } from '@/contexts/AppSnackbarProvider';
import RightDrawerProvider from '@/providers/RightDrawer';
import { ErrorBoundary } from 'react-error-boundary';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ExtensionProvider } from '@omniviewdev/runtime';
import { RouterProvider, createHashRouter } from 'react-router-dom';
import { scoped } from './routes';
import BottomDrawerProvider from './providers/BottomDrawer/provider';
import { SettingsProvider } from '@omniviewdev/runtime';
import { EXTENSION_REGISTRY } from './features/extensions/store'

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function fallbackRender({ error }: { error: Error }) {
  return (
    <div role='alert'>
      <p>Something went wrong:</p>
      <pre style={{ color: 'red' }}>{error.message}</pre>
    </div>
  );
}

const coreRouter = createHashRouter(scoped);
const materialTheme = materialExtendTheme();


/**
 * Render out the core layout for the application
 */
const App: React.FC = () => (
  <ErrorBoundary FallbackComponent={fallbackRender}>
    <SettingsProvider>
      <ExtensionProvider registry={EXTENSION_REGISTRY}>
        <AppSnackbarProvider>
          <QueryClientProvider client={queryClient}>
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
                    <WindowProvider>
                      <RightDrawerProvider>
                        <BottomDrawerProvider>
                          <RouterProvider router={coreRouter} />
                        </BottomDrawerProvider>
                      </RightDrawerProvider>
                    </WindowProvider>
                  </CssVarsProvider>
                </Provider>
              </StyledEngineProvider>
            </MaterialCssVarsProvider>
          </QueryClientProvider>
        </AppSnackbarProvider>
      </ExtensionProvider>
    </SettingsProvider>
  </ErrorBoundary>
);

export default App;
