import { type ResourceSidebarComponentProps } from './types';
import { type CreateExtensionPointOptions } from '@omniviewdev/runtime';

const action: CreateExtensionPointOptions<ResourceSidebarComponentProps> = {
  owner: 'core',
  id: 'omniview/resource/sidebar/action',
  name: 'Resource Sidebar Action',
  description: 'Action item to display within the resource sidebar',
  mode: 'multiple',
};

const view: CreateExtensionPointOptions<ResourceSidebarComponentProps> = {
  owner: 'core',
  id: 'omniview/resource/sidebar/infopanel',
  name: 'Resource Sidebar Information Panel',
  description: 'Main infopanel for displaying a resource in the right sidebar.',
  mode: 'single',
};

const widget: CreateExtensionPointOptions<ResourceSidebarComponentProps> = {
  owner: 'core',
  id: 'omniview/resource/sidebar/widget',
  name: 'Resource Sidebar Widget',
  description: 'Widgets displayed for a resource in the right sidebar.',
  mode: 'multiple',
};

export default [action, view, widget];
