import React from 'react';
import Box from '@mui/joy/Box';
import { ErrorBoundary } from 'react-error-boundary';

import { PluginContextProvider } from '@omniviewdev/runtime';
import { Outlet, useLoaderData } from 'react-router-dom';
import { clearPlugin, loadAndRegisterPlugin } from '../api/loader';
import { EventsOn } from '@omniviewdev/runtime/runtime';
import { type config } from '@omniviewdev/runtime/models';
import PluginDevOverlay from '@/features/devtools/components/PluginDevOverlay';
import { PanelErrorFallback, onBoundaryError } from '@/components/errors/ErrorFallback';

export type PluginRendererProps = {}

/**
 * PluginRenderer loads a plugin with a UI entrypoint, injecting the necessary
 * contexts and rendering the component.
 *
 * Two change flows exist in dev mode:
 *
 * 1. UI changes (.tsx/.ts/.css files):
 *    Handled entirely by Vite HMR + React Fast Refresh.
 *    No event, no re-mount, no action needed here.
 *    Components update in-place with state preserved.
 *
 * 2. Go changes (.go files):
 *    Backend rebuilds binary, restarts plugin process, re-establishes gRPC.
 *    Emits `plugin/dev_reload_complete` event.
 *    This component increments `reloadKey`, causing PluginContextProvider
 *    to unmount and re-mount with the new gRPC backend.
 *    Only the plugin tree re-mounts — rest of app is untouched.
 */
const PluginRenderer: React.FC<PluginRendererProps> = () => {
  const data = useLoaderData() as { pluginID: string } | undefined;
  const [reloadKey, setReloadKey] = React.useState(0);

  console.debug(`[PluginRenderer] render`, { pluginID: data?.pluginID, reloadKey });

  React.useEffect(() => {
    if (!data?.pluginID) return;

    console.debug(`[PluginRenderer] subscribing to dev_reload_complete`, { plugin: data.pluginID });

    const closer = EventsOn('plugin/dev_reload_complete', (meta: config.PluginMeta) => {
      if (meta.id === data.pluginID) {
        console.debug(`[PluginRenderer] Go reload event for "${data.pluginID}" — clearing and re-importing`, { plugin: data.pluginID });
        // Go backend changed: clear old module, re-import, then re-mount
        // via key increment (NOT a full page refresh)
        clearPlugin({ pluginId: data.pluginID })
          .then(() => loadAndRegisterPlugin(data.pluginID))
          .then(() => {
            setReloadKey(k => k + 1);
            console.debug(`[PluginRenderer] Go reload complete for "${data.pluginID}" — re-mounting`, { plugin: data.pluginID });
          })
          .catch((error) => {
            console.error(error instanceof Error ? error : new Error(String(error)), { plugin: data.pluginID, event: 'go_reload' });
          });
      }
    });

    return () => {
      closer();
    };
  }, [data?.pluginID]);

  if (!data?.pluginID) {
    console.warn('[PluginRenderer] no pluginID in loader data');
    return <>No Plugin ID found</>;
  }

  return (
    <Box sx={{ position: 'relative', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <PluginDevOverlay pluginId={data.pluginID} />
      <ErrorBoundary
        FallbackComponent={(props) => <PanelErrorFallback {...props} label={`Plugin: ${data.pluginID}`} boundary="Plugin Renderer" />}
        onError={onBoundaryError}
        resetKeys={[reloadKey]}
      >
        <PluginContextProvider pluginId={data.pluginID} key={reloadKey}>
          <Outlet />
        </PluginContextProvider>
      </ErrorBoundary>
    </Box>
  );
};

export default PluginRenderer;
