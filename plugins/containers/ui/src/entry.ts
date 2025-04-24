import { PluginWindow } from '@omniviewdev/runtime';
import RootLayout from './pages/RootLayout';
import { RouteObject } from 'react-router-dom';
import RootPage from './pages/RootPage';
import ScanPage from './pages/ScanPage';

const routes: Array<RouteObject> = [
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: RootPage },
      { path: 'scan', Component: ScanPage }
    ]
  }
]

export const plugin = new PluginWindow()
  .setRootPage(RootLayout)
  .withRoutes(routes)
