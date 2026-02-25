import React from 'react';
import { type config } from '../../wailsjs/go/models';

export interface PluginContextType {
  /** The runtime instance ID for this plugin (e.g. "kubernetes-dev" or "kubernetes"). */
  pluginId: string;
  meta: config.PluginMeta
  settings: Record<string, any>;
}

export const PluginContext = React.createContext<PluginContextType | undefined>(undefined);
