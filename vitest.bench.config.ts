import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './ui'),
    },
  },
  test: {
    reporters: ['default', 'json'],
    outputFile: { json: './benchmarks/results.json' },
    benchmark: {
      include: ['**/*.bench.ts'],
    },
  },
});
