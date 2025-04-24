import React from 'react';

import { PluginContext } from './PluginContext';
import { PluginValues } from '../../wailsjs/go/settings/Client';

export type PluginContextProviderProps = {
  pluginId: string;
};

export function PluginContextProvider(props: React.PropsWithChildren<PluginContextProviderProps>): React.ReactElement {
  const { children, pluginId } = props;
  const [settings, setSettings] = React.useState<Record<string, any>>({});

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

  React.useEffect(() => {
    fetchSettings();
  }, [pluginId])


  return <PluginContext.Provider value={{ settings }}>{children}</PluginContext.Provider>;
}
