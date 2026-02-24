import { PluginWindow } from '@omniviewdev/runtime';
import React from 'react';

export type PluginLoadError = {
  pluginId: string;
  error: string;
  timestamp: number;
};

export type PluginRegistryContextType = {
  plugins: Record<string, PluginWindow>
  reloadPlugin: (plugin: string) => void;
};

const defaultState: PluginRegistryContextType = {
  plugins: {},
  reloadPlugin() { },
};

export const PluginRegistryContext = React.createContext<PluginRegistryContextType>(defaultState);
export default PluginRegistryContext;
