import path from 'node:path';
import { fileURLToPath } from 'node:url';
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { vitestCaches } from '../../vitest.cache.ts';
import { FONT_URL_PLACEHOLDER, kitFonts } from './scripts/kitFonts.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const testCaches = vitestCaches(root);
const cacheDir = process.env['OMNIVIEW_VITE_CACHE_DIRECTORY'] ?? testCaches.cacheDir;

// The new tree's toolchain: Vite 8, plugin-react 6 with the React Compiler wired through @rolldown/plugin-babel (plugin-react 6
// has no Babel option), the compiler pinned in package.json, and CSS Modules through Lightning CSS. The host's Vite 7 only
// bundles the finished package, so the two do not have to agree.
export default defineConfig({
  ...(cacheDir === undefined ? {} : { cacheDir }),
  plugins: [react(), babel({ presets: [reactCompilerPreset({ target: '19' })] }), kitFonts(root)],
  // TanStack Table's store reaches React's CommonJS with-selector shim, which a bundle cannot call in a browser (`require("react")`); React 19
  // has the hook, so the specifier points at an ES module of the kit's own (src/table/useSyncExternalStoreWithSelector.ts).
  resolve: { alias: { 'use-sync-external-store/shim/with-selector': path.join(root, 'src/table/useSyncExternalStoreWithSelector.ts') } },
  css: {
    transformer: 'lightningcss',
    lightningcss: { cssModules: { pattern: '[name]_[local]_[hash]' } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      // Two scripts and one stylesheet. `index` is the plugin-facing API; `examples` is for the parts page, the tests and the
      // workshop and is never shared with plugins (see src/examples.ts).
      entry: { index: path.join(root, 'src/entry.ts'), examples: path.join(root, 'src/examples.ts') },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: 'styles',
    },
    rolldownOptions: {
      // React is the host's: a plugin and the host must render with one copy. The examples are written as a consumer writes
      // them, from "@omniviewdev/kit", and stay external so they render the same parts as the root entry. The font placeholder is
      // listed so that Vite does not warn about a URL it is meant to leave alone (scripts/kitFonts.ts).
      external: ['react', 'react-dom', 'react/jsx-runtime', 'react/compiler-runtime', '@omniviewdev/kit', new RegExp(`^${FONT_URL_PLACEHOLDER}`)],
    },
    // The host minifies; the package stays readable and diffable. No source maps ship (strategy P2 D2.2).
    minify: false,
    cssMinify: false,
    sourcemap: false,
  },
  test: {
    // The examples import the kit by its public name; under test that name is the source entry.
    alias: { '@omniviewdev/kit': path.join(root, 'src/index.ts') },
    fsModuleCachePath: testCaches.fsModuleCachePath,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tokens/**/*.test.ts', 'eslint/**/*.test.mjs', 'scripts/**/*.test.ts'],
  },
});
