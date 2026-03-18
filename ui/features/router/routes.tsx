/* eslint @typescript-eslint/naming-convention: 0 */  // firing on the route objects
import { Outlet, type RouteObject } from 'react-router-dom';

import CoreLayout from '../../layouts/core/main/CoreLayout';
import { RouterErrorBoundary } from './components/ErrorBoundary';

// Plugins
import Plugins from '../../pages/plugins';
import PluginDetails from '../../pages/plugins/PluginDetails';
import InstalledPlugins from '../../pages/plugins/InstalledPlugins';

// Settings
import Settings from '../../pages/settings';

// Home
import Home from '../../pages/home';

export const coreRoutes: RouteObject[] = [
  {
    path: '/',
    Component: CoreLayout,
    ErrorBoundary: RouterErrorBoundary,
    children: [
      {
        path: '/',
        index: true,
        Component: Home,
      },
      {
        path: 'plugins',
        Component: Plugins,
        children: [
          { path: '', index: true, Component: InstalledPlugins },
          { path: ':id', Component: PluginDetails }
        ]
      },
      {
        path: 'settings',
        Component: Settings,
      },
    ],
  },
  {
    path: '*',
    Component: CoreLayout,
    ErrorBoundary: RouterErrorBoundary,
    children: [
      { path: '*', Component: Outlet }
    ]
  }
];
