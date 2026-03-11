import { useQuery } from '@tanstack/react-query';
import { PluginManager, DevServerManager } from '@omniviewdev/runtime/api';

/**
 * Read-only startup hook for fetching installed plugin descriptors.
 *
 * This hook is independent from usePluginService() so it can be used
 * inside PluginServiceProvider without creating a bootstrap cycle.
 *
 * Returns minimal descriptor data for the provider to pass to loadAll().
 */
export interface InstalledPluginDescriptor {
  readonly id: string;
  readonly dev: boolean;
  readonly devPort?: number;
}

export function useInstalledPlugins(): {
  readonly plugins: InstalledPluginDescriptor[];
  readonly isLoading: boolean;
} {
  const query = useQuery({
    queryKey: ['installed-plugins'],
    queryFn: async () => {
      const plugins = await PluginManager.ListPlugins();
      if (!plugins) return [];

      // For dev plugins, fetch dev server states to get Vite ports
      const hasDevPlugins = plugins.some((p) => p.devMode);
      let devPortsByPlugin: Map<string, number> | undefined;

      if (hasDevPlugins) {
        try {
          const states = await DevServerManager.ListDevServerStates();
          if (states?.length) {
            devPortsByPlugin = new Map(
              states
                .filter((s) => s.vitePort > 0)
                .map((s) => [s.pluginID, s.vitePort]),
            );
          }
        } catch (err) {
          console.debug('[useInstalledPlugins] DevServerManager unavailable:', err);
        }
      }

      return plugins.map((p): InstalledPluginDescriptor => ({
        id: p.id,
        dev: p.devMode ?? false,
        devPort: devPortsByPlugin?.get(p.id),
      }));
    },
    // Poll until first successful fetch (backend may not be ready yet)
    refetchInterval: (query) => {
      return query.state.status !== 'success' ? 2000 : false;
    },
  });

  return {
    plugins: query.data ?? [],
    isLoading: query.isLoading,
  };
}
