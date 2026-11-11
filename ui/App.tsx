import React from 'react';

// ensure we preload deps first before anything
import { preloadSharedDeps } from './features/plugins/api/preloader';
preloadSharedDeps();

// Bridge Go-side Wails events (plugin/devserver/*) to the frontend devToolsChannel
// event bus so DevModeSection and other consumers receive real-time status updates.
import { initDevToolsBridge } from './features/devtools/wailsBridge';
initDevToolsBridge();

// Bridge plugin process log events (plugin/process/log) to the frontend pluginLogChannel.
import { initPluginLogBridge } from './features/pluginlogs/wailsBridge';
initPluginLogBridge();

import { Provider } from 'react-redux';
import { store } from './store/store';

import './utils/globalutils';

import AppThemeController from './theme/AppThemeController';

// Providers
import { ToastProvider } from '@omniviewdev/base-ui';
import RightDrawerProvider from '@/providers/RightDrawerProvider';
import { ErrorBoundary } from 'react-error-boundary';
import { RootErrorFallback, FullPageErrorFallback, onBoundaryError } from '@/components/errors/ErrorFallback';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ExtensionProvider } from '@omniviewdev/runtime';
import BottomDrawerProvider from './providers/BottomDrawer/provider';
import { SettingsProvider } from '@omniviewdev/runtime';
import { EXTENSION_REGISTRY } from './features/extensions/store';
import { ConfirmationModalProvider } from './contexts/ConfirmationModalContext';
import { McpConfirmationProvider } from './providers/McpConfirmationProvider';
import { ConnectionStateProvider } from './features/connectionState';
import { ActivityProvider } from '@omniviewdev/runtime';
import { PluginServiceProvider } from '@/features/plugins';
import { currentWindow, WindowTabDragProvider } from './features/windows';
import WorkspaceShell from './layouts/core/main/WorkspaceShell';
import { PanelWindowShell } from './layouts/core/panel/PanelWindowShell';
import log from '@/features/logger';
import { recordErrorBoundary } from '@/features/telemetry/boundaryTelemetry';
import { recordQueryFailure } from '@/features/telemetry/queryFailure';
import { orFallback } from '@/utils/orFallback';
import { InstanceProvider } from '@/features/instance/InstanceContext';

import { SettingsWindowShell } from './features/windows/SettingsWindowShell';
import { ExtensionDiagnosticsBridge } from './features/extensions/diagnostics/ExtensionDiagnosticsBridge';
import { ActivityActionSurfaces, WorkspaceActivitySurfaces } from './features/activities/ActivityActionSurfaces';

function WindowApplication() {
  return (
    <PluginServiceProvider>
      <ExtensionDiagnosticsBridge />
      {currentWindow.kind === 'settings' ? <><ActivityActionSurfaces /><SettingsWindowShell /></> : (
        <ConnectionStateProvider>
          <BottomDrawerProvider>
            <RightDrawerProvider>
              <WorkspaceActivitySurfaces />
              <McpConfirmationProvider>
                <WindowTabDragProvider>
                  {currentWindow.kind === 'panel' ? <PanelWindowShell /> : <WorkspaceShell />}
                </WindowTabDragProvider>
              </McpConfirmationProvider>
            </RightDrawerProvider>
          </BottomDrawerProvider>
        </ConnectionStateProvider>
      )}
    </PluginServiceProvider>
  );
}

// 2. Global handlers for uncaught errors + promise rejections
window.addEventListener('error', event => {
  recordErrorBoundary('global_error');
  // event.error may be undefined (e.g. script load failures)
  const err = orFallback(event.error, new Error(String(event.message)));
  log.error(err, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});

window.addEventListener('unhandledrejection', event => {
  recordErrorBoundary('unhandled_rejection');
  const reason = event.reason instanceof Error
    ? event.reason
    : new Error(JSON.stringify(event.reason));
  log.error(reason, { unhandledRejection: true });
});

// Create a client
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      recordQueryFailure('query', error, query.queryKey, query.state.fetchFailureCount);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      recordQueryFailure('mutation', error, mutation.options.mutationKey, mutation.state.failureCount);
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

log.debug('starting up the application');

/**
 * Render out the core layout for the application
 */
const App: React.FC = () => {
  return (
    <ErrorBoundary
      FallbackComponent={RootErrorFallback}
      onError={(error, info) => {
        onBoundaryError(error, info, undefined, 'root');
      }}
    >
      <InstanceProvider>
        <QueryClientProvider client={queryClient}>
          <SettingsProvider>
            <ExtensionProvider registry={EXTENSION_REGISTRY}>
              <ActivityProvider>
                <Provider store={store}>
                  <AppThemeController>
                    <ToastProvider maxVisible={5} position="bottom-right" style={{ bottom: 24, padding: 12 }}>
                      <ErrorBoundary
                        FallbackComponent={(props) => <FullPageErrorFallback {...props} boundary="Application" />}
                        onError={(error, info) => {
                          onBoundaryError(error, info, undefined, 'app');
                        }}
                      >
                        <ConfirmationModalProvider>
                          <WindowApplication />
                        </ConfirmationModalProvider>
                      </ErrorBoundary>
                    </ToastProvider>
                  </AppThemeController>
                </Provider>
              </ActivityProvider>
            </ExtensionProvider>
          </SettingsProvider>
        </QueryClientProvider>
      </InstanceProvider>
    </ErrorBoundary>
  );
};

export default App;
