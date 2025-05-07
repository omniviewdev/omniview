import { useContext } from 'react';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { PluginRegistryContext } from '../plugins/PluginRegistryProvider';
import { getAllPluginRoutes } from '../plugins/PluginManager';
import { coreRoutes } from './routes';

const buildPluginRouteWrapper = () => {
  const routes = coreRoutes
  routes[0].children?.push({
    path: '_plugin',
    children: getAllPluginRoutes(),
  })
  return routes
};

export const RouteProvider = () => {
  const { ready } = useContext(PluginRegistryContext);

  if (!ready) {
    return <div>Loading plugins...</div>; // or a spinner, skeleton, etc.
  }

  const router = createHashRouter(buildPluginRouteWrapper());
  return <RouterProvider router={router} />;
};
