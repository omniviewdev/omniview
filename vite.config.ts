import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import wails from '@wailsio/runtime/plugins/vite';

import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { workspaceViteCacheDirectory, workspaceVitePort, workspaceViteRoots } from './packages/omniviewdev-vite-plugin/src/workspace';
import { managedViteFeedback } from './packages/omniviewdev-vite-plugin/src/feedback';
import { vitestCaches } from './vitest.cache';

// if in ESM context
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const reactCompilerSourceRoot = __dirname.split(path.sep)
  .map(segment => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join(String.raw`[/\\]`);

const selectedRoots = workspaceViteRoots(process.env.OMNIVIEW_VITE_ALLOWED_ROOTS);
const ownedVitePort = workspaceVitePort(process.env.WAILS_VITE_PORT);
const stagedYamlWorker = process.env.OMNIVIEW_YAML_WORKER_OUTPUT_FILE;
const ownedViteCacheDirectory = workspaceViteCacheDirectory(process.env.OMNIVIEW_VITE_CACHE_DIRECTORY);
const testCaches = vitestCaches(__dirname);
if (selectedRoots && !ownedVitePort) {
  throw new Error('Managed host Vite requires its owned WAILS_VITE_PORT');
}

// https://vitejs.dev/config/
export default defineConfig({
  // Source transforms must not recompile generated optimized dependencies.
  cacheDir: ownedViteCacheDirectory
    ? path.join(ownedViteCacheDirectory, 'node_modules', '.vite')
    : testCaches.cacheDir,
  test: {
    fsModuleCachePath: testCaches.fsModuleCachePath,
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./ui/test-setup.ts'],
    css: false,
    include: [
      'ui/**/*.{spec,test}.{ts,tsx}',
      'packages/omniviewdev-runtime/src/hooks/connection/useConnectionMetadata.test.tsx',
    ],
  },
  build: {
    outDir: process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY || 'dist',
    minify: false,
    sourcemap: false,
  },
  server: {
    // Wails' development asset proxy deliberately dials localhost over IPv4.
    // Bind Vite to the same address instead of letting Node resolve localhost
    // to IPv6-only ::1 on macOS.
    host: '127.0.0.1',
    // Port is set via WAILS_VITE_PORT env var (wails3 dev sets it automatically).
    // Fallback to 9245 to match the default in Taskfile.yml.
    port: ownedVitePort ?? 9245,
    strictPort: true,
    fs: selectedRoots ? { strict: true, allow: [__dirname, ...selectedRoots] } : undefined,
    // Wails webview loads from wails://localhost. Point HMR at the same IPv4
    // listener used by the asset proxy.
    hmr: {
      host: '127.0.0.1',
      protocol: 'ws',
      clientPort: ownedVitePort,
    },
  },
  optimizeDeps: selectedRoots ? {
    exclude: ['@omniviewdev/base-ui', '@omniviewdev/ai-ui', '@omniviewdev/editors',
      '@omniviewdev/providers', '@omniviewdev/runtime', '@omniviewdev/runtime/api',
      '@omniviewdev/runtime/models', '@omniviewdev/runtime/runtime'],
    // Exclusion keeps linked code live but also stops transitive scanning.
    // Scan its real entries so all third-party imports are discovered together.
    entries: [
      'index.html',
      ...['base-ui', 'ai-ui', 'editors', 'providers'].map(name =>
        fileURLToPath(import.meta.resolve(`@omniviewdev/${name}`))),
      ...['index', 'api', 'models', 'runtime'].map(name =>
        path.resolve(__dirname, `packages/omniviewdev-runtime/src/${name}.ts`)),
    ],
    // Linked UI stays live; its nested CommonJS shim still needs ESM interop.
    include: [
      '@omniviewdev/base-ui > @base-ui/react > @base-ui/utils > use-sync-external-store/shim',
      '@omniviewdev/base-ui > @base-ui/react > @base-ui/utils > use-sync-external-store/shim/with-selector',
    ],
    force: true,
  } : undefined,
  plugins: [
    managedViteFeedback(),
    {
      name: 'managed-yaml-worker-stage',
      enforce: 'pre',
      resolveId(source, importer) {
        if (stagedYamlWorker && source === './yaml.worker.bundle.js?url'
          && importer && path.dirname(importer.split('?')[0]) === path.resolve(__dirname, 'ui/providers/monaco')) {
          return `${stagedYamlWorker}?url`;
        }
        return null;
      },
    },
    react({
      // Linked package dist files are already compiled; keep app and benchmark sources live.
      include: new RegExp(String.raw`^${reactCompilerSourceRoot}[/\\](?:ui[/\\]|bench[/\\]|packages[/\\][^/\\]+[/\\]src[/\\]|plugins[/\\][^/\\]+[/\\]ui[/\\]src[/\\]).*\.(?:[jt]sx?|[cm][jt]s)(?:$|\?)`),
      babel: { plugins: [['babel-plugin-react-compiler', { target: '19' }]] },
    }),
    wails('./packages/omniviewdev-runtime/src/bindings'),
    {
      name: 'optional-local-react-devtools',
      transformIndexHtml(html, ctx) {
        const marker = '<!-- omniview-react-devtools -->';
        const configured = process.env.VITE_REACT_DEVTOOLS_URL;
        // Never inject tooling into release assets, even with ambient env set.
        if (!ctx.server || !configured) return html.replace(marker, '');
        const url = new URL(configured);
        if (!['http:', 'https:'].includes(url.protocol)
          || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
          || url.username || url.password) {
          throw new Error('VITE_REACT_DEVTOOLS_URL must be an unauthenticated loopback HTTP(S) URL');
        }
        const src = url.href.replace(/[&"<>]/g, (char) => ({
          '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;',
        })[char]!);
        return html.replace(marker, `<script src="${src}"></script>`);
      },
    },
  ],
  resolve: {
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@omniviewdev/runtime', '@omniviewdev/base-ui', '@omniviewdev/ai-ui', '@omniviewdev/editors'],
    alias: {
      '@/providers/monaco/bootstrap': process.env.VITEST
        ? path.resolve(__dirname, './ui/providers/monaco/bootstrap.mock.ts')
        : path.resolve(__dirname, './ui/providers/monaco/bootstrap.ts'),
      // core routes
      '@': path.resolve(__dirname, './ui'),
      '@components': path.resolve(__dirname, './ui/components'),
      '@hooks': path.resolve(__dirname, './ui/hooks'),
      '@layouts': path.resolve(__dirname, './ui/layouts'),
      '@pages': path.resolve(__dirname, './ui/pages'),
      '@theme': path.resolve(__dirname, './ui/theme'),
      '@types': path.resolve(__dirname, './ui/types'),
      '@utils': path.resolve(__dirname, './ui/utils'),

      // Resolve @omniviewdev/runtime to source so vitest uses a single
      // module instance (avoids symlink-induced dual-instance bug where
      // test files and source files get different copies of the registry).
      // NOTE: Subpaths must come BEFORE the parent path (vite uses prefix matching).
      '@omniviewdev/runtime/api': path.resolve(__dirname, 'packages/omniviewdev-runtime/src/api.ts'),
      '@omniviewdev/runtime/models': path.resolve(__dirname, 'packages/omniviewdev-runtime/src/models.ts'),
      '@omniviewdev/runtime/runtime': path.resolve(__dirname, 'packages/omniviewdev-runtime/src/runtime.ts'),
      '@omniviewdev/runtime': path.resolve(__dirname, 'packages/omniviewdev-runtime/src/index.ts'),
    },
  },
});
