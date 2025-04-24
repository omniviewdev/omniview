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
 *
 * @example
 * ```
 * import { usePluginRouter } from '@omniviewdev/runtime/router';
 *
 * export const MyComponent = () => {
 *    const { navigate } = usePluginRouter();
 *
 *    const handleClick = () => {
 *       void navigate('/my-path', { withinContext: true });
 *     }
 *
 * }
 * ```
 */
function usePluginRouter() {
  const originalNavigate = useNavigate();
  const location = useLocation();
  const { pluginId, connectionID } = useParams<{ pluginId: string; connectionID: string }>();

  if (!pluginId) {
    console.error('Link used outside of a plugin context');
  }

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
    const { withinContext, toContext, ...rest } = opts ?? {};

    const resolvedTo = Boolean(withinContext) && pluginId
      ? `/_plugin/${pluginId}/connection/${connectionID}${path.startsWith('/') ? '' : '/'}${path}`
      : `/_plugin/${pluginId}${path.startsWith('/') ? '' : '/'}${path}`;

    if (opts?.withinContext && Boolean(opts?.toContext)) {
      throw new Error('Cannot use both "withinContext" and "toContext" options together.');
    }

    // Account for possible leading slashes
    originalNavigate(resolvedTo, rest);
  };

  return useMemo(() => ({
    location,
    contextID: connectionID ?? '',
    navigate,
  }), [connectionID, location.pathname]);
}

export default usePluginRouter;
