import type { PluginImportOpts } from '../core/types';
import { SystemJS } from '../api/systemjs';

/**
 * Production import adapter.
 *
 * Handles:
 * - Dev mode: Vite dev server with React Fast Refresh
 * - Production: SystemJS import with optional integrity hash
 *
 * This adapter satisfies `PluginServiceDeps.importPlugin`.
 */
export async function importPlugin(opts: PluginImportOpts): Promise<unknown> {
  const { pluginId, moduleHash, dev, devPort } = opts;

  // DEV MODE: native ESM import from Vite dev server
  if (dev && devPort) {
    const { ensureDevSharedDeps } = await import('./devSharedDeps');
    await ensureDevSharedDeps();

    const devBase = `http://127.0.0.1:${devPort}`;

    // Initialize React Fast Refresh preamble for the plugin's Vite dev server.
    try {
      const RefreshRuntime = await import(/* @vite-ignore */ `${devBase}/@react-refresh`);
      RefreshRuntime.default.injectIntoGlobalHook(window);
      (window as any).$RefreshReg$ = () => {};
      (window as any).$RefreshSig$ = () => (type: any) => type;
      (window as any).__vite_plugin_react_preamble_installed__ = true;
    } catch (e) {
      console.warn(`[PluginService] plugin "${pluginId}" — failed to init React Fast Refresh, HMR may not work`, { plugin: pluginId, error: String(e) });
    }

    const devUrl = `${devBase}/src/entry.ts`;
    try {
      const module = await import(/* @vite-ignore */ devUrl);
      return module;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Dev plugin "${pluginId}" failed to load from ${devUrl}: ${message}. ` +
        `Ensure the plugin dev server is running on port ${devPort}.`,
      );
    }
  }

  // PRODUCTION: SystemJS import
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

  return SystemJS.import(modulePath);
}
