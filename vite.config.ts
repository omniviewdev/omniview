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
    // Wails' development asset proxy deliberately dials localhost over IPv4.
    // Bind Vite to the same address instead of letting Node resolve localhost
    // to IPv6-only ::1 on macOS.
    host: '127.0.0.1',
    // Port is set via WAILS_VITE_PORT env var (wails3 dev sets it automatically).
    // Fallback to 9245 to match the default in Taskfile.yml.
    port: parseInt(process.env.WAILS_VITE_PORT || '9245'),
    strictPort: true,
    // Wails webview loads from wails://localhost. Point HMR at the same IPv4
    // listener used by the asset proxy.
    hmr: {
      host: '127.0.0.1',
      protocol: 'ws',
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
    dedupe: ['react', 'react-dom', '@omniviewdev/runtime', '@omniviewdev/base-ui', '@omniviewdev/ai-ui', '@omniviewdev/editors'],
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
