import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './ui'),
    },
  },
  test: {
    benchmark: {
      include: ['**/*.bench.ts'],
      outputJson: './benchmarks/results.json',
    },
  },
});
