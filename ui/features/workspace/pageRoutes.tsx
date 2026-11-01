/* eslint @typescript-eslint/naming-convention: 0 */ // firing on the route objects
import { useMemo } from 'react';
import type { RouteObject } from 'react-router';

import { usePluginRoutes } from '@/features/plugins';
import PluginRouteStatus from '@/features/plugins/components/PluginRouteStatus';
import { RouterErrorBoundary } from '@/features/router/components/ErrorBoundary';
import PrimaryLoading from '@/components/util/PrimaryLoading';
import Plugins from '@/pages/plugins';
import PluginDetails from '@/pages/plugins/PluginDetails';
import InstalledPlugins from '@/pages/plugins/InstalledPlugins';
import Home from '@/pages/home';
import ResourceBrowser from '@/features/connections/ResourceBrowser';
import ConnectionDetails from '@/features/connections/ConnectionDetails';
import ConnectionProfiles from '@/features/connections/ConnectionProfiles';

/**
 * Routes of one page tab: every page of the app without the shell around it.
 * Each tab owns a memory router over this tree.
 */
export function buildPageRoutes(pluginRoutes: RouteObject[]): RouteObject[] {
  return [
    {
      // Pathless root: shows the loading state while plugin route loaders run.
      hydrateFallbackElement: <PrimaryLoading message='Loading page...' />,
      children: [
        { index: true, Component: Home, ErrorBoundary: RouterErrorBoundary },
        {
          path: 'plugins',
          Component: Plugins,
          ErrorBoundary: RouterErrorBoundary,
          children: [
            { index: true, Component: InstalledPlugins },
            { path: ':id', Component: PluginDetails },
          ],
        },
        { path: 'resources/:pluginID/:connectionID', Component: ResourceBrowser, ErrorBoundary: RouterErrorBoundary },
        { path: 'connections/:pluginID', Component: ConnectionProfiles, ErrorBoundary: RouterErrorBoundary },
        { path: 'connections/:pluginID/:connectionID/edit', Component: ConnectionDetails, ErrorBoundary: RouterErrorBoundary },
        {
          path: '_plugin',
          ErrorBoundary: RouterErrorBoundary,
          children: [
            ...pluginRoutes,
            { path: ':pluginId/*', Component: PluginRouteStatus },
          ],
        },
        { path: '*', element: null },
      ],
    },
  ];
}

/** Page routes for the plugins registered right now; a new array whenever plugin routes change. */
export function usePageRoutes(): RouteObject[] {
  const { routes: pluginRoutes } = usePluginRoutes();
  return useMemo(() => buildPageRoutes(pluginRoutes), [pluginRoutes]);
}
