/**
 * devSharedExporter.ts
 *
 * Eagerly resolves all shared dependency lazy loaders and exposes them on
 * window.__OMNIVIEW_SHARED__ so that dev-mode plugins (loaded via native ESM
 * from a Vite dev server) can access the host's singleton instances of React,
 * MUI, React Query, etc.
 *
 * This file is ONLY used in dev mode. In production, plugins use SystemJS and
 * the shared:// import map protocol -- this module is never called.
 */

import { shared } from './shared_dependencies';

declare global {
  interface Window {
    __OMNIVIEW_SHARED__: Record<string, unknown>;
    __OMNIVIEW_SHARED_READY__: boolean;
  }
}

/**
 * Resolve all shared dependency lazy loaders and place them on the window.
 *
 * Each entry in `shared` is a function `() => Promise<Module>`. We call every
 * one of them concurrently, then store the resolved module object keyed by
 * package name.
 *
 * This MUST complete before any dev-mode plugin is loaded, because the plugin's
 * shim files synchronously read from window.__OMNIVIEW_SHARED__.
 *
 * @returns A promise that resolves when all shared deps are available on window.
 */
export async function exportSharedDepsForDev(): Promise<void> {
  // Initialize the container
  window.__OMNIVIEW_SHARED__ = window.__OMNIVIEW_SHARED__ ?? {};

  const entries = Object.entries(shared);
  const startTime = performance.now();

  // Resolve all shared deps concurrently.
  // We use Promise.allSettled so one failure does not block the rest.
  const results = await Promise.allSettled(
    entries.map(async ([name, loader]) => {
      const mod = await loader();
      return [name, mod] as const;
    })
  );

  // Write resolved modules to window, log failures
  const failures: Array<{ name: string; error: string }> = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const [name] = entries[i];
    if (result.status === 'fulfilled') {
      const [, mod] = result.value;
      window.__OMNIVIEW_SHARED__[name] = mod;
    } else {
      failures.push({ name, error: String(result.reason) });
    }
  }

  window.__OMNIVIEW_SHARED_READY__ = true;

  const elapsed = (performance.now() - startTime).toFixed(1);
  console.log(
    `[omniview:shared-deps] Exported ${entries.length - failures.length}/${entries.length} shared deps to window.__OMNIVIEW_SHARED__ in ${elapsed}ms`
  );

  if (failures.length > 0) {
    for (const { name, error } of failures) {
      console.error(`[omniview:shared-deps] Failed to resolve "${name}":`, error);
    }
  }
}
