/**
 * Build of the desktop frontend for bench/app (whole-app profiling in Playwright Chromium,
 * no Go backend). See bench/app/README.md.
 *
 * The harness never changes what the app's own build does: it loads the selected app root's
 * vite.config.ts and adds only instrumentation on top of it.
 * - `OV_BENCH_APP_ROOT` selects the host checkout to build (default: this checkout), so one
 *   harness measures another checkout's bytes with no edits to that checkout. Its config
 *   is loaded with Vite's runner loader, which writes no temporary file into its tree.
 * - `OV_BENCH_REACT` selects the React variant. `profiling` aliases react-dom/client to
 *   react-dom/profiling and wraps the root in <Profiler>: an attribution build whose own
 *   instrumentation costs time. `normal` keeps the app's production React and adds no
 *   Profiler. Archive smoke (`OV_PLUGIN_ARCHIVE_SMOKE=1`) is its own gate and implies `normal`.
 * - `OV_BENCH_MINIFY` is `app` (the default: whatever the app config says), `on` or `off`.
 *   Only `app` produces a build comparable with the shipped one.
 * - `OV_BENCH_DIST` is the output directory (default bench/app/dist).
 * - `vite preview` also serves the kubernetes plugin's built UI bundle at
 *   /_/plugins/kubernetes/assets/, where the app's SystemJS loader looks for it.
 *
 *   pnpm exec vite build --config bench/app/vite.config.ts
 */
import { defineConfig, loadConfigFromFile, type UserConfig } from 'vite';
import path from 'node:path';

import { benchBootstrap, instrumentEntry, recordResolvedConfig, servePluginAssets } from './harness-plugins.mjs';
import { pluginAssetDirectory, pluginMetadataFile } from './plugin-bundle.mjs';
import { wailsBindingIndex } from '../vite/wails-binding-index';

const here = import.meta.dirname;
const harnessRoot = path.resolve(here, '../..');
const root = process.env.OV_BENCH_APP_ROOT ? path.resolve(process.env.OV_BENCH_APP_ROOT) : harnessRoot;
const archiveSmoke = process.env.OV_PLUGIN_ARCHIVE_SMOKE === '1';

function selectedReact(): 'normal' | 'profiling' {
  if (archiveSmoke) return 'normal';
  const value = process.env.OV_BENCH_REACT ?? 'profiling';
  if (value !== 'normal' && value !== 'profiling') throw new Error(`OV_BENCH_REACT must be normal or profiling, not ${value}`);
  return value;
}
const react = selectedReact();

function selectedMinify(): UserConfig['build'] {
  const value = process.env.OV_BENCH_MINIFY ?? 'app';
  if (value === 'app') return {};
  if (value === 'on') return { minify: 'esbuild' };
  if (value === 'off') return { minify: false };
  throw new Error(`OV_BENCH_MINIFY must be app, on or off, not ${value}`);
}

const pluginMetadata = pluginMetadataFile(root);
const bindingsRoot = path.join(root, 'packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview');

/** Built plugin UI bundles served to the app, by plugin id. */
const pluginAssetDirs: Record<string, string> = {
  kubernetes: pluginAssetDirectory(root),
};

/**
 * The selected checkout's own config: the harness checkout's by import, any other by Vite's runner
 * loader. The import is dynamic because evaluating this checkout's config is wrong, and has side
 * effects, whenever another checkout is selected.
 */
async function appConfig(): Promise<UserConfig> {
  if (root === harnessRoot) return (await import('../../vite.config')).default as UserConfig;
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(root, 'vite.config.ts'), root, 'warn', undefined, 'runner');
  if (!loaded) throw new Error(`no vite.config.ts in ${root}`);
  return loaded.config as UserConfig;
}

export default defineConfig(async () => {
  const app = await appConfig();
  // Vite takes aliases as an array of `{ find, replacement }` entries or as a `{ find: replacement }` object: keep the first, convert the second.
  const appAlias = app.resolve?.alias ?? [];
  const alias = Array.isArray(appAlias)
    ? appAlias
    : Object.entries(appAlias as Record<string, string>).map(([find, replacement]) => ({ find, replacement }));
  const outDir = process.env.OV_BENCH_DIST ? path.resolve(process.env.OV_BENCH_DIST) : path.join(here, 'dist');
  return {
    ...app,
    root,
    // The app's Vitest settings mean nothing here.
    test: undefined,
    // A checkout other than the harness's must not receive the optimizer cache either.
    ...(root === harnessRoot ? {} : { cacheDir: path.join(outDir, '..', 'vite-cache') }),
    plugins: [
      benchBootstrap(),
      instrumentEntry({ root, here, react }),
      wailsBindingIndex(bindingsRoot),
      servePluginAssets(pluginAssetDirs),
      recordResolvedConfig(),
      ...(app.plugins ?? []),
    ],
    resolve: {
      ...app.resolve,
      // Harness files live in this checkout. When the app is another checkout they must still
      // share that checkout's single copy of these packages, never this one's.
      dedupe: [...new Set([...(app.resolve?.dedupe ?? []), 'react', 'react-dom', '@wailsio/runtime'])],
      alias: [
        { find: 'virtual:bench-kubernetes-plugin', replacement: pluginMetadata },
        ...(react === 'profiling' ? [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] : []),
        ...alias,
      ],
    },
    define: {
      ...app.define,
      'import.meta.env.BENCH_VERBOSE': JSON.stringify(process.env.BENCH_VERBOSE ?? ''),
      'import.meta.env.BENCH_REACT_BUILD': JSON.stringify(react),
    },
    build: {
      ...app.build,
      ...selectedMinify(),
      outDir,
      emptyOutDir: true,
    },
    preview: { port: Number(process.env.OV_BENCH_PORT ?? 9345), strictPort: true },
  } as UserConfig;
});
