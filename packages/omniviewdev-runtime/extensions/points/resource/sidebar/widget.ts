import { type ResourceSidebarComponentProps } from './types';
import { type CreateExtensionRegistryOptions } from '@omniviewdev/runtime/extensions/store';

export const store: CreateExtensionRegistryOptions<ResourceSidebarComponentProps> = {
  owner: 'core',
  id: 'omniview/resource/sidebar/widget',
  name: 'Resource Sidebar Widget',
  description: 'Widgets displayed for a resource in the right sidebar.',
  mode: 'multiple',
};

export default store;
