import React from 'react';
import { PluginRegistryContext } from './PluginRegistryProvider';

/**
 * Hook to access the plugin registry context (ready state, failed plugins, retry).
 */
export const usePluginRegistry = () => {
  const context = React.useContext(PluginRegistryContext);

  if (context === undefined) {
    throw new Error('usePluginRegistry must be used within a PluginRegistry.Provider');
  }

  return context;
};
