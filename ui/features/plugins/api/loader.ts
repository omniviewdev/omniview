import builtInPlugins from './builtins';
import { PluginWindow } from '@omniviewdev/runtime';
import { shared } from './shared_dependencies';
import { buildImportMap } from './utils';
import { EXTENSION_REGISTRY } from '../../extensions/store';
import { registerPlugin } from '../PluginManager';

type PluginImportInfo = {
  pluginId: string;
  moduleHash?: string;
  dev?: boolean;
  devPort?: 15173
}

/**
 * Get's the calculated module ID for the plugin
 */
const getModuleId = ({ pluginId }: PluginImportInfo): string => {
  return `${window.location.protocol}//${window.location.host}/_/plugins/${pluginId}/assets/entry.js`
}

/**
 * Add the shared dependencies that don't get bundled into plugins
 */
const imports = buildImportMap(shared);
System.addImportMap({ imports });

// const PLUGIN_WINDOW_CACHE: Record<string, PluginWindow> = {};

export async function clearPlugin({ pluginId }: PluginImportInfo) {
  /** remove the import */
  System.delete(getModuleId({ pluginId }));
}

/**
 * Performs the necessary work of importing the plugin, registering to the cache,
 * and then returning the plugin module so that it can be used within the main
 * plugin renderer.
 *
 * This relies on the Wails asset server to properly route the requests for the entrypoint and
 * it's built dependencies to the proper location on the filesystem, as defined here:
 *
 * @see {@link file://fileloader.go}
 */
export async function importPlugin({ pluginId, moduleHash }: PluginImportInfo): Promise<System.Module> {

  // Check if the plugin is a built-in plugin
  const builtInPlugin = builtInPlugins[pluginId];
  if (builtInPlugin) {
    return typeof builtInPlugin === 'function' ? await builtInPlugin() : builtInPlugin;
  }

  // // calculate the plugins expected entrypoint file
  // const modulePath = `/plugin/${pluginId}/dist/entry.js`;

  const modulePath = `${window.location.protocol}//${window.location.host}/_/plugins/${pluginId}/assets/entry.js`
  // const modulePath = `http://localhost:15173/plugin-entry`

  // inject integrity hash into SystemJS import map
  const resolvedModule = System.resolve(modulePath);
  const integrityMap = System.getImportMap().integrity;

  if (moduleHash && integrityMap && !integrityMap[resolvedModule]) {
    System.addImportMap({
      integrity: {
        [resolvedModule]: moduleHash,
      },
    });
  }

  // load the plugin
  return System.import(modulePath)
}

// TODO: we'll need to see what other info to grab for this, most notable we'll likely need to use
// metadata about the plugin here, but for now it's not needed.
type PluginWindowImportInfo = PluginImportInfo & {}

/**
 * Imports the plugin window component so that it may be shown within the plugin renderer.
 *
 * NOTE: this does not interact with the cache. The cache will be externalized to a separate wrapper. Reaching
 * this function assumes that the cache has not been hit.
 */
export async function importPluginWindow(opts: PluginWindowImportInfo): Promise<PluginWindow> {
  const exports = await importPlugin(opts);

  // ensure we at least have a base plugin window (like for example, when we don't actually have one
  // and the plugin is just exporting components as a safegaurd)
  const { plugin = new PluginWindow() } = exports as { plugin?: PluginWindow };

  // register any extension points that the plugin has
  for (const extension of plugin.extensions) {
    EXTENSION_REGISTRY.addExtensionPoint(extension);
  }

  return plugin
}

export async function loadAndRegisterPlugin(pluginID: string): Promise<void> {
  const pluginWindow = await importPluginWindow({ pluginId: pluginID });
  registerPlugin(pluginID, pluginWindow);
}
