/**
 * Profiling build of the desktop frontend for bench/app (whole-app profiling in
 * Playwright Chromium, no Go backend). See bench/app/README.md.
 *
 * Same as the production build (vite.config.ts) plus:
 * - react-dom/client -> react-dom/profiling, so <Profiler> onRender works;
 * - ui/main.tsx gets the in-page fake backend imported first and the root
 *   wrapped in <Profiler> (bench/app/page);
 * - `vite preview` also serves the kubernetes plugin's built UI bundle at
 *   /_/plugins/kubernetes/assets/, where the app's SystemJS loader looks for it.
 *
 *   pnpm exec vite build --config bench/app/vite.config.ts
 */
import { defineConfig, type Plugin, type UserConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

import appConfig from '../../vite.config';
import { wailsBindingIndex } from '../vite/wails-binding-index';

import { pluginAssetDirectory } from './plugin-bundle.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const here = import.meta.dirname;
const pluginMetadata = path.resolve(root, process.env.OV_K8S_PLUGIN_METADATA ?? 'plugins/kubernetes/plugin.json');
const bindingsRoot = path.join(root, 'packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview');

/** Built plugin UI bundles served to the app, by plugin id. */
export const pluginAssetDirs: Record<string, string> = {
  kubernetes: pluginAssetDirectory(root),
};

function instrumentEntry(): Plugin {
  const entry = path.join(root, 'ui/main.tsx');
  const render = 'root.render(<App />)';
  return {
    name: 'bench-app-instrument-entry',
    enforce: 'pre',
    transform(code, id) {
      if (id !== entry) return;
      if (!code.includes(render)) throw new Error(`bench/app: ${render} not found in ui/main.tsx; update instrumentEntry()`);
      return [
        `import ${JSON.stringify(path.join(here, 'page/fake-backend.ts'))};`,
        `import { ProfiledRoot as __ProfiledRoot } from ${JSON.stringify(path.join(here, 'page/profiler.tsx'))};`,
        code.replace(render, 'root.render(<__ProfiledRoot><App /></__ProfiledRoot>)'),
      ].join('\n');
    },
  };
}

function servePluginAssets(): Plugin {
  const types: Record<string, string> = { '.js': 'application/javascript', '.css': 'text/css', '.map': 'application/json' };
  return {
    name: 'bench-app-plugin-assets',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const m = url.pathname.match(/^\/_\/plugins\/([^/]+)\/assets\/(.+)$/);
        if (m) {
          const dir = pluginAssetDirs[m[1]];
          const file = dir && path.join(dir, path.normalize(m[2]));
          if (!file || !file.startsWith(dir) || !fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
          res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
          fs.createReadStream(file).pipe(res);
          return;
        }
        // No Wails server: the runtime probes /wails/custom.js; everything else goes through the fake transport.
        if (url.pathname.startsWith('/wails/')) { res.statusCode = 404; res.end(); return; }
        next();
      });
    },
  };
}

const app = appConfig as UserConfig;
const alias = Object.entries((app.resolve?.alias ?? {}) as Record<string, string>).map(([find, replacement]) => ({ find, replacement }));

export default defineConfig({
  ...app,
  root,
  // vite.config.ts carries Vitest settings; they mean nothing here.
  test: undefined,
  plugins: [instrumentEntry(), wailsBindingIndex(bindingsRoot), servePluginAssets(), ...(app.plugins ?? [])],
  resolve: {
    ...app.resolve,
    alias: [
      { find: 'virtual:bench-kubernetes-plugin', replacement: pluginMetadata },
      { find: /^react-dom\/client$/, replacement: 'react-dom/profiling' },
      ...alias,
    ],
  },
  define: {
    'import.meta.env.BENCH_VERBOSE': JSON.stringify(process.env.BENCH_VERBOSE ?? ''),
  },
  build: {
    ...app.build,
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
  },
  preview: { port: Number(process.env.OV_BENCH_PORT ?? 9345), strictPort: true },
} as UserConfig);
