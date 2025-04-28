/// <reference types="@welldone-software/why-did-you-render" />
import { PluginWindow } from '@omniviewdev/runtime';
import { Outlet, RouteObject } from 'react-router-dom';

import ClustersPage from './pages/ClustersPage';
import ClusterEditPage from './pages/ClusterEditPage';
import ClusterResourcesPage from './pages/ClusterResourcesPage';
import PodTable from './components/kubernetes/table/corev1/Pod/Table';
import NodeTable from './components/kubernetes/table/corev1/Node/Table';
import DefaultTable from './components/kubernetes/table/default/Table';

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
        children: [
          {
            index: true,
            Component: Outlet
          },
          {
            path: 'core_v1_Pod',
            Component: PodTable
          },
          {
            path: 'core_v1_Node',
            Component: NodeTable
          },
          // TODO: This is causing a massive performance issue for some reason when switching
          // between routes that match
          {
            path: ':resourceKey',
            Component: DefaultTable
          }
        ]
      }
    ]
  }
]

export const plugin = new PluginWindow()
  .setRootPage(ClustersPage)
  .withRoutes(routes)
