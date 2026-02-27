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

const reactCompilerConfig = {
  target: '19',
};

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
      babel: {
        plugins: [['babel-plugin-react-compiler', reactCompilerConfig]],
      },
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/styled', '@mui/material', '@mui/x-charts'],
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
    },
  },
});
