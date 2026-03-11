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
  const { ready, routeVersion, routes: pluginRoutes } = usePluginRoutes();
  const [router, setRouter] = useState<ReturnType<typeof createHashRouter>>();

  /**
   * When we have all of the plugins loaded, patch them and load them into
   * the route list. Make sure we do this before we paint to the screen.
   * Also rebuild when routeVersion changes (incremental plugin loads).
   */
  useLayoutEffect(() => {
    if (!ready) {
      // Clear stale router so the loading gate stays consistent.
      setRouter(undefined);
      console.debug('[RouteProvider] not ready — cleared router');
      return;
    }

    const newRouter = createHashRouter(buildPluginRouteWrapper(pluginRoutes));
    setRouter(newRouter);
    console.debug('[RouteProvider] router created', { routeVersion });
  }, [ready, routeVersion]);

  if (!ready || !router) {
    console.debug('[RouteProvider] rendering PrimaryLoading', { ready, hasRouter: !!router });
    return <PrimaryLoading message="Preparing workspace..." />;
  }

  return <RouterProvider router={router} />;
};
