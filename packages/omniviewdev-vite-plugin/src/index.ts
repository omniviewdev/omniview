import { type Plugin } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED_PACKAGES } from './sharedPackages';
import { safeFilename } from './safeFilename';

export { SHARED_PACKAGES } from './sharedPackages';
export { safeFilename } from './safeFilename';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Compute the absolute path to the shims directory.
 *
 * In development (source), shims are at: <package-root>/shims/
 * In published package, shims are at:    <package-root>/shims/
 *
 * Since dist/ is a sibling of shims/, we go up one level from __dirname
 * (which is dist/ or src/ depending on context) to reach the package root.
 */
function getShimsDir(): string {
  const packageRoot = path.resolve(__dirname, '..');
  return path.join(packageRoot, 'shims');
}

/**
 * Build a lookup map from package name to absolute shim file path.
 */
function buildShimMap(shimsDir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pkg of SHARED_PACKAGES) {
    const shimFile = path.join(shimsDir, `${safeFilename(pkg)}.mjs`);
    map.set(pkg, shimFile);
  }
  return map;
}

export interface OmniviewExternalsOptions {
  /**
   * Additional package names to treat as shared. These are appended to the
   * built-in SHARED_PACKAGES list. You must also ensure shim files exist for
   * these packages (run generate-shims after adding them to sharedPackages.ts).
   */
  additionalShared?: string[];

  /**
   * Override the path to the shims directory. Defaults to the shims/ directory
   * inside this package.
   */
  shimsDir?: string;
}

/**
 * Vite plugin that redirects imports of shared dependencies to shim files
 * that re-export from window.__OMNIVIEW_SHARED__.
 *
 * Usage in a plugin's vite.config.ts:
 *
 *   import { omniviewExternals } from '@omniviewdev/vite-plugin';
 *
 *   export default defineConfig({
 *     plugins: [
 *       react(),
 *       omniviewExternals(),
 *     ],
 *   });
 *
 * How it works:
 *   - In the `resolveId` hook, if the import source matches a shared package
 *     name, we return the absolute path to the corresponding shim .mjs file.
 *   - Vite then loads the shim file instead of resolving the package from
 *     node_modules.
 *   - The shim file contains: `const mod = window.__OMNIVIEW_SHARED__['<pkg>'];`
 *     and re-exports all of its named exports plus a default export.
 *   - This works in both dev mode (native ESM) and build mode (Rollup).
 *
 * In BUILD mode, this plugin also marks all shared packages as external in
 * Rollup config, so the SystemJS bundle still uses external references.
 */
export function omniviewExternals(options: OmniviewExternalsOptions = {}): Plugin {
  const shimsDir = options.shimsDir ?? getShimsDir();
  const allPackages = [...SHARED_PACKAGES, ...(options.additionalShared ?? [])];
  const shimMap = buildShimMap(shimsDir);

  // Add additional shared packages to the shim map
  if (options.additionalShared) {
    for (const pkg of options.additionalShared) {
      const shimFile = path.join(shimsDir, `${safeFilename(pkg)}.mjs`);
      shimMap.set(pkg, shimFile);
    }
  }

  // Build a set for O(1) lookup
  const sharedSet = new Set(allPackages);

  return {
    name: 'omniview-externals',
    enforce: 'pre', // Run before other plugins (especially @vitejs/plugin-react)

    config(config, { command }) {
      // In build mode, also mark packages as external for Rollup.
      // This maintains backward compatibility with the existing SystemJS build.
      if (command === 'build') {
        config.build = config.build ?? {};
        config.build.rollupOptions = config.build.rollupOptions ?? {};

        const existing = config.build.rollupOptions.external;
        if (Array.isArray(existing)) {
          const merged = new Set([...existing, ...allPackages]);
          config.build.rollupOptions.external = [...merged];
        } else if (typeof existing === 'function') {
          const originalFn = existing;
          config.build.rollupOptions.external = (source: string, importer: string | undefined, isResolved: boolean) => {
            if (sharedSet.has(source)) return true;
            return originalFn(source, importer, isResolved);
          };
        } else if (existing === undefined || existing === null) {
          config.build.rollupOptions.external = [...allPackages];
        } else {
          config.build.rollupOptions.external = (source: string) => {
            if (sharedSet.has(source)) return true;
            if (typeof existing === 'string') return source === existing;
            if (existing instanceof RegExp) return existing.test(source);
            return false;
          };
        }
      }
    },

    resolveId(source) {
      // In build mode, Rollup won't call resolveId for external modules,
      // so this effectively only fires in dev mode.
      if (sharedSet.has(source)) {
        const shimPath = shimMap.get(source);
        if (shimPath) {
          return shimPath;
        }
      }

      return null;
    },
  };
}

export default omniviewExternals;
