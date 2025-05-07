import React from 'react';
import PluginRegistryContext from './PluginRegistryContext';

/**
 * UsePluginContext provides the current plugin that is within scope.
 */
export const usePluginRegistry = () => {
  const context = React.useContext(PluginRegistryContext);

  if (context === undefined) {
    throw new Error('usePluginRegistry must be used within a PluginRegistry.Provider');
  }

  return context;
};
