import { useContext, useLayoutEffect, useState } from 'react';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { PluginRegistryContext } from '../plugins/PluginRegistryProvider';
import { getAllPluginRoutes } from '../plugins/PluginManager';
import { coreRoutes } from './routes';

const buildPluginRouteWrapper = () => {
  const routes = [...coreRoutes]
  routes[0].children?.push({
    path: '_plugin',
    children: getAllPluginRoutes(),
  })
  return routes
};

// let router: ReturnType<typeof createHashRouter>

export const RouteProvider = () => {
  const { ready } = useContext(PluginRegistryContext);
  const [router, setRouter] = useState<ReturnType<typeof createHashRouter>>()

  /**
   * When we have all of the plugins loaded, patch them and load them into
   * the route list. Make sure we do this before we paint to the screen
   */
  useLayoutEffect(() => {
    if (!ready) {
      // don't have anything to render yet
      return
    }

    setRouter(createHashRouter(buildPluginRouteWrapper()))
  }, [ready])


  ///**
  // * Listen for changes to the dev plugins for when they reload so that we 
  // * can react to them.
  // */
  //useEffect(() => {
  //
  //}, [])

  // If we're not ready yet, don't render it out
  if (!ready) {
    return <div>Not Ready</div>
  }

  if (!router) {
    return <div>No Router</div>;
  }

  return <RouterProvider router={router} />;
};
