import { PluginManager } from '@omniviewdev/runtime/api';
import { Events } from '@omniviewdev/runtime/runtime';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useMemo } from 'react';
import { Read as readPolicy } from '../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/extensionpolicy/service';
import { observeEventsTransport } from '../../../packages/omniviewdev-runtime/src/eventsReconnect';
import type { ExtensionWindow } from './extensionWindow';
import { describePlugins } from './inventory';
import type { PluginDescriptor } from './pluginStore';
import { isNativeWindow } from '../../shell/core/native';

// The installed plugins whose interface the host should load, read from the host's own inventory. The query key is the one the old shell's inventory uses
// (ui/hooks/plugin/useInstalledPlugins.ts), and so are the events that change the inventory; the old shell's polling until the first answer stays,
// because the backend may not be ready when the window opens (decision R13: startup retries that exist for that reason stay).

export const INVENTORY_KEY = ['plugins'] as const;

const POLL_UNTIL_READ_MS = 2000;

export type Inventory = {
  readonly plugins: readonly PluginDescriptor[];
  readonly state: 'loading' | 'ready' | 'failed';
  readonly retry: () => void;
};

export function useInstalledPlugins(window: ExtensionWindow): Inventory {
  const queryClient = useQueryClient();
  useLayoutEffect(() => {
    const invalidate = () => {
      // The first list may still be in flight when the events socket opens. Do not
      // coalesce a subscribed read with that earlier, ordinary-pages-only request.
      const filter = { queryKey: INVENTORY_KEY, exact: true };
      void queryClient.cancelQueries(filter).then(async () => queryClient.invalidateQueries(filter));
    };

    return window.listen(Events, readPolicy, invalidate, notify => {
      if (!isNativeWindow()) {
        return observeEventsTransport(notify);
      }

      notify(true);
      return () => { /* The native bridge has no reconnect listener to remove. */ };
    });
  }, [window, queryClient]);

  const query = useQuery({
    queryKey: INVENTORY_KEY,
    queryFn: async () => window.inventory(async () => (await PluginManager.ListPlugins()) ?? []),
    refetchOnMount: 'always',
    refetchInterval: (current) => (current.state.status === 'success' ? false : POLL_UNTIL_READ_MS),
  });

  const plugins = useMemo(() => describePlugins(query.data ?? []), [query.data]);

  const { refetch } = query;
  const retry = () => {
    void refetch();
  };

  // A read that failed is retried by the poll; "failed" is what the page says meanwhile, with the same retry in hand.
  return { plugins, state: query.status === 'success' ? 'ready' : query.status === 'error' ? 'failed' : 'loading', retry };
}
