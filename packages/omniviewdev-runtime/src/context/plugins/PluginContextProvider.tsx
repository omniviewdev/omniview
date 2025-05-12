import React from 'react';

import { PluginContext } from './PluginContext';
import { PluginValues } from '../../wailsjs/go/settings/Client';
import { config } from '../../wailsjs/go/models';
import { GetPluginMeta } from '../../wailsjs/go/plugin/pluginManager';

export type PluginContextProviderProps = {
  pluginId: string;
};

export function PluginContextProvider(props: React.PropsWithChildren<PluginContextProviderProps>): React.ReactElement {
  const { children, pluginId } = props;
  const [settings, setSettings] = React.useState<Record<string, any>>({});
  const [meta, setMeta] = React.useState<config.PluginMeta>(new config.PluginMeta);
  const [metaLoaded, setMetaLoaded] = React.useState(false);

  /**
   * Fetch the settings from the backend stores
   */
  const fetchSettings = () => {
    if (pluginId === undefined || pluginId === '') {
      return
    }

    PluginValues(pluginId)
      .then((values) => {
        console.log('Fetched plugin settings:', values);
        setSettings(values)
      })
      .catch((error) => {
        console.error('Error fetching plugin settings:', error);
      })
  }

  /**
   * Fetch the metadata for the plugin from the backend stores
   */
  const fetchMeta = () => {
    if (pluginId === undefined || pluginId === '') {
      return
    }

    GetPluginMeta(pluginId)
      .then((values) => {
        console.log('Fetched plugin metadata:', values);
        setMeta(values)
        setMetaLoaded(true)
      })
      .catch((error) => {
        console.error('Error fetching plugin settings:', error);
        setMetaLoaded(false)
      })
  }

  React.useEffect(() => {
    fetchSettings();
    fetchMeta();
  }, [pluginId])

  if (!metaLoaded) return <div>
  </div>;

  return <PluginContext.Provider value={{ settings, meta }}>{children}</PluginContext.Provider>;
}
