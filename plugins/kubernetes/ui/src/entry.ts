/// <reference types="@welldone-software/why-did-you-render" />
import { PluginWindow } from '@omniviewdev/runtime';
import { RouteObject } from 'react-router-dom';

import ClustersPage from './pages/ClustersPage';
import ClusterEditPage from './pages/ClusterEditPage';
import ClusterResourcesPage from './pages/ClusterResourcesPage';

const routes: Array<RouteObject> = [
  {
    path: '/',
    Component: ClustersPage,
  },
  {
    path: '/clusters',
    Component: ClustersPage,
  },
  {
    path: '/cluster/:id',
    children: [
      {
        path: 'edit',
        Component: ClusterEditPage,
      },
      {
        path: 'resources',
        Component: ClusterResourcesPage,
      }
    ]
  }
]

export const plugin = new PluginWindow()
  .setRootPage(ClustersPage)
  .withRoutes(routes)
