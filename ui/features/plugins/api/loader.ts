import builtInPlugins from './builtins';
import { PluginWindow } from '@omniviewdev/runtime';
import { EXTENSION_REGISTRY } from '../../extensions/store';
import { registerPlugin } from '../PluginManager';
import { SystemJS } from './systemjs';
import { EventsEmit } from '@omniviewdev/runtime/runtime';
import { devSharedReady } from './devSharedReady';

type PluginImportInfo = {
  pluginId: string;
  moduleHash?: string;
  dev?: boolean;
  devPort?: number;
}

/**
 * Get's the calculated module ID for the plugin (SystemJS path)
 */
const getModuleId = ({ pluginId }: PluginImportInfo): string => {
  return `${window.location.protocol}//${window.location.host}/_/plugins/${pluginId}/assets/entry.js`;
};

export async function clearPlugin({ pluginId, dev }: PluginImportInfo) {
  if (dev) {
    // Dev-mode modules loaded via native ESM; nothing to clear from SystemJS.
    // Vite HMR handles UI updates. For Go changes, caller re-imports via importPluginWindow.
    return;
  }
  await SystemJS.delete(getModuleId({ pluginId }));
}

/**
 * Imports a plugin module. In dev mode, uses native ESM import from the Vite
 * dev server. In production, uses SystemJS import from the Wails asset server.
 *
 * Dev mode enables:
 * - Vite HMR via WebSocket (injected by @vite/client into every module)
 * - React Fast Refresh for sub-100ms, state-preserving updates
 * - No SystemJS involvement for the plugin's module graph
 *
 * @see {@link file://fileloader.go} for the production asset serving path
 */
export async function importPlugin({ pluginId, moduleHash, dev, devPort }: PluginImportInfo): Promise<System.Module> {
  // Built-in plugins (unchanged)
  const builtInPlugin = builtInPlugins[pluginId];
  if (builtInPlugin) {
    return typeof builtInPlugin === 'function' ? await builtInPlugin() : builtInPlugin;
  }

  // DEV MODE: native ESM import from Vite dev server
  if (dev && devPort) {
    // Ensure shared deps are available on window before loading dev plugin
    await devSharedReady;

    const devUrl = `http://127.0.0.1:${devPort}/src/entry.ts`;
    try {
      console.log(`[plugin:${pluginId}] Loading from dev server: ${devUrl}`);
      const module = await import(/* @vite-ignore */ devUrl);
      return module;
    } catch (err) {
      console.error(`[plugin:${pluginId}] Dev server import failed, falling back to static`, err);
      // Fall through to SystemJS path
    }
  }

  // PRODUCTION: SystemJS import (existing code)
  const modulePath = `${window.location.protocol}//${window.location.host}/_/plugins/${pluginId}/assets/entry.js`;

  const resolvedModule = SystemJS.resolve(modulePath);
  const integrityMap = SystemJS.getImportMap().integrity;

  if (moduleHash && integrityMap && !integrityMap[resolvedModule]) {
    SystemJS.addImportMap({
      integrity: {
        [resolvedModule]: moduleHash,
      },
    });
  }

  console.log(`[plugin:${pluginId}] Loading from SystemJS: ${modulePath}`);
  return SystemJS.import(modulePath);
}

type PluginWindowImportInfo = PluginImportInfo & {}

/**
 * Imports the plugin window component so that it may be shown within the plugin renderer.
 */
export async function importPluginWindow(opts: PluginWindowImportInfo): Promise<PluginWindow> {
  const exports = await importPlugin(opts);

  const { plugin = new PluginWindow() } = exports as { plugin?: PluginWindow };

  // register any extension points
  for (const extension of plugin.extensions) {
    EXTENSION_REGISTRY.addExtensionPoint(extension);
  }

  return plugin;
}

export async function loadAndRegisterPlugin(
  pluginID: string,
  opts?: { dev?: boolean; devPort?: number }
): Promise<void> {
  const pluginWindow = await importPluginWindow({
    pluginId: pluginID,
    dev: opts?.dev,
    devPort: opts?.devPort,
  });
  registerPlugin(pluginID, pluginWindow);
  EventsEmit('core/window/recalc_routes');
}
