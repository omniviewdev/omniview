import { type ResourceSidebarComponentProps } from '../types';
import { type CreateExtensionPointOptions } from '@omniviewdev/runtime/types/extensions';

export const store: CreateExtensionPointOptions<ResourceSidebarComponentProps> = {
  owner: 'core',
  id: 'omniview/resource/sidebar/infopanel',
  name: 'Resource Sidebar Information Panel',
  description: 'Main infopanel for displaying a resource in the right sidebar.',
  mode: 'single',
};

export default store;
