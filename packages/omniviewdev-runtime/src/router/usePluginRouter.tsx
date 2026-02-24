import { useNavigate, useLocation } from 'react-router-dom';
import { useMemo } from 'react';
import { usePluginContext } from '../context';

/**
 * Options for customizing navigation behavior
 */
type PluginNavigateOptions = {
  /** Replace the current entry in the history stack */
  replace?: boolean;
};

/**
 * Programatically route within a plugin.
 *
 * Navigation behavior:
 * - Absolute paths (starting with `/`) are resolved relative to the plugin root.
 *   e.g. `navigate('/cluster/abc')` → `/_plugin/{pluginId}/cluster/abc`
 * - Relative paths (no leading `/`) use react-router's native relative resolution,
 *   navigating relative to the current matched route.
 *   e.g. `navigate('metrics')` → sibling route `metrics`
 *   e.g. `navigate('.')` → current route (index)
 *   e.g. `navigate('..')` → parent route
 *
 * @example
 * ```
 * import { usePluginRouter } from '@omniviewdev/runtime';
 *
 * export const MyComponent = () => {
 *    const { navigate, pluginPath } = usePluginRouter();
 *
 *    // Absolute plugin-relative navigation
 *    navigate('/cluster/abc/resources');
 *
 *    // Relative navigation (to sibling route)
 *    navigate('metrics');
 * }
 * ```
 */
function usePluginRouter() {
  const originalNavigate = useNavigate();
  const location = useLocation();
  const { meta } = usePluginContext()

  if (!meta.id) {
    console.error('usePluginRouter used outside of a plugin context');
  }

  const pluginPrefix = `/_plugin/${meta.id}`;

  /**
   * The current pathname relative to the plugin root, with the
   * `/_plugin/{pluginId}` prefix stripped.
   *
   * e.g. if the browser URL is `/_plugin/kubernetes/cluster/abc/resources`,
   * pluginPath is `/cluster/abc/resources`.
   */
  const pluginPath = location.pathname.startsWith(pluginPrefix)
    ? location.pathname.slice(pluginPrefix.length) || '/'
    : location.pathname;

  /**
   * Navigate within the plugin.
   *
   * @param path - Absolute paths (starting with `/`) are resolved relative to
   *   the plugin root. Relative paths use react-router's native relative
   *   resolution (relative to the current matched route).
   * @param opts - Navigation options
   */
  const navigate = (path: string, opts?: PluginNavigateOptions) => {
    const { ...rest } = opts ?? {};

    if (path.startsWith('/')) {
      // Absolute plugin-relative path
      originalNavigate(`${pluginPrefix}${path}`, rest);
    } else {
      // Relative path — delegate to react-router's native relative navigation
      originalNavigate(path, rest);
    }
  };

  return useMemo(() => ({
    location,
    navigate,
    pluginPath,
  }), [location.pathname]);
}

export default usePluginRouter;
