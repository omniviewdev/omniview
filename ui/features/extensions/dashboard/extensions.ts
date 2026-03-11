import { type ExtensionPointSettings } from '@omniviewdev/runtime';
import { type DashboardWidgetProps, type DashboardTabProps } from './types';

const widget: ExtensionPointSettings<DashboardWidgetProps> = {
  pluginId: 'core',
  id: 'omniview/dashboard/widget',
  mode: 'multiple',
};

const tab: ExtensionPointSettings<DashboardTabProps> = {
  pluginId: 'core',
  id: 'omniview/dashboard/tab',
  mode: 'multiple',
};

export default [widget, tab];
