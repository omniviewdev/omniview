import { type CreateExtensionPointOptions } from '@omniviewdev/runtime';
import { type DashboardWidgetProps, type DashboardTabProps } from './types';

const widget: CreateExtensionPointOptions<DashboardWidgetProps> = {
  owner: 'core',
  id: 'omniview/dashboard/widget',
  name: 'Dashboard Widget',
  description: 'Widget displayed on the cluster overview dashboard.',
  mode: 'multiple',
};

const tab: CreateExtensionPointOptions<DashboardTabProps> = {
  owner: 'core',
  id: 'omniview/dashboard/tab',
  name: 'Dashboard Tab',
  description: 'Additional tab page on the cluster dashboard.',
  mode: 'multiple',
};

export default [widget, tab];
