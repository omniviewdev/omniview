import { PluginManager } from '@omniviewdev/runtime/api';
import { Events } from '@omniviewdev/runtime/runtime';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { PluginDescriptor } from './pluginStore';

// The installed plugins whose interface the host should load, read from the host's own inventory. The query key is the one the old shell's inventory uses
// (ui/hooks/plugin/useInstalledPlugins.ts), and so are the events that change the inventory; the old shell's polling until the first answer stays,
// because the backend may not be ready when the window opens (decision R13: startup retries that exist for that reason stay).

/** Events after which the inventory is read again: a plugin was installed, updated, enabled, disabled, or the first load finished. */
const INVENTORY_EVENTS = [
  'plugin/init_complete',
  'plugin/inventory_changed',
  'plugin/install_finished',
  'plugin/update_complete',
  'plugin/enablement_changed',
] as const;

export const INVENTORY_KEY = ['plugins'] as const;

const POLL_UNTIL_READ_MS = 2000;

export type Inventory = {
  readonly plugins: readonly PluginDescriptor[];
  readonly state: 'loading' | 'ready' | 'failed';
  readonly retry: () => void;
};

export function useInstalledPlugins(): Inventory {
  const queryClient = useQueryClient();
  useEffect(() => {
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: INVENTORY_KEY });
    };

    const stops = INVENTORY_EVENTS.map((name) => Events.On(name, invalidate));
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [queryClient]);

  const query = useQuery({
    queryKey: INVENTORY_KEY,
    queryFn: async () => (await PluginManager.ListPlugins()) ?? [],
    refetchInterval: (current) => (current.state.status === 'success' ? false : POLL_UNTIL_READ_MS),
  });

  const plugins = useMemo(
    () =>
      (query.data ?? [])
        // Product-owned frontends and plugins the user turned off have no bundle to load here.
        .filter((plugin) => plugin.origin !== 'builtin' && plugin.enabled)
        .map((plugin): PluginDescriptor => ({ id: plugin.id, name: plugin.metadata.name === '' ? plugin.id : plugin.metadata.name })),
    [query.data],
  );

  const { refetch } = query;
  const retry = () => {
    void refetch();
  };

  // A read that failed is retried by the poll; "failed" is what the page says meanwhile, with the same retry in hand.
  return { plugins, state: query.status === 'success' ? 'ready' : query.status === 'error' ? 'failed' : 'loading', retry };
}
