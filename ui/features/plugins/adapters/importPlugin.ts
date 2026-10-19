import type { PluginImportOpts } from '../core/types';
import { systemJs } from '../api/systemjs';
import { ensureDevSharedDeps } from './devSharedDeps';

type DevRefreshSubscription = { stop?: () => void };
const devRefreshSubscriptions = new Map<string, DevRefreshSubscription>();

/** Retire the exact native-import refresh subscription, including pending setup. */
export function clearDevPluginRefresh(pluginId: string): void {
  const subscription = devRefreshSubscriptions.get(pluginId);
  devRefreshSubscriptions.delete(pluginId);
  subscription?.stop?.();
}

/**
 * Production import adapter.
 *
 * Handles:
 * - Dev source: Vite Fast Refresh with a development renderer; automatic reload otherwise
 * - Production: SystemJS import with optional integrity hash
 *
 * This adapter satisfies `PluginServiceDeps.importPlugin`.
 */
export async function importPlugin(opts: PluginImportOpts): Promise<unknown> {
  const { pluginId, moduleHash, dev, devPort } = opts;

  // DEV MODE: native ESM import from Vite dev server
  if (dev && devPort) {
    const refresh: DevRefreshSubscription | undefined = import.meta.env.DEV ? undefined : {};
    if (refresh) {
      clearDevPluginRefresh(pluginId);
      devRefreshSubscriptions.set(pluginId, refresh);
    }

    const devBase = `http://127.0.0.1:${devPort}`;
    const devUrl = `${devBase}/src/entry.ts`;
    try {
      await ensureDevSharedDeps();

      // Production React DOM has no Fast Refresh renderer hooks. Keep native
      // singleton imports, but reload automatically for JS updates in that mode.
      if (refresh) {
        // Each managed plugin's runtime-selected origin owns a separate Vite client.
        const { createHotContext } = await import(/* @vite-ignore */ `${devBase}/@vite/client`);
        if (devRefreshSubscriptions.get(pluginId) === refresh) {
          const hot = createHotContext('/@omniview/host-refresh');
          const reload = (payload: { updates: Array<{ type: string }> }) => {
            if (payload.updates.some(update => update.type === 'js-update')) {
              window.location.reload();
            }
          };

          hot.on('vite:beforeUpdate', reload);
          refresh.stop = () => hot.off('vite:beforeUpdate', reload);
        }
      }

      // Transformed plugin modules still require the real React refresh preamble.
      try {
        const RefreshRuntime = await import(/* @vite-ignore */ `${devBase}/@react-refresh`);
        RefreshRuntime.default.injectIntoGlobalHook(window);
        (window as any).$RefreshReg$ = () => undefined;
        (window as any).$RefreshSig$ = () => (type: any) => type;
        (window as any).__vite_plugin_react_preamble_installed__ = true;
      } catch (e) {
        console.warn(`[PluginService] plugin "${pluginId}" — failed to init React Fast Refresh, HMR may not work`, { plugin: pluginId, error: String(e) });
      }

      return await import(/* @vite-ignore */ devUrl);
    } catch (err) {
      if (refresh && devRefreshSubscriptions.get(pluginId) === refresh) {
        clearDevPluginRefresh(pluginId);
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Dev plugin "${pluginId}" failed to load from ${devUrl}: ${message}. ` +
        `Ensure the plugin dev server is running on port ${devPort}.`,
      );
    }
  }

  // PRODUCTION: SystemJS import
  const modulePath = `${window.location.protocol}//${window.location.host}/_/plugins/${pluginId}/assets/entry.js`;

  const resolvedModule = systemJs.resolve(modulePath);
  const integrityMap = systemJs.getImportMap().integrity;

  if (moduleHash && integrityMap && !integrityMap[resolvedModule]) {
    systemJs.addImportMap({
      integrity: {
        [resolvedModule]: moduleHash,
      },
    });
  }

  return systemJs.import(modulePath);
}
