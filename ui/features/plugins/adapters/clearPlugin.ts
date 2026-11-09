import { systemJs } from '../api/systemjs';
import { clearDevPluginRefresh } from './importPlugin';

/**
 * Production clear adapter.
 *
 * - Dev mode: disposes native-import refresh ownership (Vite owns module updates)
 * - Production: removes the plugin's entire module graph from SystemJS cache
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

  // Rollup emits stable chunk names (entry2.js, entry3.js, ...). Retaining
  // those modules mixes old chunk exports with a newly installed entry.
  const pluginPath = `${window.location.protocol}//${window.location.host}/_/plugins/${opts.pluginId}/`;
  for (const [id] of systemJs.entries()) {
    if (id.startsWith(pluginPath)) {
      systemJs.delete(id);
    }
  }
}
