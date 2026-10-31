import { useContext } from 'react';

import { PluginContext, PluginContextType } from './PluginContext';

export function usePluginContext(): PluginContextType {
  const context = useContext(PluginContext);
  if (!context) {
    throw new Error('usePluginContext must be used within a PluginContextProvider');
  }
  return context;
}

