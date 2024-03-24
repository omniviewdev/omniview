import React from 'react';
import { type types } from '@api/models';

/**
 * PluginContext provides data about the current plugin that is within scope.
 */
export const PluginContext = React.createContext<types.Plugin | undefined>(undefined);

/**
 * UsePluginContext provides the current plugin that is within scope.
 */
export const usePluginContext = () => {
  const plugin = React.useContext(PluginContext);

  if (plugin === undefined) {
    throw new Error('usePluginContext must be used within a PluginContext.Provider');
  }

  return plugin;
};
