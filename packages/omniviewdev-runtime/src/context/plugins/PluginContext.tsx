import React from 'react';

export interface PluginContextType {
  settings: Record<string, any>;
}

export const PluginContext = React.createContext<PluginContextType | undefined>(undefined);
