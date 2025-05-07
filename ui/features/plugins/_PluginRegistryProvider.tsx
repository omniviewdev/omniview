import React from "react";
import PluginRegistryContext from "./PluginRegistryContext";
import { usePluginManager } from "@/hooks/plugin/usePluginManager";
import { PluginWindow } from "@omniviewdev/runtime";
import { clearPlugin, importPluginWindow } from "./api/loader";

export const PluginRegistryProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [pluginStore, setPluginStore] = React.useState<Record<string, PluginWindow>>({})
  const { plugins } = usePluginManager()

  // Get out all of the plugins and import all of the plugin window objects when they
  // change
  React.useLayoutEffect(() => {
    if (!plugins.data?.length) {
      // no plugins, don't do anything
      return
    }

    const promises = plugins.data?.map((plugin) => importPluginWindow({ pluginId: plugin.id }))
    if (promises) {
      Promise.all(promises).then((windows) => {
        const store: Record<string, PluginWindow> = {}
        for (let i = 0; i < windows.length; i++) {
          store[plugins.data[i].id] = windows[i]
        }
        setPluginStore(store)
      })
    }

  }, [plugins])

  // force a reload of the plugin in question
  const reloadPlugin = (plugin: string) => {
    if (!plugins.data?.length || plugins.data?.findIndex((p) => p.id === plugin) === -1) {
      // nothing to reload
      console.error(`no plugin with id ${plugin} to reload`)
      return
    }

    clearPlugin({ pluginId: plugin })
      .then(() => importPluginWindow({ pluginId: plugin }))
      .then((pluginWindow) => setPluginStore((prev) => ({ ...prev, [plugin]: pluginWindow })))
  }

  const contextValue = React.useMemo(() => ({
    plugins: pluginStore,
    reloadPlugin,
  }), [pluginStore, reloadPlugin]);

  return (
    <PluginRegistryContext.Provider value={contextValue}>
      {children}
    </PluginRegistryContext.Provider>
  );
};
