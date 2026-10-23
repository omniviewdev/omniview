import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { omniviewExternals } from '@omniviewdev/vite-plugin';
import { injectCssIntoEntry } from './vite/omniview';

export default defineConfig({
  plugins: [react(), omniviewExternals(), injectCssIntoEntry('workspace-probe')],
  server: {
    host: '127.0.0.1',
    cors: true,
    hmr: { protocol: 'ws', host: '127.0.0.1' },
  },
  build: {
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      input: 'src/entry.ts',
      output: {
        entryFileNames: 'assets/entry.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
        format: 'system',
      },
      preserveEntrySignatures: 'exports-only',
    },
  },
});
