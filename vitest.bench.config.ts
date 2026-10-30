import { defineConfig } from 'vitest/config';
import path from 'path';

import { vitestCaches } from './vitest.cache';

const testCaches = vitestCaches(import.meta.dirname);

export default defineConfig({
  cacheDir: testCaches.cacheDir,
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './ui'),
    },
  },
  test: {
    fsModuleCachePath: testCaches.fsModuleCachePath,
    reporters: ['default', 'json'],
    outputFile: { json: './benchmarks/results.json' },
    benchmark: {
      include: ['**/*.bench.ts'],
    },
  },
});
