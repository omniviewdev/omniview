import { SystemJS } from '../api/systemjs';

/**
 * Production clear adapter.
 *
 * - Dev mode: no-op (Vite HMR manages dev modules)
 * - Production: removes module from SystemJS cache
 *
 * This adapter satisfies `PluginServiceDeps.clearPlugin`.
 */
export async function clearPlugin(opts: {
  pluginId: string;
  dev?: boolean;
}): Promise<void> {
  if (opts.dev) {
    // Dev-mode modules loaded via native ESM; nothing to clear from SystemJS.
    return;
  }
  const modulePath = `${window.location.protocol}//${window.location.host}/_/plugins/${opts.pluginId}/assets/entry.js`;
  await SystemJS.delete(modulePath);
}
