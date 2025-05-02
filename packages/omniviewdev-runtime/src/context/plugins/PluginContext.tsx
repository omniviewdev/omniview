import React from 'react';
import { type config } from '../../wailsjs/go/models';

export interface PluginContextType {
  meta: config.PluginMeta
  settings: Record<string, any>;
}

export const PluginContext = React.createContext<PluginContextType | undefined>(undefined);
