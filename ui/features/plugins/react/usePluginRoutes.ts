import { useMemo } from 'react';
import type { RouteObject } from 'react-router-dom';
import { usePluginService } from './usePluginService';
import PluginRenderer from '../components/PluginRenderer';
import PluginNotFoundPage from '../components/PluginNotFoundPage';
import { RouterErrorBoundary } from '@/features/router/components/ErrorBoundary';

export interface UsePluginRoutesResult {
  readonly ready: boolean;
  readonly routeVersion: number;
  readonly routes: RouteObject[];
}

/**
 * Recursively normalizes a plugin's route tree so it can be safely nested
 * under a parent path (e.g., /_plugin/{pluginId}).
 *
 * - Strips leading slashes from child paths
 * - Preserves index routes
 */
function normalizePluginRoutes(routes: RouteObject[]): RouteObject[] {
  return routes.map((route) => {
    const normalized: RouteObject = {
      ...route,
      path: route.index ? undefined : route.path?.replace(/^\/+/, ''),
    };
    if (route.children) {
      normalized.children = normalizePluginRoutes(route.children);
    }
    return normalized;
  });
}

const notFoundRoute: RouteObject = {
  path: '*',
  Component: PluginNotFoundPage,
};

/**
 * Derives plugin routes from the PluginService snapshot.
 * Route rebuilds are driven only by `routeVersion`.
 *
 * Each plugin's routes are wrapped under `path: pluginId` with a
 * PluginRenderer layout and catch-all not-found route, matching
 * the structure expected by the `/_plugin/:pluginId` parent route.
 */
export function usePluginRoutes(): UsePluginRoutesResult {
  const { ready, routeVersion, registrations } = usePluginService();

  const routes = useMemo(() => {
    const wrappedRoutes: RouteObject[] = [];
    for (const [pluginId, reg] of registrations) {
      wrappedRoutes.push({
        path: pluginId,
        loader: () => ({ pluginID: pluginId }),
        Component: PluginRenderer,
        ErrorBoundary: RouterErrorBoundary,
        children: [...normalizePluginRoutes(reg.routes), notFoundRoute],
      });
    }
    return wrappedRoutes;
  }, [routeVersion]);

  return { ready, routeVersion, routes };
}
