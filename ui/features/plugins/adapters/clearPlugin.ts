import { systemJs } from '../api/systemjs';
import { clearDevPluginRefresh } from './importPlugin';

/**
 * Production clear adapter.
 *
 * - Dev mode: disposes native-import refresh ownership (Vite owns module updates)
 * - Production: removes module from SystemJS cache
 *
 * This adapter satisfies `PluginServiceDeps.clearPlugin`.
 */
export async function clearPlugin(opts: {
  pluginId: string;
  dev?: boolean;
}): Promise<void> {
  clearDevPluginRefresh(opts.pluginId);
  if (opts.dev) {
    // Dev-mode modules loaded via native ESM; nothing to clear from SystemJS.
    return;
  }

  const modulePath = `${window.location.protocol}//${window.location.host}/_/plugins/${opts.pluginId}/assets/entry.js`;
  systemJs.delete(modulePath);
}
