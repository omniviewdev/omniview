/* eslint @typescript-eslint/naming-convention: 0 */  // firing on the route objects
import { type RouteObject } from 'react-router-dom';

import CoreLayout from '../../layouts/core/main/CoreLayout';
import { RouterErrorBoundary } from './components/ErrorBoundary';

// Plugins
import Plugins from '../../pages/plugins';
import PluginDetails from '../../pages/plugins/PluginDetails';
import InstalledPlugins from '../../pages/plugins/InstalledPlugins';

// Settings
import Settings from '../../pages/settings';

// Home
import Welcome from '../../pages/welcome';

// Trivy
import TrivyLayout from '../../pages/trivy';
import TrivyDashboard from '../../pages/trivy/pages/scan';
import TrivyScan from '../../pages/trivy/pages/scan';
import TrivyVulnerabilities from '../../pages/trivy/pages/vulnerabilities';
import TrivyLicenses from '../../pages/trivy/pages/licenses';
import TrivySBOM from '../../pages/trivy/pages/sbom';
import TrivyMisconfiguration from '../../pages/trivy/pages/misconfiguration';

export const coreRoutes: RouteObject[] = [
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
    ],
  },
];
