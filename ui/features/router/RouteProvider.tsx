import { useLayoutEffect, useState } from 'react';
import { createHashRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { usePluginRoutes } from '@/features/plugins';
import { coreRoutes } from './routes';
import PrimaryLoading from '@/components/util/PrimaryLoading';

const buildPluginRouteWrapper = (pluginRoutes: RouteObject[]) => {
  // Deep-clone the top-level route and its children array to avoid mutating
  // the module-level coreRoutes. Previous code used a shallow spread and
  // pushed onto the original children array, accumulating duplicate _plugin
  // entries on every call.
  const coreChildren = [...(coreRoutes[0].children ?? [])];

  console.debug('[RouteProvider] buildPluginRouteWrapper', {
    coreChildCount: coreChildren.length,
    pluginRouteCount: pluginRoutes.length,
    pluginIds: pluginRoutes.map(r => r.path),
  });

  coreChildren.push({
    path: '_plugin',
    children: pluginRoutes,
  });

  // Preserve any additional top-level routes (e.g., catch-all)
  return [
    { ...coreRoutes[0], children: coreChildren } as RouteObject,
    ...coreRoutes.slice(1),
  ];
};

export const RouteProvider = () => {
  const { routeVersion, routes: pluginRoutes } = usePluginRoutes();
  const [router, setRouter] = useState<ReturnType<typeof createHashRouter>>();

  /**
   * Build the router immediately with whatever plugin routes are available
   * (could be zero on the first render). The router is rebuilt each time
   * routeVersion bumps, so plugins that finish loading later are picked up
   * incrementally without blocking the initial render.
   */
  useLayoutEffect(() => {
    const newRouter = createHashRouter(buildPluginRouteWrapper(pluginRoutes));
    setRouter(newRouter);
    console.debug('[RouteProvider] router created', { routeVersion });
  }, [routeVersion]);

  if (!router) {
    console.debug('[RouteProvider] rendering PrimaryLoading (first render)');
    return <PrimaryLoading message="Preparing workspace..." />;
  }

  return <RouterProvider router={router} />;
};
