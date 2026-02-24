import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const uiSrc = path.resolve(__dirname, '../../omniviewdev-ui/src');

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      '@omniviewdev/ui': uiSrc,
      '@omniviewdev/ui/cells': path.resolve(uiSrc, 'cells'),
      '@omniviewdev/ui/table': path.resolve(uiSrc, 'table'),
      '@omniviewdev/ui/inputs': path.resolve(uiSrc, 'inputs'),
      '@omniviewdev/ui/utils': path.resolve(uiSrc, 'utils'),
      '@omniviewdev/ui/theme': path.resolve(uiSrc, 'theme'),
      '@omniviewdev/ui/types': path.resolve(uiSrc, 'types'),
      '@omniviewdev/ui/buttons': path.resolve(uiSrc, 'buttons'),
      '@omniviewdev/ui/feedback': path.resolve(uiSrc, 'feedback'),
      '@omniviewdev/ui/typography': path.resolve(uiSrc, 'typography'),
      '@omniviewdev/ui/overlays': path.resolve(uiSrc, 'overlays'),
      '@omniviewdev/ui/navigation': path.resolve(uiSrc, 'navigation'),
      '@omniviewdev/ui/editors': path.resolve(uiSrc, 'editors'),
      '@omniviewdev/ui/domain': path.resolve(uiSrc, 'domain'),
      '@omniviewdev/ui/layout': path.resolve(uiSrc, 'layout'),
      '@omniviewdev/ui/menus': path.resolve(uiSrc, 'menus'),
      '@omniviewdev/ui/sidebars': path.resolve(uiSrc, 'sidebars'),
      '@omniviewdev/ui/charts': path.resolve(uiSrc, 'charts'),
      '@omniviewdev/ui/components': path.resolve(uiSrc, 'components'),
    },
    dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/styled'],
  },
  server: {
    host: true,
    port: 5180,
    open: true,
  },
});
