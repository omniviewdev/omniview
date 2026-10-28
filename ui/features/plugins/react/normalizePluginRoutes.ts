import type { RouteObject } from 'react-router-dom';

/** Normalize registered routes for nesting below the host's plugin-owned path. */
export function normalizePluginRoutes(routes: RouteObject[]): RouteObject[] {
  return routes.map((route): RouteObject => {
    if (route.index) {
      return { ...route, path: undefined };
    }

    return {
      ...route,
      path: route.path?.replace(/^\/+/, ''),
      ...(route.children ? { children: normalizePluginRoutes(route.children) } : {}),
    };
  });
}
