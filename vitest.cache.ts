import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/**
 * Vitest stores run results under Vite's cacheDir (default `node_modules/.vite`)
 * and transformed modules in `node_modules/.vitest-cache`. In an Omniview dev
 * workspace the supervisor owns `node_modules` and refuses any change it did not
 * write, so tests keep both caches in a per-checkout temporary directory.
 * Vitest still clears its module cache when the lockfile changes.
 *
 * `cacheDir` is set only while Vitest runs, so plain `vite` dev and build keep
 * their default optimizer cache.
 */
export function vitestCaches(root: string): { cacheDir: string | undefined; fsModuleCachePath: string } {
  const checkout = createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
  const directory = path.join(os.tmpdir(), 'omniview-vitest', checkout);
  return {
    cacheDir: process.env.VITEST ? directory : undefined,
    fsModuleCachePath: path.join(directory, 'modules'),
  };
}
