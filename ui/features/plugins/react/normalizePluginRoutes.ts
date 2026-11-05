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
    // Resolve rejected imports into a throwing render instead of leaving the
    // router's lazy marker pending, which suppresses the matched child outlet.
    let importFailed = false;
    let importError: unknown;
    let renderLazyBoundary: (() => ReactNode) | undefined;
    const StaticComponent = route.Component;
    const staticElement = route.element;
    const hasStaticRender = StaticComponent != null || staticElement !== undefined;
    const boundary = typeof lazy === 'function' ? {
      ...(hasBoundary ? {} : {
        ErrorBoundary: (): ReactNode => renderLazyBoundary ? renderLazyBoundary() : createElement(ErrorBoundary),
      }),
      ...(hasStaticRender ? {
        element: undefined,
        Component: (): ReactNode => {
          if (importFailed) {
            throw importError;
          }

          return StaticComponent != null ? createElement(StaticComponent) : staticElement;
        },
      } : {}),
      lazy: async () => {
        try {
          const { ErrorBoundary: LazyBoundary, errorElement, ...loaded } = await lazy();
          if (!hasBoundary && LazyBoundary != null) {
            renderLazyBoundary = () => createElement(LazyBoundary);
          } else if (!hasBoundary && errorElement !== undefined) {
            renderLazyBoundary = (): ReactNode => errorElement;
          }

          return loaded;
        } catch (error) {
          importFailed = true;
          importError = error;
          return hasStaticRender ? {} : { Component: () => {
            throw error;
          } };
        }
      },
    } : hasBoundary ? {} : { ErrorBoundary };

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
