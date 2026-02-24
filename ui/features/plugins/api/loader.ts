import React from 'react';
import builtInPlugins from './builtins';
import { PluginWindow, DrawerContext, DrawerFactory } from '@omniviewdev/runtime';
import { EXTENSION_REGISTRY } from '../../extensions/store';
import { registerPlugin, registerPluginSidebars, registerPluginDrawers } from '../PluginManager';
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

    const devBase = `http://127.0.0.1:${devPort}`;

    // Initialize React Fast Refresh for the plugin's Vite dev server.
    // @vitejs/plugin-react normally does this via an index.html preamble,
    // but plugins are loaded via import(), not HTML. Without this, the
    // plugin's RefreshRuntime has no renderer reference and HMR updates
    // are detected but never applied (performReactRefresh is a no-op).
    try {
      const { injectIntoGlobalHook } = await import(/* @vite-ignore */ `${devBase}/@react-refresh`);
      injectIntoGlobalHook(window);
    } catch (e) {
      console.warn(`[loader] plugin "${pluginId}" — failed to init React Fast Refresh, HMR may not work`, { plugin: pluginId, error: String(e) });
    }

    const devUrl = `${devBase}/src/entry.ts`;
    try {
      console.debug(`[loader] plugin "${pluginId}" — loading from dev server`, { plugin: pluginId, devUrl });
      const module = await import(/* @vite-ignore */ devUrl);
      return module;
    } catch (err) {
      // Dev plugins have no SystemJS bundle — falling back would always fail
      // with a more confusing error. Throw immediately with actionable context.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[loader] Dev plugin "${pluginId}" failed to load from ${devUrl}: ${message}. ` +
        `Ensure the plugin dev server is running on port ${devPort}.`
      );
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

  console.debug(`[loader] plugin "${pluginId}" — loading from SystemJS`, { plugin: pluginId, modulePath });
  return SystemJS.import(modulePath);
}

type PluginWindowImportInfo = PluginImportInfo & {}

/**
 * Extracts a PluginWindow from raw module exports and registers extension points.
 */
function extractPluginWindow(exports: System.Module): PluginWindow {
  const { plugin = new PluginWindow() } = exports as { plugin?: PluginWindow };

  console.debug('[loader] extractPluginWindow', {
    hasPlugin: !!exports.plugin,
    extensionCount: plugin.extensions?.length ?? 0,
    hasRoutes: !!plugin.Routes,
    routeCount: plugin.Routes?.length ?? 0,
    exportKeys: Object.keys(exports),
  });

  // register any extension points
  for (const extension of plugin.extensions) {
    EXTENSION_REGISTRY.addExtensionPoint(extension);
  }

  return plugin;
}

/**
 * Imports the plugin window component so that it may be shown within the plugin renderer.
 */
export async function importPluginWindow(opts: PluginWindowImportInfo): Promise<PluginWindow> {
  const exports = await importPlugin(opts);
  return extractPluginWindow(exports);
}

export async function loadAndRegisterPlugin(
  pluginID: string,
  opts?: { dev?: boolean; devPort?: number }
): Promise<void> {
  console.debug(`[loader] loadAndRegisterPlugin "${pluginID}"`, { plugin: pluginID, dev: opts?.dev, devPort: opts?.devPort });

  const importOpts = { pluginId: pluginID, dev: opts?.dev, devPort: opts?.devPort };

  // Import the raw module so we can extract both PluginWindow and sidebars
  const exports = await importPlugin(importOpts);
  const pluginWindow = extractPluginWindow(exports);
  registerPlugin(pluginID, pluginWindow);

  // Register sidebar components if the plugin exports them
  const { sidebars } = exports as { sidebars?: Record<string, React.FC<{ ctx: DrawerContext }>> };
  if (sidebars) {
    registerPluginSidebars(pluginID, sidebars);
  }

  // Register drawer factories if the plugin exports them
  const { drawers } = exports as { drawers?: Record<string, DrawerFactory> };
  if (drawers) {
    registerPluginDrawers(pluginID, drawers);
  }

  console.debug(`[loader] loadAndRegisterPlugin "${pluginID}" complete — emitting recalc_routes`, { plugin: pluginID });
  EventsEmit('core/window/recalc_routes');
}
