import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// import federation from '@originjs/vite-plugin-federation';
// import topLevelAwait from 'vite-plugin-top-level-await';

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
      // jsxImportSource: '@welldone-software/why-did-you-render',
    }),
    // federation({
    //   name: 'omniview-host',
    //   // needs a placeholder to prevent "ReferenceError: __rf_placeholder__shareScope is not defined"
    //   remotes: { noopRemote: 'noopRemote.js' },
    //   shared: [
    //     'react',
    //     'react-dom',
    //     // Running into issue with top level await:
    //     // [vite:esbuild-transpile] Transform failed with 3 errors:
    //     // assets/__federation_shared_react-router-dom-!~{01o}~.js:4575:16: ERROR: Top-level await is not available in the configured target environment ("chrome87", "edge88", "es2020", "firefox78", "safari14" + 2 overrides)
    //     // assets/__federation_shared_react-router-dom-!~{01o}~.js:5499:14: ERROR: Top-level await is not available in the configured target environment ("chrome87", "edge88", "es2020", "firefox78", "safari14" + 2 overrides)
    //     // assets/__federation_shared_react-router-dom-!~{01o}~.js:5501:17: ERROR: Top-level await is not available in the configured target environment ("chrome87", "edge88", "es2020", "firefox78", "safari14" + 2 overrides)
    //     // 'react-router-dom',
    //   ],
    // }),
    // Webkit doesn't support top level await
    // topLevelAwait({
    //   promiseExportName: '__tla',
    //   promiseImportName: i => `__tla_${i}`,
    // }),
  ],
  resolve: {
    alias: {
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
    },
  },
});
