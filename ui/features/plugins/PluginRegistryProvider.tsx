import React, { createContext, useLayoutEffect, useState } from 'react';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { importPluginWindow } from './api/loader';
import { registerPlugin } from './PluginManager';
import PrimaryLoading from '@/components/util/PrimaryLoading';

interface PluginRegistryContextValue {
  ready: boolean;
}

export const PluginRegistryContext = createContext<PluginRegistryContextValue>({
  ready: false,
});

export const PluginRegistryProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { plugins } = usePluginManager();
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (!plugins.data || plugins.isLoading || plugins.isError) {
      // don't do anything here
      return;
    }

    const loadAll = async () => {
      await Promise.all(
        plugins.data.map(async (plugin) => {
          try {
            const pluginWindow = await importPluginWindow({ pluginId: plugin.id });
            registerPlugin(plugin.id, pluginWindow);
          } catch (err) {
            console.error(`Failed to load plugin ${plugin.id}`, err);
          }
        })
      );

      setReady(true);
    };

    loadAll();
  }, [plugins.data]);

  if (!ready) return <PrimaryLoading />

  return (
    <PluginRegistryContext.Provider value={{ ready }}>
      {children}
    </PluginRegistryContext.Provider>
  );
};
