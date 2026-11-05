import { useRouteError, type RouteObject } from 'react-router';
import { createElement, type ReactNode } from 'react';
import { PluginRouteErrorBoundary } from '../components/PluginSurfaceBoundary';

/** Normalize registered routes for nesting below the host's plugin-owned path. */
export function normalizePluginRoutes(routes: RouteObject[], pluginId: string): RouteObject[] {
  const ErrorBoundary = () => createElement(PluginRouteErrorBoundary, { pluginId });
  return routes.map((route): RouteObject => {
    const lazy = route.lazy;
    const hasBoundary = route.ErrorBoundary !== undefined || route.errorElement !== undefined
      || (typeof lazy === 'object' && (lazy.ErrorBoundary !== undefined || lazy.errorElement !== undefined));
    const LazyFallback = (): ReactNode => {
      if (useRouteError() != null) {
        if (route.ErrorBoundary) {
          return createElement(route.ErrorBoundary);
        }

        if (route.errorElement != null) {
          return route.errorElement;
        }

        return createElement(ErrorBoundary);
      }

      if (route.HydrateFallback) {
        return createElement(route.HydrateFallback);
      }

      return route.hydrateFallbackElement ?? null;
    };

    let renderLazyBoundary: (() => ReactNode) | undefined;
    const boundary = typeof lazy === 'function' ? {
      ...(hasBoundary ? {} : {
        ErrorBoundary: (): ReactNode => renderLazyBoundary ? renderLazyBoundary() : createElement(ErrorBoundary),
      }),
      lazy: async () => {
        const { ErrorBoundary: LazyBoundary, errorElement, ...loaded } = await lazy();
        if (!hasBoundary && LazyBoundary != null) {
          renderLazyBoundary = () => createElement(LazyBoundary);
        } else if (!hasBoundary && errorElement != null) {
          renderLazyBoundary = (): ReactNode => errorElement;
        }

        return loaded;
      },
    } : hasBoundary ? {} : { ErrorBoundary };
    const fallback = lazy ? { HydrateFallback: LazyFallback, hydrateFallbackElement: undefined } : {};

    if (route.index) {
      return { ...route, ...boundary, ...fallback, path: undefined };
    }

    return {
      ...route,
      ...boundary,
      ...fallback,
      path: route.path?.replace(/^\/+/, ''),
      ...(route.children ? { children: normalizePluginRoutes(route.children, pluginId) } : {}),
    };
  });
}
