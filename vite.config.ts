import { defineConfig } from 'vitest/config';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import wails from '@wailsio/runtime/plugins/vite';

import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// if in ESM context
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./ui/test-setup.ts'],
    css: false,
    include: ['ui/**/*.{spec,test}.{ts,tsx}'],
  },
  build: {
    minify: false,
    sourcemap: false,
  },
  server: {
    // Port must match VITE_PORT in Taskfile.yml (default 9245).
    // wails3 dev sets FRONTEND_DEVSERVER_URL to this port.
    port: parseInt(process.env.WAILS_VITE_PORT || '9245'),
    strictPort: true,
    // HMR fix for Wails webview — the webview loads pages from wails://localhost
    // which can't resolve WS connections. Force the HMR client to connect
    // directly to the Vite dev server. See: https://github.com/wailsapp/wails/issues/3064
    hmr: {
      host: 'localhost',
      port: parseInt(process.env.WAILS_VITE_PORT || '9245'),
      protocol: 'ws',
      // clientPort must match the actual Vite server port so the HMR client
      // in the webview knows where to connect
      clientPort: parseInt(process.env.WAILS_VITE_PORT || '9245'),
    },
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset({ target: '19' })] }),
    wails('./packages/omniviewdev-runtime/src/bindings'),
    {
      name: 'strip-dev-scripts',
      transformIndexHtml(html, ctx) {
        if (ctx.server) return html; // keep in dev
        return html.replace(
          /^\s*<script src="http:\/\/localhost:8097"><\/script>\n?/m,
          '',
        );
      },
    },
  ],
  resolve: {
    dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/styled', '@mui/material', '@mui/x-charts', '@omniviewdev/runtime'],
    alias: {
      '@/providers/monaco/bootstrap': process.env.VITEST
        ? path.resolve(__dirname, './ui/providers/monaco/bootstrap.mock.ts')
        : path.resolve(__dirname, './ui/providers/monaco/bootstrap.ts'),
      // prepare for eventual package splitting
      '@infraview': path.resolve(__dirname, './ui/pkg'),
      // core routes
      '@': path.resolve(__dirname, './ui'),
      '@components': path.resolve(__dirname, './ui/components'),
      '@hooks': path.resolve(__dirname, './ui/hooks'),
      '@layouts': path.resolve(__dirname, './ui/layouts'),
      '@pages': path.resolve(__dirname, './ui/pages'),
      '@theme': path.resolve(__dirname, './ui/theme'),
      '@types': path.resolve(__dirname, './ui/types'),
      '@utils': path.resolve(__dirname, './ui/utils'),

      // Resolve @omniviewdev/ui subpaths to source in dev mode.
      // The package.json exports point to dist/ which contains pre-built
      // rollup chunks with externalized deps — these cause TDZ errors
      // when Vite's dev server tries to serve them alongside concurrent
      // shared dep imports. Resolving to source lets Vite handle the
      // module graph natively with HMR support.
      //
      // NOTE: More specific paths must come BEFORE their parent paths
      // because Vite uses prefix matching (first match wins).
      '@omniviewdev/ui/theme/tokens.css': path.resolve(__dirname, 'packages/omniviewdev-ui/src/theme/tokens.css'),
      '@omniviewdev/ui/buttons': path.resolve(__dirname, 'packages/omniviewdev-ui/src/buttons/index.ts'),
      '@omniviewdev/ui/inputs': path.resolve(__dirname, 'packages/omniviewdev-ui/src/inputs/index.ts'),
      '@omniviewdev/ui/feedback': path.resolve(__dirname, 'packages/omniviewdev-ui/src/feedback/index.ts'),
      '@omniviewdev/ui/typography': path.resolve(__dirname, 'packages/omniviewdev-ui/src/typography/index.ts'),
      '@omniviewdev/ui/overlays': path.resolve(__dirname, 'packages/omniviewdev-ui/src/overlays/index.ts'),
      '@omniviewdev/ui/navigation': path.resolve(__dirname, 'packages/omniviewdev-ui/src/navigation/index.ts'),
      '@omniviewdev/ui/table': path.resolve(__dirname, 'packages/omniviewdev-ui/src/table/index.ts'),
      '@omniviewdev/ui/layout': path.resolve(__dirname, 'packages/omniviewdev-ui/src/layout/index.ts'),
      '@omniviewdev/ui/domain': path.resolve(__dirname, 'packages/omniviewdev-ui/src/domain/index.ts'),
      '@omniviewdev/ui/charts': path.resolve(__dirname, 'packages/omniviewdev-ui/src/charts/index.ts'),
      '@omniviewdev/ui/editors': path.resolve(__dirname, 'packages/omniviewdev-ui/src/editors/index.ts'),
      '@omniviewdev/ui/types': path.resolve(__dirname, 'packages/omniviewdev-ui/src/types/index.ts'),
      '@omniviewdev/ui/theme': path.resolve(__dirname, 'packages/omniviewdev-ui/src/theme/index.ts'),
      '@omniviewdev/ui/menus': path.resolve(__dirname, 'packages/omniviewdev-ui/src/menus/index.ts'),
      '@omniviewdev/ui/sidebars': path.resolve(__dirname, 'packages/omniviewdev-ui/src/sidebars/index.ts'),
      '@omniviewdev/ui/cells': path.resolve(__dirname, 'packages/omniviewdev-ui/src/cells/index.ts'),
      '@omniviewdev/ui/utils': path.resolve(__dirname, 'packages/omniviewdev-ui/src/utils/index.ts'),
      '@omniviewdev/ui': path.resolve(__dirname, 'packages/omniviewdev-ui/src/index.ts'),

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
