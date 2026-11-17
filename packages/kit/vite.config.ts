import path from 'node:path';
import { fileURLToPath } from 'node:url';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { vitestCaches } from '../../vitest.cache.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const testCaches = vitestCaches(root);
const cacheDir = process.env['OMNIVIEW_VITE_CACHE_DIRECTORY'] ?? testCaches.cacheDir;

// The new tree's toolchain: Vite 8, plugin-react 6 with the React Compiler wired through @rolldown/plugin-babel (plugin-react 6
// has no Babel option), the compiler pinned in package.json, and CSS Modules through Lightning CSS. The host's Vite 7 only
// bundles the finished package, so the two do not have to agree.
export default defineConfig({
  ...(cacheDir === undefined ? {} : { cacheDir }),
  plugins: [react(), babel({ presets: [reactCompilerPreset({ target: '19' })] })],
  css: {
    transformer: 'lightningcss',
    lightningcss: { cssModules: { pattern: '[name]_[local]_[hash]' } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: path.join(root, 'src/entry.ts'),
      formats: ['es'],
      fileName: 'index',
      cssFileName: 'styles',
    },
    rolldownOptions: {
      // React is the host's: a plugin and the host must render with one copy.
      external: ['react', 'react/jsx-runtime', 'react/compiler-runtime'],
    },
    // The host minifies; the package stays readable and diffable. No source maps ship (strategy P2 D2.2).
    minify: false,
    cssMinify: false,
    sourcemap: false,
  },
  test: {
    fsModuleCachePath: testCaches.fsModuleCachePath,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tokens/**/*.test.ts', 'eslint/**/*.test.mjs', 'scripts/**/*.test.ts'],
  },
});
