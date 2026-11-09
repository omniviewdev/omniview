import { skipToken, useQuery } from '@tanstack/react-query';
import { Catalog } from '../../resource/v2/client';
import type { AccessRoute, Catalog as CatalogResult } from '../../resource/v2/domain';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionGeneration } from './useConnectionGeneration';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';

/**
 * Who may start a refresh of a catalog that every observer of a route shares.
 *
 * `whenStale` is for a screen that presents or depends on the catalog. A stale
 * or failed catalog is refreshed when such a screen mounts, when the window
 * regains focus and when the network reconnects. The app's QueryClient turns
 * focus refetching off globally, so each observer has to state it.
 *
 * `explicitOnly` is for cells that mount per virtualized row. They load a
 * missing catalog once, and otherwise follow refreshes that something else
 * starts: an invalidation, an explicit refetch, a screen, or a new connection
 * generation. Row mounts never refresh a stale catalog and never retry a failed
 * one, so scrolling cannot turn a slow or failing catalog into a request storm.
 */
export type CatalogRefresh = 'whenStale' | 'explicitOnly';

const CATALOG_STALE_MS = 30_000;

/**
 * One catalog query per route and connection generation.
 *
 * The readiness generation changes whenever the connection is restarted,
 * reconfigured or lost, which is when the native client behind a route can be
 * replaced. A cached catalog is therefore never served across such a change, even
 * though the connection ID stays the same, and a response that is still in flight
 * across one is rejected by the connection query guard.
 */
export function useResourceCatalog<TData>({
  pluginID: explicitPluginID,
  route,
  enabled,
  refresh,
  select,
}: {
  pluginID?: string;
  route: AccessRoute;
  enabled: boolean;
  refresh: CatalogRefresh;
  select: (catalog: CatalogResult) => TData;
}) {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const readiness = useConnectionReadiness({ pluginID, connectionID: route.connection, enabled });
  const guardQuery = useConnectionQueryGuard(pluginID, route.connection);
  const generation = useConnectionGeneration(pluginID, route.connection, enabled);
  const queryEnabled = enabled && !!pluginID && !!route.connection && readiness.phase === 'connected' && generation !== undefined;
  // A cell never starts a refresh by mounting, regaining focus or reconnecting, and never retries a failed catalog.
  const startsRefresh = refresh === 'whenStale';
  return useQuery({
    queryKey: [pluginID, 'resource-v2', 'catalog', route, generation],
    queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => Catalog(pluginID, { route })) : skipToken,
    select,
    enabled: queryEnabled,
    retry: false,
    staleTime: CATALOG_STALE_MS,
    refetchOnMount: startsRefresh,
    refetchOnWindowFocus: startsRefresh,
    refetchOnReconnect: startsRefresh,
    retryOnMount: startsRefresh,
  });
}
