import type { AccessRoute } from '../../resource/v2/domain';
import { useResourceCatalog } from './useResourceCatalog';

/**
 * One resource type of a route's catalog, for consumers that mount per virtualized row or cell.
 *
 * It shares the catalog query with `useResourceTypes` but never starts a refresh by mounting or
 * by the window regaining focus, and never retries a failed catalog on mount. It loads a missing
 * catalog once and follows invalidations, explicit refetches, refreshes started by a screen using
 * `useResourceTypes`, and new connection generations. A screen that has no `useResourceTypes`
 * observer and needs a fresh catalog calls `resourceType.refetch()`.
 */
export const useResourceType = ({ pluginID, route, type }: { pluginID?: string; route: AccessRoute; type: string }) => {
  const resourceType = useResourceCatalog({
    pluginID,
    route,
    enabled: !!type,
    refresh: 'explicitOnly',
    select: (catalog) => catalog.types.find((entry) => entry.type === type),
  });
  return { resourceType };
};

export default useResourceType;
