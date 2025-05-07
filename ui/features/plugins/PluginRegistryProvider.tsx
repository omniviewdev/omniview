import React, { createContext, useEffect, useState } from 'react';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { importPluginWindow } from './api/loader';
import { registerPlugin } from './PluginManager';

interface PluginRegistryContextValue {
  ready: boolean;
  version: number;
  bumpVersion: () => void;
}

export const PluginRegistryContext = createContext<PluginRegistryContextValue>({
  ready: false,
  version: 1,
  bumpVersion: () => { }
});

export const PluginRegistryProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { plugins } = usePluginManager();
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);

  const bumpVersion = () => setVersion(v => v + 1);

  useEffect(() => {
    if (!plugins.data) return;

    const loadAll = async () => {
      await Promise.allSettled(
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
      bumpVersion();
    };

    loadAll();
  }, [plugins.data]);

  return (
    <PluginRegistryContext.Provider value={{ ready, version, bumpVersion }}>
      {children}
    </PluginRegistryContext.Provider>
  );
};
