import type { AccessRoute } from '../../resource/v2/domain';
import { useResourceCatalog } from './useResourceCatalog';

/**
 * Resource types a route advertises, for a screen that presents or depends on the catalog.
 *
 * The catalog is shared by every observer of the route and stays fresh for 30 seconds. A stale
 * or failed catalog is refreshed when a screen using this hook mounts or the window regains
 * focus, even though the app's QueryClient disables focus refetching. Use `useResourceType` for
 * consumers that mount per virtualized row: they never start a refresh by mounting.
 *
 * Catalogs are scoped to the connection's readiness generation, so a restarted or replaced
 * connection never serves its previous target's catalog.
 */
export const useResourceTypes = ({ pluginID, route, enabled = true }: { pluginID?: string; route: AccessRoute; enabled?: boolean }) => {
  const resourceTypes = useResourceCatalog({ pluginID, route, enabled, refresh: 'whenStale', select: (catalog) => catalog.types });
  return { resourceTypes };
};
