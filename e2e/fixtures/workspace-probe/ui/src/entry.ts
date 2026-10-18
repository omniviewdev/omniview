import { PluginWindow } from '@omniviewdev/runtime';
import { ProbePage } from './ProbePage';

export const plugin = new PluginWindow()
  .setRootPage(ProbePage)
  .withRoutes([{ path: '/', Component: ProbePage }]);
