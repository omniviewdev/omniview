import { type ResourceSidebarComponentProps } from './types';
import { type ExtensionPointSettings } from '@omniviewdev/runtime';

const action: ExtensionPointSettings<ResourceSidebarComponentProps> = {
  pluginId: 'core',
  id: 'omniview/resource/sidebar/action',
  mode: 'multiple',
};

const view: ExtensionPointSettings<ResourceSidebarComponentProps> = {
  pluginId: 'core',
  id: 'omniview/resource/sidebar/infopanel',
  mode: 'single',
};

const widget: ExtensionPointSettings<ResourceSidebarComponentProps> = {
  pluginId: 'core',
  id: 'omniview/resource/sidebar/widget',
  mode: 'multiple',
};

export default [action, view, widget];
