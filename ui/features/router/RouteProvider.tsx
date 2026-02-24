import { useContext, useEffect, useLayoutEffect, useState } from 'react';
import { createHashRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { PluginRegistryContext } from '../plugins/PluginRegistryProvider';
import { getAllPluginRoutes } from '../plugins/PluginManager';
import { coreRoutes } from './routes';
import { EventsOn } from '@omniviewdev/runtime/runtime';
import PrimaryLoading from '@/components/util/PrimaryLoading';

const buildPluginRouteWrapper = () => {
  // Deep-clone the top-level route and its children array to avoid mutating
  // the module-level coreRoutes. Previous code used a shallow spread and
  // pushed onto the original children array, accumulating duplicate _plugin
  // entries on every call (install, reload, recalc_routes).
  const coreChildren = [...(coreRoutes[0].children ?? [])];
  const pluginRoutes = getAllPluginRoutes();

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
  const { ready } = useContext(PluginRegistryContext);
  const [router, setRouter] = useState<ReturnType<typeof createHashRouter>>();

  /**
   * When we have all of the plugins loaded, patch them and load them into
   * the route list. Make sure we do this before we paint to the screen
   */
  useLayoutEffect(() => {
    if (!ready) {
      // Clear stale router so the loading gate stays consistent.
      setRouter(undefined);
      console.debug('[RouteProvider] not ready — cleared router');
      return;
    }

    const newRouter = createHashRouter(buildPluginRouteWrapper());
    setRouter(newRouter);
    console.debug('[RouteProvider] router created');
  }, [ready]);


  /**
   * Listen for changes to the dev plugins for when they reload so that we
   * can react to them.
   */
  useEffect(() => {
    if (!ready) {
      return;
    }

    const cleanup = EventsOn("core/window/recalc_routes", () => {
      console.debug('[RouteProvider] recalc_routes event received — rebuilding router');
      setRouter(createHashRouter(buildPluginRouteWrapper()));
    });

    return () => cleanup();
  }, [ready]);

  if (!ready || !router) {
    console.debug('[RouteProvider] rendering PrimaryLoading', { ready, hasRouter: !!router });
    return <PrimaryLoading message="Preparing workspace..." />;
  }

  return <RouterProvider router={router} />;
};
