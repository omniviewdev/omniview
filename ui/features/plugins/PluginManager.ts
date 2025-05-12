import { RouteObject } from 'react-router-dom';
import { PluginWindow } from '@omniviewdev/runtime';
import PluginRenderer from './components/PluginRenderer';
import { RouterErrorBoundary } from '@/ErrorBoundary';

const pluginRegistry = new Map<string, PluginWindow>();
const pluginRoutes = new Map<string, RouteObject[]>();

// load and register all of the plugins

export function registerPlugin(pluginID: string, pluginWindow: PluginWindow) {
  pluginRegistry.set(pluginID, pluginWindow);
  if (pluginWindow.Routes) {
    const routes = normalizePluginRoutes(pluginWindow.Routes)
    console.log(`got routes for plugin ${pluginID}`, routes)

    pluginRoutes.set(pluginID, routes);
  }
}

export function getPlugin(pluginID: string): PluginWindow | undefined {
  return pluginRegistry.get(pluginID);
}

export function getAllPluginRoutes(): RouteObject[] {
  return Array.from(pluginRoutes.entries()).map(([pluginID, routes]) => ({
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
  return r
}
