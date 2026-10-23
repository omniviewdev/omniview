import { type Plugin } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED_PACKAGES } from './sharedPackages';
import { safeFilename } from './safeFilename';
import { workspaceViteCacheDirectory, workspaceVitePort, workspaceViteRoots } from './workspace';
import { attachManagedViteFeedback } from './feedback';

export { SHARED_PACKAGES } from './sharedPackages';
export { safeFilename } from './safeFilename';
export { managedViteFeedback } from './feedback';

const moduleDirectory = typeof __dirname === 'string'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

/**
 * Compute the absolute path to the shims directory.
 *
 * In development (source), shims are at: <package-root>/shims/
 * In published package, shims are at:    <package-root>/shims/
 *
 * Since dist/ is a sibling of shims/, we go up one level from the module directory
 * (which is dist/ or src/ depending on context) to reach the package root.
 */
function getShimsDir(): string {
  const packageRoot = path.resolve(moduleDirectory, '..');
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

export type OmniviewExternalsOptions = {
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
};

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
      const cache = workspaceViteCacheDirectory(process.env.OMNIVIEW_VITE_CACHE_DIRECTORY);
      if (cache) {
        if (config.cacheDir && path.resolve(config.root ?? process.cwd(), config.cacheDir) !== cache) {
          throw new Error('Plugin Vite cache conflicts with its owned workspace cache');
        }

        config.cacheDir = cache;
      }

      const output = process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY;
      if (command === 'build' && output) {
        const root = path.resolve(config.root ?? process.cwd());
        const configured = config.build?.outDir && path.resolve(root, config.build.outDir);
        if (configured && configured !== path.join(root, 'dist') && configured !== path.resolve(output)) {
          throw new Error('Plugin distribution path conflicts with controlled workspace output');
        }

        config.build = { ...config.build, outDir: output };
      }

      // In dev mode, prevent the dep optimizer from bundling shared packages
      // into pre-bundled chunks. Without this, MUI/etc. get their own copy of
      // React bundled inside, causing "multiple React instances" errors.
      // We use an esbuild plugin to externalize shared packages when they're
      // imported from within OTHER packages (not when they ARE the entry point).
      if (command === 'serve') {
        const roots = workspaceViteRoots(process.env.OMNIVIEW_VITE_ALLOWED_ROOTS);
        const ownedPort = workspaceVitePort(process.env.OMNIVIEW_VITE_PORT);
        if (roots) {
          if (!ownedPort) {
            throw new Error('Managed plugin Vite requires its owned OMNIVIEW_VITE_PORT');
          }

          config.server = config.server ?? {};
          if (config.server.port !== undefined && config.server.port !== ownedPort) {
            throw new Error('Plugin Vite port conflicts with its owned workspace lease');
          }

          if (config.server.hmr === false || typeof config.server.hmr === 'object'
            && (config.server.hmr.clientPort !== undefined && config.server.hmr.clientPort !== ownedPort
              || config.server.hmr.port !== undefined && config.server.hmr.port !== ownedPort
              || config.server.hmr.host !== undefined && config.server.hmr.host !== '127.0.0.1'
              || config.server.hmr.protocol !== undefined && config.server.hmr.protocol !== 'ws')) {
            throw new Error('Plugin Vite HMR conflicts with its owned loopback endpoint');
          }

          config.server.port = ownedPort;
          config.server.strictPort = true;
          config.server.fs = { ...config.server.fs, strict: true,
            allow: [...new Set([...(config.server.fs?.allow ?? [config.root ?? process.cwd()]), ...roots, shimsDir])] };
          config.server.hmr = { ...(typeof config.server.hmr === 'object' ? config.server.hmr : {}),
            host: '127.0.0.1', protocol: 'ws', clientPort: ownedPort };
        }

        config.optimizeDeps = config.optimizeDeps ?? {};
        config.optimizeDeps.exclude = [...new Set([...(config.optimizeDeps.exclude ?? []), ...allPackages])];
        // Shared shim modules must not survive a rebuilt runtime export graph.
        // The supervisor restarts Vite after ordered runtime/shim completion.
        if (roots) {
          config.optimizeDeps.force = true;
        }

        config.optimizeDeps.esbuildOptions = config.optimizeDeps.esbuildOptions ?? {};
        config.optimizeDeps.esbuildOptions.plugins = [
          ...(config.optimizeDeps.esbuildOptions.plugins ?? []),
          {
            name: 'omniview-redirect-shared-to-shims',
            setup(build: any) {
              // When the dep optimizer pre-bundles a non-shared package (like
              // react-markdown), and that package imports a shared package
              // (like react), redirect it to the shim file instead of bundling
              // from node_modules. The shim reads from window.__OMNIVIEW_SHARED__
              // at runtime, ensuring a single React instance across host + plugins.
              build.onResolve({ filter: /.*/ }, (args: any) => {
                if (args.kind !== 'entry-point' && sharedSet.has(args.path)) {
                  const shimPath = shimMap.get(args.path);
                  if (shimPath) {
                    return { path: shimPath };
                  }
                }

                return null;
              });
            },
          },
        ];
      }

      // In build mode, mark packages as external for Rollup.
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
            if (sharedSet.has(source)) {
              return true;
            }

            return originalFn(source, importer, isResolved);
          };
        } else if (existing === undefined || existing === null) {
          config.build.rollupOptions.external = [...allPackages];
        } else {
          config.build.rollupOptions.external = (source: string) => {
            if (sharedSet.has(source)) {
              return true;
            }

            if (typeof existing === 'string') {
              return source === existing;
            }

            if (existing instanceof RegExp) {
              return existing.test(source);
            }

            return false;
          };
        }
      }
    },

    configResolved(config) {
      if (config.command !== 'serve' || !config.optimizeDeps.include) {
        return;
      }

      // React's plugin adds forced optimizer entries after config hooks merge.
      // Shared imports must stay shim-backed, not be both entries and externals.
      config.optimizeDeps.include = config.optimizeDeps.include.filter(dependency => {
        const target = dependency.slice(dependency.lastIndexOf('>') + 1).trim();
        return !sharedSet.has(target);
      });
    },

    configureServer(server) {
      attachManagedViteFeedback(server);
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
