import React, { ComponentType } from "react";
import { ExtensionPointSettings } from "./extensions";
import { RouteObject, RouterProvider, createMemoryRouter } from "react-router-dom";

/** TODO: Add whatever props we need here */
export class PluginWindowRootProps { }

/**
 * Plugin container is the main type that is rendered for a visual component within the
 * user interface.
 */
export class PluginWindow {
  _extensions?: Array<ExtensionPointSettings>

  /**
   * The root component to render for the application window.
   */
  root?: ComponentType;

  /**
   * Various pages to render under the root component. These can be navigated to using
   * the built-in navigation system both programatically and through Links.
   *
   * @example
   * Programatically:
   * ```
   * import { usePluginNavigation } from '@omniviewdev/runtime';
   * const MyComponent = () => {
   *  const { navigate } = usePluginNavigation();
   *
   *  const goToPage = () => {
   *      navigate('some-page')
   *  }
   *
   * }
   * ```
   *
   * Using Links:
   * ```
   * import { Link } from '@omniviewdev/runtime';
   * const MyComponent = () => {
   *  return (
   *    <Link to="some-page">
   *  )
   * }
   * ```
   * 
   */
  pages?: Record<string, ComponentType>;

  _routes?: Array<RouteObject>;

  get extensions() {
    return this._extensions || [];
  }

  /**
   * Get's the route provider component to render within the plugin view
   */
  get Window(): React.ReactNode {
    if (!this._routes && !!this.root) {
      return <this.root />;
    }

    /** Create our scoped browser router */
    const router = createMemoryRouter(this._routes || [])
    return <RouterProvider router={router} />
  }


  /**
   * Register extension points for other plugins to extend the functionality
   * of the plugin. All extension points registered will be name as such:
   *
   * `${plugin_id}/${extension_point_id}`
   */
  registerExtensionPoints(points: Array<ExtensionPointSettings>) {
    this._extensions = points || [];
    return this
  }

  /**
   * Set the component displayed under:
   *   /_plugin/${plugin_id}/*
   *
   * If the NavModel is configured, the page will have a managed frame, otheriwse it has full control.
   */
  setRootPage(root: ComponentType<PluginWindowRootProps>) {
    this.root = root;
    return this;
  }

  /**
   * Adds a page to the plugin window. This page will be displayed under:
   */
  withPage(page: string, component: ComponentType) {
    if (!this.pages) {
      this.pages = {};
    }

    if (this.pages[page]) {
      console.warn(
        'Cannot register page with the same name. Please use a different name.',
      )
      return this
    }

    this.pages[page] = component;
    return this;
  }

  withRoutes(routes: Array<RouteObject>) {
    this._routes = routes
    return this
  }

}
