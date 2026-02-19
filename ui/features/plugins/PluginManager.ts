import React from 'react';
import { RouteObject } from 'react-router-dom';
import { PluginWindow, DrawerContext } from '@omniviewdev/runtime';
import PluginRenderer from './components/PluginRenderer';
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

export function getPlugin(pluginID: string): PluginWindow | undefined {
  return pluginRegistry.get(pluginID);
}

export function getAllPluginRoutes(): RouteObject[] {
  const entries = Array.from(pluginRoutes.entries());
  console.debug('[PluginManager] getAllPluginRoutes called', {
    registeredPluginCount: entries.length,
    pluginIds: entries.map(([id]) => id),
  });

  return entries.map(([pluginID, routes]) => ({
    loader: () => ({ pluginID }),
    Component: PluginRenderer,
    ErrorBoundary: RouterErrorBoundary,
    path: pluginID,
    children: routes,
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
