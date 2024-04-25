import React, { type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { PluginContext } from '@/contexts/PluginContext';
import { usePlugin } from '@/hooks/plugin/usePluginManager';

type Props = {
  children: ReactNode;
};

/**
 * Provides the current plugin within scope of the application. This context
 * should be wrapped when inside a plugin scope, so that components can details
 * about the plugin by using the `usePluginContext` hook.
 */
export const PluginProvider: React.FC<Props> = ({ children }) => {
  const { pluginID: id = '' } = useParams<{ pluginID: string }>();
  const { plugin } = usePlugin({ id });

  if (plugin.isLoading) {
    return null;
  }

  if (plugin.data === undefined) {
    return null;
  }

  return (
    <PluginContext.Provider value={plugin.data}>
      {children}
    </PluginContext.Provider>
  );
};
