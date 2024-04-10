/* eslint @typescript-eslint/naming-convention: 0 */  // firing on the route objects
import { Outlet, type RouteObject } from 'react-router-dom';

import CoreLayout from './layouts/core/main/CoreLayout';

// Lazy load each container
import Plugins from './pages/plugins';

// Connecting page
import Settings from './pages/settings';

// New core
import PaneRenderer from './providers/PaneProvider';
import Container from './layouts/core/main/Container';
import Welcome from './pages/welcome';
import PluginContainer from './layouts/core/main/PluginContainer';

// Plugin
import PluginHome from './pages/[plugin]/Home';

// Plugin: connection
import EditConnectionPage from './pages/[plugin]/[connectionID]/edit';
import ConnectionDetails from './pages/[plugin]/[connectionID]/edit/ConnectionDetails';
import ResourceTableView from './pages/[plugin]/[connectionID]/resources/ResourceTableView';

import { RouterErrorBoundary } from './ErrorBoundary';

export const scoped: RouteObject[] = [
  {
    path: '/',
    Component: Container,
    ErrorBoundary: RouterErrorBoundary,
    children: [
      {
        path: '/',
        index: true,
        Component: Welcome,
      },
      {
        path: 'plugin',
        Component: PluginContainer,
        ErrorBoundary: RouterErrorBoundary,
        children: [
          {
            path: ':pluginID',
            Component: Outlet,
            children: [
              {
                path: '',
                index: true,
                Component: PluginHome,
              },
              {
                path: 'connection/:connectionID',
                children: [
                  {
                    path: 'edit',
                    Component: EditConnectionPage,
                    children: [
                      {
                        path: 'details',
                        Component: ConnectionDetails,
                      },
                    ],
                  },
                  {
                    path: 'resources',
                    Component: ResourceTableView,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

/**
 *
 * The core router exists at the root of the application, and is used to provide
 * the global layout and navigation to the rest of the application.
 * Routes withing this router will override any display within the pane renderer,
 * with the root route displaying the pane renderer.
 */
export const core = [
  {
    path: '/',
    Component: CoreLayout,
    children: [
      {
        path: '/',
        index: true,
        Component: PaneRenderer,
      },
      {
        path: 'plugin',
        Component: PaneRenderer,
      },
      {
        path: 'settings',
        Component: Settings,
      },
      {
        path: 'plugins',
        Component: Plugins,
      },
    ],
  },
];
