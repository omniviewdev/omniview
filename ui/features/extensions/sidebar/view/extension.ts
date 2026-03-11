import { type ResourceSidebarComponentProps } from '../types';
import { type ExtensionPointSettings } from '@omniviewdev/runtime';

export const store: ExtensionPointSettings<ResourceSidebarComponentProps> = {
  pluginId: 'core',
  id: 'omniview/resource/sidebar/infopanel',
  mode: 'single',
};

export default store;
