import React, { createContext, useLayoutEffect, useState } from 'react';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { importPluginWindow } from './api/loader';
import { registerPlugin } from './PluginManager';
import PrimaryLoading from '@/components/util/PrimaryLoading';
import { useDevServer, type DevServerState } from '@/hooks/plugin/useDevServer';

interface PluginRegistryContextValue {
  ready: boolean;
}

export const PluginRegistryContext = createContext<PluginRegistryContextValue>({
  ready: false,
});

export const PluginRegistryProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { plugins } = usePluginManager();
  const { allStates } = useDevServer();
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (!plugins.data || plugins.isLoading || plugins.isError) {
      return;
    }

    const loadAll = async () => {
      const devStates: DevServerState[] = allStates.data ?? [];

      await Promise.all(
        plugins.data.map(async (plugin) => {
          try {
            // Find dev server state for this plugin
            const devState = devStates.find((s) => s.pluginID === plugin.id);
            const isDevReady =
              devState &&
              devState.viteStatus === 'ready' &&
              devState.vitePort > 0;

            const pluginWindow = await importPluginWindow({
              pluginId: plugin.id,
              dev: !!isDevReady,
              devPort: devState?.vitePort,
            });
            registerPlugin(plugin.id, pluginWindow);
          } catch (err) {
            console.error(`Failed to load plugin ${plugin.id}`, err);
          }
        })
      );

      setReady(true);
    };

    loadAll();
  }, [plugins.data, allStates.data]);

  if (!ready) return <PrimaryLoading />;

  return (
    <PluginRegistryContext.Provider value={{ ready }}>
      {children}
    </PluginRegistryContext.Provider>
  );
};
