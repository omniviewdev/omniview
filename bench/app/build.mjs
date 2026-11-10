/**
 * Build and serve the instrumented frontend of a selected host checkout.
 *
 * The harness checkout supplies the instrumentation (fake backend, sampler, fixtures) and the
 * selected app root supplies everything else: its sources, its node_modules, its vite.config.ts
 * (so its own minifier and React settings are the ones measured), the shared UI packages it
 * resolves and its committed Wails bindings. Nothing is written into the app root: the output
 * goes to `dist`, Vite's runner loader reads the app's config without a temporary file, and the
 * optimizer cache is redirected next to `dist`.
 */
import fs from 'node:fs';
import path from 'node:path';

import { build, preview, version as viteVersion } from 'vite';

import { servePluginAssets } from './harness-plugins.mjs';
import { appConfigSHA256, harnessIdentity, readBuildManifest, uiPackageProvenance, writeBuildManifest } from './provenance.mjs';
import { gitSourceIdentity } from './plugin-bundle.mjs';

/** Fail before a long build when the app root cannot be built, not after it. */
export function requireAppRoot(appRoot) {
  for (const required of ['package.json', 'vite.config.ts', 'ui/main.tsx', 'index.html']) {
    if (!fs.existsSync(path.join(appRoot, required))) throw new Error(`--app-root ${appRoot} is not a host checkout: ${required} is missing`);
  }
  if (!fs.existsSync(path.join(appRoot, 'node_modules/react'))) {
    throw new Error(`--app-root ${appRoot} has no installed dependencies (node_modules/react is missing); install them there first`);
  }
}

/**
 * Build the frontend into `options.dist` and write its manifest beside the bytes.
 * Selection reaches vite.config.ts through the environment, as archive smoke does.
 */
export async function buildFrontend({ harnessRoot, options, pluginAssets, pluginMetadata }) {
  requireAppRoot(options.appRoot);
  if (process.env.OV_PLUGIN_ARCHIVE_SMOKE !== undefined) {
    throw new Error('OV_PLUGIN_ARCHIVE_SMOKE is the archive acceptance gate; select the React build with --react normal|profiling instead');
  }
  Object.assign(process.env, {
    OV_BENCH_APP_ROOT: options.appRoot,
    OV_BENCH_REACT: options.react,
    OV_BENCH_MINIFY: options.minify,
    OV_BENCH_DIST: options.dist,
    OV_K8S_PLUGIN_DIST: pluginAssets,
    OV_K8S_PLUGIN_METADATA: pluginMetadata,
  });
  globalThis.__ovBenchBuildRecord = undefined;
  const configFile = path.join(harnessRoot, 'bench/app/vite.config.ts');
  const started = Date.now();
  await build({ configFile, logLevel: 'warn', configLoader: options.configLoader });
  const resolved = globalThis.__ovBenchBuildRecord ?? null;
  if (!resolved) throw new Error('the build did not report its resolved configuration; the harness plugins did not run');
  const manifest = writeBuildManifest(options.dist, {
    harness: harnessIdentity(harnessRoot),
    appRoot: options.appRoot,
    hostSource: gitSourceIdentity(options.appRoot),
    appConfigSHA256: appConfigSHA256(options.appRoot),
    react: options.react,
    reactDom: options.react === 'profiling' ? 'react-dom/profiling' : 'react-dom/client',
    // What Vite resolved, not what the harness assumes: the app's own config decides the minifier.
    minify: { setting: options.minify, effective: resolved.minify },
    resolvedConfig: resolved,
    ui: uiPackageProvenance(options.appRoot),
    toolchain: { node: process.version, vite: viteVersion },
    buildMs: Date.now() - started,
  });
  return manifest;
}

/** Serve `dist` and the plugin bundle on loopback IPv4. Returns the Vite preview server. */
export async function startPreview({ harnessRoot, dist, pluginAssets, port }) {
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`no built frontend at ${dist}: run without --no-build first`);
  return preview({
    configFile: false,
    root: harnessRoot,
    logLevel: 'warn',
    plugins: [servePluginAssets({ kubernetes: pluginAssets })],
    build: { outDir: dist },
    preview: { host: '127.0.0.1', port, strictPort: true },
  });
}

export { readBuildManifest };
