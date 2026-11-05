import type { RouteObject } from 'react-router';
import { createElement, type ReactNode } from 'react';
import { PluginRouteErrorBoundary } from '../components/PluginSurfaceBoundary';

/** Normalize registered routes for nesting below the host's plugin-owned path. */
export function normalizePluginRoutes(routes: RouteObject[], pluginId: string): RouteObject[] {
  const ErrorBoundary = () => createElement(PluginRouteErrorBoundary, { pluginId });
  return routes.map((route): RouteObject => {
    const lazy = route.lazy;
    const hasBoundary = route.ErrorBoundary !== undefined || route.errorElement !== undefined
      || (typeof lazy === 'object' && (lazy.ErrorBoundary !== undefined || lazy.errorElement !== undefined));
    // Register a boundary before loading so rejected imports stay local, while
    // allowing a successfully loaded module to provide its own fallback.
    let renderLazyBoundary: (() => ReactNode) | undefined;
    const boundary = hasBoundary ? {} : typeof lazy === 'function' ? {
      ErrorBoundary: (): ReactNode => renderLazyBoundary ? renderLazyBoundary() : createElement(ErrorBoundary),
      lazy: async () => {
        const { ErrorBoundary: LazyBoundary, errorElement, ...loaded } = await lazy();
        if (LazyBoundary != null) {
          renderLazyBoundary = () => createElement(LazyBoundary);
        } else if (errorElement !== undefined) {
          renderLazyBoundary = (): ReactNode => errorElement;
        }

        return loaded;
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
