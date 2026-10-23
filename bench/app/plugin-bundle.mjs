import fs from 'node:fs';
import path from 'node:path';

/** OV_K8S_PLUGIN_DIST names the assets directory, not dist or an entry file. */
export function pluginAssetDirectory(root, override = process.env.OV_K8S_PLUGIN_DIST) {
  if (override !== undefined && !override.trim()) {
    throw new Error('OV_K8S_PLUGIN_DIST must name a built Kubernetes UI assets directory');
  }
  return path.resolve(root, override ?? 'plugins/kubernetes/ui/dist/assets');
}

export function requirePluginBundle(assets) {
  const entry = path.join(assets, 'entry.js');
  const stat = fs.statSync(entry, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size === 0) {
    throw new Error(`Kubernetes UI bundle is missing a nonempty regular entry.js: ${entry}`);
  }
}
