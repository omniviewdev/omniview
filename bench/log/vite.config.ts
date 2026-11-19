/**
 * Build of the log bench page (bench/log/README.md). Selected through the environment:
 *   OV_BENCH_DIST      output directory (default bench/log/.dist)
 *   OV_BENCH_REACT     `normal` (production React, the timing runs) or `profiling` (react-dom/profiling and a Profiler around the kit variant, the
 *                      cross-check of the commit counter: its instrumentation costs time, so it never produces a frame time)
 *   OV_BENCH_OVERSCAN  rows mounted beyond the viewport on each side in the KIT's list (default: what the built kit has, 10). The overscan is a
 *                      constant inside the kit's built package; a value other than the default is patched into the bundle of this page (one literal,
 *                      asserted to exist exactly once), so the part measured is still the artefact ui-next ships and no knob exists in the product.
 *
 * The page is compiled as the product's sources are: the React Compiler through plugin-react, target 19 (the root vite.config.ts). The kit comes
 * from its BUILT package (`@omniviewdev/kit`, dist); `pnpm --filter @omniviewdev/kit run build` first.
 */
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, normalizePath, type Plugin } from 'vite';

const here = import.meta.dirname;
const reactBuild = process.env.OV_BENCH_REACT ?? 'normal';
if (reactBuild !== 'normal' && reactBuild !== 'profiling') {
  throw new Error(`OV_BENCH_REACT must be normal or profiling, not ${reactBuild}`);
}

const overscan = process.env.OV_BENCH_OVERSCAN === undefined ? undefined : Number(process.env.OV_BENCH_OVERSCAN);
if (overscan !== undefined && (!Number.isInteger(overscan) || overscan < 0 || overscan > 200)) {
  throw new Error(`OV_BENCH_OVERSCAN must be a whole number of rows, not ${process.env.OV_BENCH_OVERSCAN}`);
}

/** The literal in the built kit's `computeWindow()`: `scrollTop: this.effectiveTop(), overscan: 10, step: 4`. Whitespace after the colons is optional: Babel, which plugin-react runs over the kit's dist, writes a file over 500 KB without it. */
const OVERSCAN_SITE = /(scrollTop:\s*this\.effectiveTop\(\),\s*overscan:\s*)(\d+)(,\s*step:\s*\d+)/g;

/** Where the built kit is, as Vite names a module (an id with `/` separators on every platform): the workspace file, or the package through node_modules. */
const KIT_DIST_FILES = ['/packages/kit/dist/index.js', '/@omniviewdev/kit/dist/index.js'];

function kitOverscan(rows: number): Plugin {
  return {
    name: 'bench-kit-overscan',
    enforce: 'pre',
    transform(code, id) {
      const file = normalizePath(id);
      if (!KIT_DIST_FILES.some((tail) => file.endsWith(tail))) {
        return null;
      }

      const matches = [...code.matchAll(OVERSCAN_SITE)];
      if (matches.length !== 1) {
        throw new Error(`the built kit must hold the overscan literal exactly once, found ${matches.length}: the bench patch is stale`);
      }

      return { code: code.replace(OVERSCAN_SITE, `$1${rows}$3`), map: null };
    },
  };
}

export default defineConfig({
  root: path.join(here, 'page'),
  base: './',
  plugins: [react({ babel: { plugins: [['babel-plugin-react-compiler', { target: '19' }]] } }), ...(overscan === undefined ? [] : [kitOverscan(overscan)])],
  resolve: {
    alias: reactBuild === 'profiling' ? [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] : [],
    dedupe: ['react', 'react-dom'],
    // The kit is read as the built file it is: no symlink resolution to the package's source tree.
    preserveSymlinks: false,
  },
  define: { 'import.meta.env.BENCH_REACT_BUILD': JSON.stringify(reactBuild) },
  build: {
    outDir: process.env.OV_BENCH_DIST ? path.resolve(process.env.OV_BENCH_DIST) : path.join(here, '.dist'),
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    cssCodeSplit: true,
  },
});
