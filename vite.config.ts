import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import federation from '@originjs/vite-plugin-federation';
import topLevelAwait from 'vite-plugin-top-level-await';

import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// if in ESM context
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    minify: false,
    sourcemap: false,
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/_/': {
        bypass: function () {
          // Return false to produce a 404 error for the request.
          return false;
        },
      },
    },
  },
  plugins: [
    react({
      jsxImportSource: '@welldone-software/why-did-you-render',
    }),
    federation({
      name: 'omniview-host',
      // needs a placeholder to prevent "ReferenceError: __rf_placeholder__shareScope is not defined"
      remotes: { noopRemote: 'noopRemote.js' },
      shared: [
        'react',
        'react-dom',
      ],
    }),
    // Webkit doesn't support top level await
    topLevelAwait({
      promiseExportName: '__tla',
      promiseImportName: i => `__tla_${i}`,
    }),
  ],
  resolve: {
    alias: {
      // prepare for eventual package splitting
      '@infraview': path.resolve(__dirname, './ui/pkg'),
      // core routes
      '@': path.resolve(__dirname, './ui'),
      '@api': path.resolve(__dirname, './packages/omniviewdev-runtime/wailsjs/go'),
      '@runtime': path.resolve(__dirname, './packages/omniviewdev-runtime/wailsjs/runtime'),
      '@components': path.resolve(__dirname, './ui/components'),
      '@hooks': path.resolve(__dirname, './ui/hooks'),
      '@layouts': path.resolve(__dirname, './ui/layouts'),
      '@pages': path.resolve(__dirname, './ui/pages'),
      '@theme': path.resolve(__dirname, './ui/theme'),
      '@types': path.resolve(__dirname, './ui/types'),
      '@utils': path.resolve(__dirname, './ui/utils'),
    },
  },
});
