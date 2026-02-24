import React from 'react';
import { RouteObject } from 'react-router-dom';
import { PluginWindow, DrawerContext, DrawerFactory } from '@omniviewdev/runtime';
import PluginRenderer from './components/PluginRenderer';
import PluginLoadErrorPage from './components/PluginLoadErrorPage';
import PluginNotFoundPage from './components/PluginNotFoundPage';
import { RouterErrorBoundary } from '@/features/router/components/ErrorBoundary';

const pluginRegistry = new Map<string, PluginWindow>();
const pluginRoutes = new Map<string, RouteObject[]>();

// ── Sidebar registry ────────────────────────────────────────────────

type SidebarComponent = React.FC<{ ctx: DrawerContext }>;
const sidebarRegistry = new Map<string, Record<string, SidebarComponent>>();

export function registerPluginSidebars(pluginID: string, sidebars: Record<string, SidebarComponent>) {
  sidebarRegistry.set(pluginID, sidebars);
  console.debug(`[PluginManager] registered sidebars for "${pluginID}"`, {
    plugin: pluginID,
    sidebarKeys: Object.keys(sidebars),
  });
}

export function getSidebarComponent(pluginID: string, resourceKey: string): SidebarComponent | undefined {
  return sidebarRegistry.get(pluginID)?.[resourceKey];
}

// ── Drawer registry ─────────────────────────────────────────────────

const drawerRegistry = new Map<string, Record<string, DrawerFactory>>();

export function registerPluginDrawers(pluginID: string, drawers: Record<string, DrawerFactory>) {
  drawerRegistry.set(pluginID, drawers);
  console.debug(`[PluginManager] registered drawers for "${pluginID}"`, {
    plugin: pluginID,
    drawerKeys: Object.keys(drawers),
  });
}

export function getDrawerFactory(pluginID: string, resourceKey: string): DrawerFactory | undefined {
  return drawerRegistry.get(pluginID)?.[resourceKey];
}

// load and register all of the plugins

export function registerPlugin(pluginID: string, pluginWindow: PluginWindow) {
  pluginRegistry.set(pluginID, pluginWindow);
  if (pluginWindow.Routes) {
    const routes = normalizePluginRoutes(pluginWindow.Routes);
    console.debug(`[PluginManager] registered plugin "${pluginID}"`, {
      plugin: pluginID,
      routeCount: routes.length,
      routePaths: routes.map(r => r.path ?? (r.index ? '(index)' : '(no path)')),
    });
    pluginRoutes.set(pluginID, routes);
  } else {
    console.debug(`[PluginManager] registered plugin "${pluginID}" (no routes)`, { plugin: pluginID });
  }
}

/**
 * Registers a stub route for a plugin that failed to load, so navigating
 * to its path shows an error page instead of blank/404.
 */
export function registerFailedPlugin(pluginID: string, error: string) {
  const errorRoute: RouteObject = {
    index: true,
    Component: () => React.createElement(PluginLoadErrorPage, { pluginId: pluginID, error }),
  };

  // Catch-all so any sub-path under the plugin also shows the error
  const catchAll: RouteObject = {
    path: '*',
    Component: () => React.createElement(PluginLoadErrorPage, { pluginId: pluginID, error }),
  };

  pluginRoutes.set(pluginID, [errorRoute, catchAll]);
  console.debug(`[PluginManager] registered failed plugin stub for "${pluginID}"`, { plugin: pluginID });
}

export function getPlugin(pluginID: string): PluginWindow | undefined {
  return pluginRegistry.get(pluginID);
}

export function getAllPluginRoutes(): RouteObject[] {
  const entries = Array.from(pluginRoutes.entries());
  console.debug('[PluginManager] getAllPluginRoutes called', {
    registeredPluginCount: entries.length,
    pluginIds: entries.map(([id]) => id),
  });

  // Append a catch-all not-found route to each plugin so unmatched paths
  // show a clean error page instead of a blank screen.
  const notFoundRoute: RouteObject = {
    path: '*',
    Component: PluginNotFoundPage,
  };

  return entries.map(([pluginID, routes]) => ({
    loader: () => ({ pluginID }),
    Component: PluginRenderer,
    ErrorBoundary: RouterErrorBoundary,
    path: pluginID,
    children: [...routes, notFoundRoute],
  }));
}

/**
 * Recursively normalizes a plugin's route tree so it can be safely nested
 * under a parent path (e.g., /_plugin/{pluginId}).
 *
 * - Strips leading slashes from child paths
 * - Preserves index routes
 */
export function normalizePluginRoutes(routes: RouteObject[]): RouteObject[] {
  const r = routes.map((route) => {
    const normalized: RouteObject = {
      ...route,
      path: route.index ? undefined : route.path?.replace(/^\/+/, ''), // strip leading /
    };

    if (route.children) {
      normalized.children = normalizePluginRoutes(route.children);
    }

    return normalized;
  });
  return r;
}
