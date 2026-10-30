import { vitestCaches } from './vitest.cache.ts';

const testCaches = vitestCaches(import.meta.dirname);

export default {
  cacheDir: testCaches.cacheDir,
  test: {
    fsModuleCachePath: testCaches.fsModuleCachePath,
    globals: true,
    environment: 'node',
    include: ['packages/omniviewdev-runtime/src/errors/resourceErrorTransport.test.ts'],
  },
};
