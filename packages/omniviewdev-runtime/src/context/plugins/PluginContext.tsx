import React from 'react';
import type { PluginMeta } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/config/models';

export interface PluginContextType {
  /** The runtime instance ID for this plugin (e.g. "kubernetes-dev" or "kubernetes"). */
  pluginId: string;
  meta: PluginMeta
  settings: Record<string, any>;
}

export const PluginContext = React.createContext<PluginContextType | undefined>(undefined);
