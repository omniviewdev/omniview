/**
 * Render benchmarks: Vitest browser mode (Playwright Chromium) with the Wails
 * backend replaced by fixtures. See bench/render/README.md.
 *
 *   pnpm bench:render
 */
import { defineConfig, type Plugin, type UserConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import fs from 'node:fs';
import path from 'node:path';

import appConfig from './vite.config';
import { wailsBindingIndex } from './bench/vite/wails-binding-index';
import { vitestCaches } from './vitest.cache';

const root = import.meta.dirname;
const testCaches = vitestCaches(root);
const bindingsRoot = path.join(root, 'packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview');
const k8sPluginSrc = path.join(root, 'plugins/kubernetes/ui/src');

// React ships a slower dev build. Benchmark the production
// builds unless BENCH_REACT_DEV=1 (useful for readable errors while writing a bench).
const reactDev = process.env.BENCH_REACT_DEV === '1';
const nodeEnv = JSON.stringify(reactDev ? 'development' : 'production');

/**
 * Resolution for kubernetes plugin source: its own `@/` alias (its ui/src) must
 * win over the app's, and host modules it imports get SystemJS-like leniency.
 */
function k8sPluginAlias(): Plugin {
  const runtimeShim = path.join(root, 'bench/render/shims/plugin-runtime-runtime.ts');
  const hostRuntime = path.join(root, 'packages/omniviewdev-runtime/src/runtime.ts');
  const appUi = path.join(root, 'ui') + path.sep;
  return {
    name: 'k8s-plugin-alias',
    enforce: 'pre',
    // The app's aliases run first, so match on what they produced.
    async resolveId(source, importer, options) {
      if (!importer || !importer.startsWith(k8sPluginSrc)) return;
      if (source === hostRuntime || source === '@omniviewdev/runtime/runtime') return runtimeShim;
      const sub = source.startsWith('@/') ? source.slice(2) : source.startsWith(appUi) ? source.slice(appUi.length) : null;
      if (sub === null) return;
      return this.resolve(path.join(k8sPluginSrc, sub), importer, { ...options, skipSelf: true });
    },
  };
}

/**
 * Every bare package import reachable from benches, the app UI and the plugin.
 * Vitest browser mode discovers deps lazily and reloads the page when it finds
 * new ones, which aborts a bench run; pre-bundling them all avoids that.
 */
function discoverDeps(dirs: string[], aliases: string[]): string[] {
  const found = new Set<string>();
  const importRe = /(?:^|[^.\w])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(?\s*['"]([^'"]+)['"]/g;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(t|j)sx?$/.test(entry.name) || /\.(test|spec|stories)\.|\.d\.ts$/.test(entry.name)) continue;
      for (const m of fs.readFileSync(full, 'utf8').matchAll(importRe)) {
        const spec = m[1] ?? m[2];
        if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.includes(':') || spec.endsWith('.css')) continue;
        if (aliases.some((a) => spec === a || spec.startsWith(a + '/'))) continue;
        if (/^(vitest|@vitest\/|@testing-library\/|@storybook\/|react-dom\/test-utils)/.test(spec)) continue;
        const parts = spec.split('/');
        const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
        if (fs.existsSync(path.join(root, 'node_modules', pkg))) found.add(spec);
      }
    }
  };
  dirs.filter((d) => fs.existsSync(d)).forEach(walk);
  return [...found].sort();
}

const app = appConfig as UserConfig;
const appAliases = Object.keys((app.resolve?.alias ?? {}) as Record<string, string>);

export default defineConfig({
  cacheDir: testCaches.cacheDir,
  plugins: [k8sPluginAlias(), wailsBindingIndex(bindingsRoot), ...(app.plugins ?? [])],
  resolve: {
    ...app.resolve,
    dedupe: [...(app.resolve?.dedupe ?? []), '@wailsio/runtime', '@tanstack/react-query', 'react-router'],
  },
  define: {
    'process.env.NODE_ENV': nodeEnv,
    'import.meta.env.BENCH_QUICK': JSON.stringify(process.env.BENCH_QUICK ?? ''),
    'import.meta.env.BENCH_VERBOSE': JSON.stringify(process.env.BENCH_VERBOSE ?? ''),
  },
  esbuild: { jsx: 'automatic', jsxDev: reactDev },
  optimizeDeps: {
    // Discovering a dep mid-run makes Vite re-optimize and reload the page,
    // which aborts the bench file. Pre-bundle the discovered list only.
    noDiscovery: true,
    include: discoverDeps(
      [path.join(root, 'bench/render'), path.join(root, 'ui'), path.join(root, 'packages/omniviewdev-runtime/src'), k8sPluginSrc],
      [...appAliases, '@omniviewdev/runtime'],
    ),
    esbuildOptions: { define: { 'process.env.NODE_ENV': nodeEnv } },
  },
  test: {
    fsModuleCachePath: testCaches.fsModuleCachePath,
    include: [],
    setupFiles: ['./bench/render/setup.ts'],
    reporters: ['default', 'json'],
    outputFile: { json: './bench/render/results/latest.json' },
    benchmark: {
      include: ['bench/render/**/*.bench.{ts,tsx}'],
    },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
        },
      }),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1440, height: 900 },
    },
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
