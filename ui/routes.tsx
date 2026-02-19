/* eslint @typescript-eslint/naming-convention: 0 */  // firing on the route objects
import { Outlet, type RouteObject } from 'react-router-dom';

import CoreLayout from './layouts/core/main/CoreLayout';

// Lazy load each container
import Plugins from './pages/plugins';

// Connecting page
import Settings from './pages/settings';

// New core
// import PaneRenderer from './providers/PaneProvider';
// import Container from './layouts/core/main/Container';
import Welcome from './pages/welcome';
import PluginContainer from './layouts/core/main/PluginContainer';

// Plugin
import PluginHome from './pages/[plugin]/Home';

// Plugin: connection
import EditConnectionPage from './pages/[plugin]/[connectionID]/edit';
import ConnectionDetails from './pages/[plugin]/[connectionID]/edit/ConnectionDetails';
import ResourceTableView from './pages/[plugin]/[connectionID]/resources/ResourceTableView';

import { RouterErrorBoundary } from './features/router/components/ErrorBoundary';

// Trivy
import TrivyLayout from './pages/trivy';
import TrivyDashboard from './pages/trivy/pages/scan';
import TrivyScan from './pages/trivy/pages/scan';
import TrivyVulnerabilities from './pages/trivy/pages/vulnerabilities';
import TrivyLicenses from './pages/trivy/pages/licenses';
import TrivySBOM from './pages/trivy/pages/sbom';
import TrivyMisconfiguration from './pages/trivy/pages/misconfiguration';
import PluginRenderer from './features/plugins/components/PluginRenderer';
import PluginDetails from './pages/plugins/PluginDetails';
import InstalledPlugins from './pages/plugins/InstalledPlugins';

// // Apollo
// import ApolloSandboxPage from './pages/apollo';

/**
 * We're having a bit of trouble with the nested context here
 */
export const scoped: RouteObject[] = [
  {
    path: '/',
    Component: CoreLayout,
    ErrorBoundary: RouterErrorBoundary,
    children: [
      {
        path: '/',
        index: true,
        Component: Welcome,
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
      {
        path: 'trivy',
        Component: TrivyLayout,
        ErrorBoundary: RouterErrorBoundary,
        children: [
          {
            path: '',
            index: true,
            Component: TrivyDashboard,
          },
          {
            path: 'scan',
            Component: TrivyScan,
          },
          {
            path: 'vulnerability',
            Component: TrivyVulnerabilities,
          },
          {
            path: 'misconfiguration',
            Component: TrivyMisconfiguration,
          },
          {
            path: 'license',
            Component: TrivyLicenses,
          },
          {
            path: 'sbom',
            Component: TrivySBOM,
          },
        ],
      },

      /**
       * NOTE: The new UI implementation will exist here
       */
      {
        path: '_plugin/:pluginId/*',
        Component: PluginRenderer,
        ErrorBoundary: RouterErrorBoundary,
      },

      /**
       * NOTE: Old implementation
       */
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

// /**
//  *
//  * The core router exists at the root of the application, and is used to provide
//  * the global layout and navigation to the rest of the application.
//  * Routes withing this router will override any display within the pane renderer,
//  * with the root route displaying the pane renderer.
//  */
// export const core = [
//   {
//     path: '/',
//     Component: CoreLayout,
//     children: [
//       {
//         path: '',
//         index: true,
//         Component: PaneRenderer,
//       },
//       {
//         path: 'plugin',
//         Component: PaneRenderer,
//       },
//       {
//         path: 'settings',
//         Component: Settings,
//       },
//       {
//         path: 'plugins',
//         Component: Plugins,
//       },
//     ],
//   },
// ];
