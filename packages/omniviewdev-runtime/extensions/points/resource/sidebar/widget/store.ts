import { type CreateExtensionRegistryOptions } from '@omniviewdev/runtime/extensions/store';

export const resourceSidebarWidgetStore: CreateExtensionRegistryOptions<any> = {
  id: 'omniview/resource/sidebar/widget',
  name: 'Resource Sidebar Widget',
  description: 'Widgets displayed for a resource in the right sidebar.',
  mode: 'multiple',
};

export default resourceSidebarWidgetStore;

