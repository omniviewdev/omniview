import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createHashRouter, type DataRouter, type NonIndexRouteObject, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { usePluginRoutes } from '@/features/plugins';
import { coreRoutes } from './routes';
import PrimaryLoading from '@/components/util/PrimaryLoading';
import { reportStartupReady } from '@/features/perf/startup';
import PluginRouteStatus from '@/features/plugins/components/PluginRouteStatus';

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
    children: [
      ...pluginRoutes,
      { path: ':pluginId/*', Component: PluginRouteStatus },
    ],
  });

  const root: RouteObject = {
    ...(coreRoutes[0] as NonIndexRouteObject),
    children: coreChildren,
    hydrateFallbackElement: <PrimaryLoading message="Loading workspace..." />,
  };

  // Preserve any additional top-level routes (e.g., catch-all)
  return [
    root,
    ...coreRoutes.slice(1),
  ];
};

// Construct only inert ownership during render. Replace committed routers without
// publishing a null snapshot: a loading gap would unmount the shell and its dialogs.
function createRouterOwner(initialRoutes: RouteObject[]) {
  let routes = initialRoutes;
  let router: DataRouter | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => router,
    setRoutes: (nextRoutes: RouteObject[]) => {
      if (routes === nextRoutes) {
        return;
      }

      routes = nextRoutes;
      if (!listeners.size) {
        return;
      }

      const previous = router;
      router = createHashRouter(routes);
      listeners.forEach((notify) => {
        notify();
      });
      previous?.dispose();
    },
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      router ??= createHashRouter(routes);

      notify();
      return () => {
        listeners.delete(notify);
        if (!listeners.size) {
          router?.dispose();
          router = null;
        }
      };
    },
  };
}

export const RouteProvider = () => {
  const { routes: pluginRoutes } = usePluginRoutes();
  const routes = useMemo(() => buildPluginRouteWrapper(pluginRoutes), [pluginRoutes]);
  const [owner] = useState(() => createRouterOwner(routes));
  const router = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  useEffect(() => {
    owner.setRoutes(routes);
  }, [owner, routes]);

  // The shell counts as interactive once the first router has rendered.
  useEffect(() => {
    if (router) {
      reportStartupReady();
    }
  }, [router]);

  if (!router) {
    return <PrimaryLoading message="Preparing workspace..." />;
  }

  return <RouterProvider router={router} />;
};
