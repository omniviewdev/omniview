import React from 'react';
import { Provider } from 'react-redux';
import { store } from './store/store';

import './utils/globalutils';
import './providers/monaco/bootstrap';

// Providers
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { CssVarsProvider, StyledEngineProvider } from '@mui/joy/styles';
import { WindowProvider } from '@/providers/WindowProvider';
import { Renderer } from '@/providers/PaneProvider';
import { AppSnackbarProvider } from '@/contexts/AppSnackbarProvider';
import RightDrawerProvider from '@/providers/RightDrawer';
import { ErrorBoundary } from 'react-error-boundary';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { createExtensionRegistry, ExtensionProvider } from '@omniviewdev/runtime/extensionpoint';

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

/**
 * Create the primary extension registry for other applications to expand upon.
 */
const registry = createExtensionRegistry();

/**
 * Render out the core layout for the application
 */
const App: React.FC = () => (
  <ErrorBoundary FallbackComponent={fallbackRender}>
    <ExtensionProvider registry={registry}>
      <AppSnackbarProvider>
        <QueryClientProvider client={queryClient}>
          <StyledEngineProvider injectFirst>
            <Provider store={store}>
              <CssVarsProvider
                defaultMode='dark'
                modeStorageKey='omniview_identify-system-mode'
                // Set as root provider
                disableNestedContext
              >
                <WindowProvider>
                  <RightDrawerProvider>
                    <Renderer />
                  </RightDrawerProvider>
                </WindowProvider>
              </CssVarsProvider>
            </Provider>
          </StyledEngineProvider>
          <ReactQueryDevtools initialIsOpen={false} buttonPosition='bottom-right' />
        </QueryClientProvider>
      </AppSnackbarProvider>
    </ExtensionProvider>
  </ErrorBoundary>
);

export default App;
