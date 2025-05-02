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
  component: (data?: T) => ReactNode
}

/**
 * An action that can be run
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
   * The function to run for the drawer component on click.
   *
   * When a plugin is extending with an action, the component may choose to
   * pass data about what is inside the component. This is typically the case
   * with drawers that display resource information.
   */
  action: (data?: T) => void
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
