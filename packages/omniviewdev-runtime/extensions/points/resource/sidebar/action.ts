import { type ResourceSidebarComponentProps } from './types';
import { type CreateExtensionRegistryOptions } from '@omniviewdev/runtime/extensions/store';

export const store: CreateExtensionRegistryOptions<ResourceSidebarComponentProps> = {
  owner: 'core',
  id: 'omniview/resource/sidebar/action',
  name: 'Resource Sidebar Action',
  description: 'Action item to display within the resource sidebar',
  mode: 'multiple',
};

export default store;
