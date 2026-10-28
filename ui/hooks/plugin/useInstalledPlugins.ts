import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PluginManager } from '@omniviewdev/runtime/api';
import { DevProcessStatus, type PluginInfo } from '@omniviewdev/runtime/models';
import { useDevServers } from '@/features/devtools/useDevServers';
import { Events } from '@omniviewdev/runtime/runtime';

/**
 * Read-only startup hook for fetching installed plugin descriptors.
 *
 * This hook is independent from usePluginService() so it can be used
 * inside PluginServiceProvider without creating a bootstrap cycle.
 *
 * Returns minimal descriptor data for the provider to pass to loadAll().
 */
export type InstalledPluginDescriptor = {
  readonly id: string;
  readonly dev: boolean;
  readonly phase?: PluginInfo['phase'];
  readonly lastError?: string;
  readonly devPort?: number;
  readonly devStatus?: DevProcessStatus;
  readonly devError?: string;
};

export function useInstalledPlugins(): {
  readonly plugins: InstalledPluginDescriptor[];
  readonly isLoading: boolean;
  readonly error: Error | null;
} {
  const queryClient = useQueryClient();
  useEffect(() => {
    const invalidateInventory = () => {
      void queryClient.invalidateQueries({ queryKey: ['plugins'] });
    };

    const stopInit = Events.On('plugin/init_complete', invalidateInventory);
    const stopInventory = Events.On('plugin/inventory_changed', invalidateInventory);
    const stopInstall = Events.On('plugin/install_finished', invalidateInventory);
    const stopDevInstall = Events.On('plugin/dev_install_complete', invalidateInventory);
    const stopUpdate = Events.On('plugin/update_complete', invalidateInventory);
    return () => {
      stopInit();
      stopInventory();
      stopInstall();
      stopDevInstall();
      stopUpdate();
    };
  }, [queryClient]);

  const { servers, isLoading: serversLoading, error: serversError } = useDevServers();
  const query = useQuery({
    // Share the management cache so install/uninstall invalidation reaches startup.
    queryKey: ['plugins'],
    queryFn: async () => {
      const plugins = await PluginManager.ListPlugins();
      if (!plugins) {
        return [];
      }

      return plugins;
    },
    // Poll until first successful fetch (backend may not be ready yet)
    refetchInterval: (query) => {
      return query.state.status !== 'success' ? 2000 : false;
    },
  });

  const plugins = useMemo(() => (query.data ?? []).map((plugin): InstalledPluginDescriptor => {
    const dev = plugin.devMode ?? false;
    const server = dev ? servers.get(plugin.id) : undefined;
    return {
      id: plugin.id,
      dev,
      phase: plugin.phase,
      lastError: plugin.lastError === '' ? undefined : plugin.lastError,
      // The backend allocates the port before starting Vite.
      devPort: server?.viteStatus === DevProcessStatus.DevProcessStatusReady && server.vitePort > 0 ? server.vitePort : undefined,
      devStatus: server?.viteStatus,
      devError: server?.lastError === '' ? undefined : server?.lastError ?? (!server && dev ? serversError?.message : undefined),
    };
  }), [query.data, servers, serversError]);

  return {
    plugins,
    isLoading: query.isLoading || (plugins.some((p) => p.dev) && serversLoading),
    error: query.error,
  };
}
