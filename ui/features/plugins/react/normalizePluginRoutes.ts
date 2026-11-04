import type { RouteObject } from 'react-router';
import { createElement } from 'react';
import { PluginRouteErrorBoundary } from '../components/PluginSurfaceBoundary';

/** Normalize registered routes for nesting below the host's plugin-owned path. */
export function normalizePluginRoutes(routes: RouteObject[], pluginId: string): RouteObject[] {
  const ErrorBoundary = () => createElement(PluginRouteErrorBoundary, { pluginId });
  return routes.map((route): RouteObject => {
    const lazy = route.lazy;
    const hasBoundary = route.ErrorBoundary !== undefined || route.errorElement !== undefined
      || (typeof lazy === 'object' && (lazy.ErrorBoundary !== undefined || lazy.errorElement !== undefined));
    // Lazy route modules may supply their own boundary. Keep that choice intact.
    const boundary = hasBoundary ? {} : typeof lazy === 'function' ? {
      lazy: async () => {
        const loaded = await lazy();
        return loaded.ErrorBoundary !== undefined || loaded.errorElement !== undefined
          ? loaded
          : { ...loaded, ErrorBoundary };
      },
    } : { ErrorBoundary };

    if (route.index) {
      return { ...route, ...boundary, path: undefined };
    }

    return {
      ...route,
      ...boundary,
      path: route.path?.replace(/^\/+/, ''),
      ...(route.children ? { children: normalizePluginRoutes(route.children, pluginId) } : {}),
    };
  });
}
