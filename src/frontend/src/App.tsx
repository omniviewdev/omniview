import React from 'react';
import { Provider } from 'react-redux'
import { store } from './store/store'

// providers
import { CssVarsProvider, StyledEngineProvider } from '@mui/joy/styles';
import { WindowProvider } from '@/providers/WindowProvider';
import { Renderer } from '@/providers/PaneProvider';
import { AppSnackbarProvider } from '@/contexts/AppSnackbarProvider';
import RightDrawerProvider from '@/providers/RightDrawerProvider';
import { ErrorBoundary } from "react-error-boundary";

function fallbackRender({ error }: { error: Error }) {
  return (
    <div role="alert">
      <p>Something went wrong:</p>
      <pre style={{ color: "red" }}>{error.message}</pre>
    </div>
  );
}

/**
 * Render out the core layout for the application
 */
const App: React.FC = () => {

  return (
    <ErrorBoundary FallbackComponent={fallbackRender}>
      <StyledEngineProvider injectFirst>
        <Provider store={store}>
          <CssVarsProvider
            defaultMode="dark"
            modeStorageKey="omniview_identify-system-mode"
            // set as root provider
            disableNestedContext
          >
            <WindowProvider>
              <AppSnackbarProvider>
                <RightDrawerProvider>
                  <Renderer />
                </RightDrawerProvider>
              </AppSnackbarProvider>
            </WindowProvider>
          </CssVarsProvider>
        </Provider>
      </StyledEngineProvider>
    </ErrorBoundary>
  );
}

export default App;
