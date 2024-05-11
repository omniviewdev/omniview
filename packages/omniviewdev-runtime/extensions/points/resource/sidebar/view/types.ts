import type React from 'react';

/**
 * A resource parts object for matching a resource key.
 */
type ResourceParts = {
  /** The group the resource belongs to */
  group: string | string[];
  /** The version of the resource */
  version: string | string[];
  /** The kind of the resource */
  kind: string | string[];
};

/**
* Add a new view to the resource sidebar.
*/
export type ResourceSidebarView = {
  /** 
  * The plugin that owns the view 
  */
  plugin: string;

  /** 
  * The ID of the view 
  */
  id: string;

  /** 
  * The title of the view 
  */
  title: string;

  /**
  * The description of the view
  */
  description?: string;

  /** 
  * The icon of the view 
  */
  icon: React.ReactNode;

  /** 
  * The component to render 
  */
  component: React.Component<ResourceSidebarViewProps>;

  /** 
  * The resources this view should be displayed for. Accepts a list of 
  * plugin/key pairs. The key can be one of the following:
  *
  * - A string literal. Will match exactly.
  *   Example: { plugin: 'my-plugin', key: 'core::v1::SomeResource' }
  *
  * - A regular expression. Will match any string that matches the regex.
  *   Example: { plugin: 'my-plugin', key: /core::v1::.'*'/ }
  *
  * - A wildcard character. Will match all resources for the plugin.
  *   Example: { plugin: 'my-plugin', key: '*' }
  *
  * - An array of strings. Will match any string that is included in the array.
  *   Example: { plugin: 'my-plugin', key: ['core::v1::SomeResource', 'core::v1::AnotherResource'] }
  *
  * - A resource parts object. Will match resources based on the group, version, and kind.
  *   Each part can accept a string to match, an array of strings, or a literal wildcard character.
  *   Example: { plugin: 'my-plugin', key: { group: 'core', version: 'v1', kind: 'SomeResource' } }
  *   Example: { plugin: 'my-plugin', key: { group: 'core', version: ['v1', 'v2'], kind: '*' } }
  */
  matcher: { plugin: string; key: string | RegExp | string[] | ResourceParts };
};

/**
* The props passed to the resource sidebar view component.
*/
export type ResourceSidebarViewProps = {
  resource: {
    /** The ID of the resource passed in */
    id: string;
    /** The plugin that owns the resource type */
    plugin: string;
    /** The key identifying the kind of the resource */
    key: string;
    /** The object representation of the data */
    data: Record<string, unknown>;
  };
};



