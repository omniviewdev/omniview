import { type ResourceSidebarComponentProps } from './types';
import { type CreateExtensionRegistryOptions } from '@omniviewdev/runtime/extensions/store';

export const store: CreateExtensionRegistryOptions<ResourceSidebarComponentProps> = {
  owner: 'core',
  id: 'omniview/resource/sidebar/infopanel',
  name: 'Resource Sidebar Information Panel',
  description: 'Main infopanel for displaying a resource in the right sidebar.',
  mode: 'single',
};

export default store;
