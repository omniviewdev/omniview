/**
 * Dev shared deps adapter.
 *
 * Lazily exports shared deps to window.__OMNIVIEW_SHARED__ for dev-mode plugins.
 * In production, dev plugins are never loaded so this is never called.
 *
 * This replaces the old eager `initDevSharedDeps(true)` call in App.tsx.
 * Now shared deps are only exported when a dev plugin is actually being loaded.
 *
 * This adapter satisfies `PluginServiceDeps.ensureDevSharedDeps`.
 */

let _ready: Promise<void> | null = null;

export async function ensureDevSharedDeps(): Promise<void> {
  if (!_ready) {
    _ready = (async () => {
      const { exportSharedDepsForDev } = await import('../api/devSharedExporter');
      await exportSharedDepsForDev();
    })();
  }
  return _ready;
}

/**
 * Reset for testing purposes.
 */
export function resetDevSharedDeps(): void {
  _ready = null;
}
