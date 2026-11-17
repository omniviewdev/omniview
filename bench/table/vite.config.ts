/**
 * Build of the table bench page (bench/table/README.md). Selected through the environment:
 *   OV_BENCH_DIST   output directory (default bench/table/.dist)
 *   OV_BENCH_REACT  `normal` (production React, the timing runs) or `profiling` (react-dom/profiling and a Profiler around the page, the
 *                   count runs: its instrumentation costs time, so it never produces a frame time)
 *
 * The page is compiled as the product's sources are: the React Compiler through plugin-react, target 19 (the root vite.config.ts).
 * The kit comes from its BUILT package (`@omniviewdev/kit`, dist), the artefact ui-next ships; `pnpm --filter @omniviewdev/kit run build` first.
 */
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

const here = import.meta.dirname;
const reactBuild = process.env.OV_BENCH_REACT ?? 'normal';
if (reactBuild !== 'normal' && reactBuild !== 'profiling') {
  throw new Error(`OV_BENCH_REACT must be normal or profiling, not ${reactBuild}`);
}

export default defineConfig({
  root: path.join(here, 'page'),
  base: './',
  plugins: [react({ babel: { plugins: [['babel-plugin-react-compiler', { target: '19' }]] } })],
  resolve: {
    alias: reactBuild === 'profiling' ? [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] : [],
    dedupe: ['react', 'react-dom'],
  },
  define: { 'import.meta.env.BENCH_REACT_BUILD': JSON.stringify(reactBuild) },
  build: {
    outDir: process.env.OV_BENCH_DIST ? path.resolve(process.env.OV_BENCH_DIST) : path.join(here, '.dist'),
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    // One CSS file per lazily loaded variant: the page of one variant never carries another's stylesheet.
    cssCodeSplit: true,
  },
});
