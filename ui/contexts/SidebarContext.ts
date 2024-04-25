export type ResourceSidebarInjectableArea = {
  /** The id of the plugin */
  plugin: string;

  /** The resource identifier */
  resourceID: string;

  /** The currently selected (or default) component to render in */
  selected: {
    plugin: string;
    component: string;
  };

  /** The components available to render */
  available: Array<{
    plugin: string;
    component: string;
  }>;
};

