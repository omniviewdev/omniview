import { ReactNode } from "react";

export type DrawerComponent<T = any> = {
  /**
   * The title to display in the drawer header
   */
  title: string | ReactNode

  /**
   * The icon to display in the drawer header to the left of the the title
   */
  icon?: ReactNode

  /**
   * The various views to display within the drawer. This should be used to 
   * allow other plugins to extend the current functionality.
   *
   * There must be at least one view within the drawer.
   */
  views: Array<DrawerComponentView<T>>

  /**
   * Functions that can be triggered upon clicking the component. These items
   * do not change what is in the viewport of the drawer, but instead trigger
   * other actions (such as starting a terminal session, modifying a resource,
   * etc.)
   *
   * There must be at least one action within the drawer.
   */
  actions: Array<DrawerComponentAction<T>>
};

export type DrawerComponentView<T = any> = {
  /**
   * The title to display for the drawer header tooltip
   */
  title: string | ReactNode

  /**
   * The icon to display in the drawer's pages section
   */
  icon?: ReactNode

  /**
   * The component to display in the viewport upon click.
   *
   * When a plugin is extending with a page, the component may choose to
   * pass data about what is inside the component. This is typically the case
   * with drawers that display resource information.
   */
  component: (ctx: DrawerContext<T>) => ReactNode
}

/**
 * An action that can be run on a resource. 
 */
export type DrawerComponentAction<T = any> = {
  /**
   * The title to display for the drawer header tooltip
   */
  title: string | ReactNode

  /**
   * The icon to display in the drawer header to the left of the the title
   */
  icon?: ReactNode

  /**
   * Determines whether the action should be shown. This is useful when the action
   * is only applicable if the resource has certain parameters, should only be
   * done for certain connections, or should be available only for certain resource
   * types.
   */
  enabled?: ((ctx: DrawerContext<T>) => boolean) | boolean

  /**
   * The function to run for the drawer component on click.
   *
   * When a plugin is extending with an action, the component may choose to
   * pass data about what is inside the component. This is typically the case
   * with drawers that display resource information.
   */
  action?: (ctx: DrawerContext<T>) => void

  /**
   * Have the action provide a list of actions underneath when clicked rather than
   * initiation the action directly on click.
   */
  list?: ((ctx: DrawerContext<T>) => Array<DrawerComponentActionListItem>) | Array<DrawerComponentActionListItem>
}

/**
 * Displays a list item under the action
 */
export type DrawerComponentActionListItem<T = any> = {
  /**
   * The title to display for the drawer header tooltip
   */
  title: string | ReactNode

  /**
   * The icon to display in list item to the left of the the name
   */
  icon?: ReactNode

  /**
   * The function to run for the action list item on click.
   *
   * When a plugin is extending with an action, the component may choose to
   * pass data about what is inside the component. This is typically the case
   * with drawers that display resource information.
   */
  action: (ctx: DrawerContext<T>) => void
}

/**
 * Context that can be passed to the drawer instantiation
 */
export type DrawerContext<T = any> = {
  /**
   * Generic data supplied to the drawer. For resource displays, this should be
   * the generic object data for the resource in question.
   */
  data?: T;

  /**
   * Resource information (if this drawer is being displayed as part of a resource)
   */
  resource?: {
    /**
     * The id of the resource in question
     */
    id: string;

    /**
     * The resource key that defines the globally-recognizable key
     */
    key: string;

    /**
    * A connection id, if this drawer is displaying something in the context
    * of a connection.
    */
    connectionID: string;
  }
}


// action types
export type BottomDrawerTab = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  icon?: string | React.ReactNode;
  variant: 'terminal' | 'logs' | 'editor' | 'browser' | 'file' | 'other';
  properties?: Record<string, unknown>;
};

export type FindTabOpts = {
  /** ID of the tab to focus, if known */
  id?: string;

  /** Index of the tab, if known. If provided, it will be prioritized over all other options */
  index?: number;

  /** Properties to match against */
  properties?: Record<string, unknown>;

  /** 
   * Customize the behavior when multiple tabs match the properties. The options are:
   *  - 'first': Perform on the first matching tab.
   *  - 'newest': Perform the most recently created tab.
   *  - 'oldest': Perform the oldest tab
   *  - 'none': Do nothing
   */
  actionOnMultiple?: 'first' | 'newest' | 'oldest' | 'none';
};

export type CreateTabOpts = Pick<BottomDrawerTab, 'title' | 'icon' | 'variant' | 'properties'> & {
  id?: string;
};

/**
 * Create a new tab in the bottom drawer.
 */
export type CreateTab = (opts: CreateTabOpts) => void;

/**
 * Create multiple tabs in the bottom drawer.
 */
export type CreateTabs = (opts: CreateTabOpts[]) => void;

/**
* Focus on a tab in the bottom drawer. If multiple tabs match the search criteria, the 'newest' tab will be focused.
*/
export type FocusTab = (opts: FindTabOpts) => void;

/**
 * Reorder a tab in the bottom drawer, given the 'from' and 'to' indexes.
 */
export type ReorderTab = (from: number, to: number) => void;

/**
 * Close a tab in the bottom drawer. If multiple tabs match the search criteria, no tabs will be closed.
 */
export type CloseTab = (opts: FindTabOpts) => void;

/**
* Close multiple tabs in the bottom drawer.
*/
export type CloseTabs = (opts: FindTabOpts[]) => void;

/**
 * Resize the height of the bottom drawer programatically, in pixels.
 */
export type ResizeDrawer = (height: number) => void;

/**
 * Expand the bottom drawer to take up the full height of view.
 */
export type FullscreenDrawer = () => void;

/**
 * Collapse the bottom drawer to its default height.
 */
export type CloseDrawer = () => void;
