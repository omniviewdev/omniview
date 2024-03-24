import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useMemo } from 'react';

/**
 * Options for customizing navigation behavior
 */
type PluginNavigateOptions = {
  /** Replace the current entry in the history stack */
  replace?: boolean;
  /**
   * Navigate within the current active context. If there is no active
   * context, it will be ignored.
   */
  withinContext?: boolean;
  /**
   * Navigate to a specific known context. For example, switching between
   * account authorization contexts within a cloud.
   */
  toContext?: string;
};

/**
 * Programatically route within a plugin
 */
function usePluginRouter() {
  const originalNavigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  // The URL structure should be /<plugin>/<contextID>/*
  const { contextID } = params;

  const contextLocation = location.pathname.split('/').slice(3).join('/');
  const pluginLocation = location.pathname.split('/').slice(2).join('/');

  /**
   * Programatically navigate to a path within the plugin, optionally
   * navigating within the current active context or to a specific known context.
   *
   * @param path The path to navigate to
   * @param opts Options for customizing navigation behavior
   * @param opts.replace Replace the current entry in the history stack
   * @param opts.withinContext Navigate within the current active context. If there is no active context, it will be ignored.
   * @param opts.toContext Navigate to a specific known context. For example, switching between account authorization contexts within a cloud.
   * @throws If both `withinContext` and `toContext` are provided together
   */
  const navigate = (path: string, opts?: PluginNavigateOptions) => {
    const { withinContext, toContext, ...rest } = opts || {};

    if (opts?.withinContext && Boolean(opts?.toContext)) {
      throw new Error('Cannot use both "withinContext" and "toContext" options together.');
    }

    const plugin = location.pathname.split('/')[1];
    if (!plugin) {
      // Protect ourselves just in case
      throw new Error('Plugin router used outside of a plugin');
    }

    let desired = `/${plugin}`;

    if (opts?.withinContext && Boolean(contextID)) {
      desired += `/${contextID}`;
    }

    if (opts?.toContext) {
      // Base64 encode the context to avoid any potential URL encoding issues
      desired += `/${btoa(opts.toContext)}`;
    }

    // Account for possible leading slashes
    originalNavigate(`${desired}${path.startsWith('/') ? '' : '/'}${path}`, rest);
  };

  return useMemo(() => ({
    location: contextID ? `/${contextLocation}` : `/${pluginLocation}`,
    contextID: atob(contextID || ''),
    navigate,
  }), [contextID, location.pathname]);
}

export default usePluginRouter;
