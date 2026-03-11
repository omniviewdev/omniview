import React from 'react';
import Box from '@mui/material/Box';
import { ErrorBoundary } from 'react-error-boundary';

import { PluginContextProvider } from '@omniviewdev/runtime';
import { Outlet, useLoaderData } from 'react-router-dom';
import PluginDevOverlay from '@/features/devtools/components/PluginDevOverlay';
import { PanelErrorFallback, onBoundaryError } from '@/components/errors/ErrorFallback';
import { usePluginService } from '@/features/plugins';

export type PluginRendererProps = {}

/**
 * PluginRenderer loads a plugin with a UI entrypoint, injecting the necessary
 * contexts and rendering the component.
 *
 * Reload is driven by the PluginService — when a plugin reloads (Go backend
 * change, manual reload, etc.), its `loadedAt` timestamp changes, which causes
 * a React key change here, unmounting and re-mounting the plugin subtree.
 *
 * UI-only changes (HMR via Vite) are handled transparently by React Fast
 * Refresh with no re-mount needed.
 */
const PluginRenderer: React.FC<PluginRendererProps> = () => {
  const data = useLoaderData() as { pluginID: string } | undefined;
  const { plugins } = usePluginService();

  const pluginState = data?.pluginID ? plugins.get(data.pluginID) : undefined;
  const loadedAt = pluginState?.phase === 'ready' ? pluginState.loadedAt : undefined;

  if (!data?.pluginID) {
    console.warn('[PluginRenderer] no pluginID in loader data');
    return <>No Plugin ID found</>;
  }

  if (loadedAt == null) {
    return null;
  }

  return (
    <Box sx={{ position: 'relative', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <PluginDevOverlay pluginId={data.pluginID} />
      <ErrorBoundary
        FallbackComponent={(props) => <PanelErrorFallback {...props} label={`Plugin: ${data.pluginID}`} boundary="Plugin Renderer" />}
        onError={onBoundaryError}
        resetKeys={[data.pluginID, loadedAt]}
      >
        <PluginContextProvider pluginId={data.pluginID} key={`${data.pluginID}-${loadedAt}`}>
          <Outlet />
        </PluginContextProvider>
      </ErrorBoundary>
    </Box>
  );
};

export default PluginRenderer;
