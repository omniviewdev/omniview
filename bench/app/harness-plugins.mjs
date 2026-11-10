/**
 * Vite plugins of the bench/app build, shared by vite.config.ts (archive smoke and manual
 * builds) and the runner's preview server. Plain JavaScript with no TypeScript imports, so
 * the runner can import it directly.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Runs before every other script in index.html. It does two things and nothing else:
 *
 * 1. Gives a page opened without a runner (a native WebView) its bench config from the
 *    `ovbench` query parameter, so `window.__OV_BENCH__` means the same everywhere.
 * 2. Embeds the boot identity a native host embeds in the HTML, when the config asks for it
 *    (`instance: "production"`). index.html validates `window.__OMNIVIEW_INSTANCE__` before
 *    first paint; without it the shell shows "Instance unavailable" and disables its
 *    profile-scoped storage, which is what a plain browser preview is.
 *
 * Without a config it defines nothing, so archive smoke and the legacy workloads keep the
 * plain-preview state they were recorded with.
 */
const BOOTSTRAP = `(function () {
  if (!window.__OV_BENCH__) {
    try {
      var raw = new URLSearchParams(window.location.search).get('ovbench');
      if (raw) window.__OV_BENCH__ = JSON.parse(raw);
    } catch (error) {
      window.__OV_BENCH_CONFIG_ERROR__ = String(error);
    }
  }
  var config = window.__OV_BENCH__;
  if (config && config.instance === 'production') {
    window.__OMNIVIEW_INSTANCE__ = { schemaVersion: 1, instanceID: 'bench', displayName: 'Omniview', generation: 'bench-1', kind: 'production' };
  }
})();`;

export function benchBootstrap() {
  return {
    name: 'bench-app-bootstrap',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [{ tag: 'script', children: BOOTSTRAP, injectTo: 'head-prepend' }],
    },
  };
}

/**
 * Imports the in-page fake backend before anything else in ui/main.tsx and, for the profiling
 * build only, wraps the root in <Profiler>. The normal build adds the fake backend and its
 * bounded sampler and nothing else: its React is the app's own production React.
 *
 * @param {{ root: string, here: string, react: 'normal' | 'profiling' }} options
 */
export function instrumentEntry({ root, here, react }) {
  const entry = path.join(root, 'ui/main.tsx');
  const render = 'root.render(<App />)';
  return {
    name: 'bench-app-instrument-entry',
    enforce: 'pre',
    transform(code, id) {
      if (id !== entry) return undefined;
      if (!code.includes(render)) throw new Error(`bench/app: ${render} not found in ui/main.tsx; update instrumentEntry()`);
      const backend = `import ${JSON.stringify(path.join(here, 'page/fake-backend.ts'))};`;
      if (react === 'normal') return `${backend}\n${code}`;
      return [
        backend,
        `import { ProfiledRoot as __ProfiledRoot } from ${JSON.stringify(path.join(here, 'page/profiler.tsx'))};`,
        code.replace(render, 'root.render(<__ProfiledRoot><App /></__ProfiledRoot>)'),
      ].join('\n');
    },
  };
}

const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.map': 'application/json' };

/**
 * `vite preview` also serves each plugin's built UI bundle at /_/plugins/<id>/assets/, where
 * the app's SystemJS loader looks for it, exactly as the native app serves ~/.omniview/plugins.
 *
 * @param {Record<string, string>} dirs plugin id -> assets directory
 */
export function servePluginAssets(dirs) {
  return {
    name: 'bench-app-plugin-assets',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        // The fake transport needs no custom runtime, but Wails probes this
        // optional script. Serve an empty script rather than a browser error.
        if (url.pathname === '/wails/custom.js') {
          res.setHeader('Content-Type', 'application/javascript');
          res.end('');
          return;
        }
        const m = url.pathname.match(/^\/_\/plugins\/([^/]+)\/assets\/(.+)$/);
        if (m) {
          const dir = dirs[m[1]];
          const file = dir && path.join(dir, path.normalize(m[2]));
          if (!file || !file.startsWith(dir) || !fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
          res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
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

/**
 * Records what Vite actually resolved for this build (mode, minifier, target) on a global the
 * runner reads after `build()`. The app's own config decides these; the harness only reports
 * them, so a build is never described by what the harness assumes.
 */
export function recordResolvedConfig() {
  return {
    name: 'bench-app-record-config',
    configResolved(config) {
      globalThis.__ovBenchBuildRecord = {
        command: config.command,
        mode: config.mode,
        isProduction: config.isProduction,
        minify: config.build.minify,
        cssMinify: config.build.cssMinify,
        sourcemap: config.build.sourcemap,
        target: config.build.target,
        root: config.root,
        outDir: config.build.outDir,
      };
    },
  };
}
