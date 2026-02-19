import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      '@omniviewdev/ui': path.resolve(__dirname, '..'),
      '@omniviewdev/ui/cells': path.resolve(__dirname, '../cells'),
      '@omniviewdev/ui/table': path.resolve(__dirname, '../table'),
      '@omniviewdev/ui/inputs': path.resolve(__dirname, '../inputs'),
      '@omniviewdev/ui/utils': path.resolve(__dirname, '../utils'),
      '@omniviewdev/ui/theme': path.resolve(__dirname, '../theme'),
      '@omniviewdev/ui/types': path.resolve(__dirname, '../types'),
      '@omniviewdev/ui/buttons': path.resolve(__dirname, '../buttons'),
      '@omniviewdev/ui/feedback': path.resolve(__dirname, '../feedback'),
      '@omniviewdev/ui/typography': path.resolve(__dirname, '../typography'),
      '@omniviewdev/ui/overlays': path.resolve(__dirname, '../overlays'),
      '@omniviewdev/ui/navigation': path.resolve(__dirname, '../navigation'),
      '@omniviewdev/ui/editors': path.resolve(__dirname, '../editors'),
      '@omniviewdev/ui/domain': path.resolve(__dirname, '../domain'),
      '@omniviewdev/ui/layout': path.resolve(__dirname, '../layout'),
      '@omniviewdev/ui/menus': path.resolve(__dirname, '../menus'),
      '@omniviewdev/ui/sidebars': path.resolve(__dirname, '../sidebars'),
      '@omniviewdev/ui/charts': path.resolve(__dirname, '../charts'),
    },
    dedupe: ['react', 'react-dom', '@emotion/react', '@emotion/styled'],
  },
  server: {
    host: true,
    port: 5180,
    open: true,
  },
});
