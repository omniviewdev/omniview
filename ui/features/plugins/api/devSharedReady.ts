/**
 * devSharedReady.ts
 *
 * Provides a promise that resolves when shared deps are exported to
 * window.__OMNIVIEW_SHARED__. In production mode, resolves immediately.
 *
 * Plugin loading code must `await devSharedReady` before importing dev-mode
 * plugins via native ESM.
 */

let _resolve: () => void;
let _ready = false;

/**
 * A promise that resolves once shared deps are available on the window.
 * In production, this resolves immediately (see initDevSharedDeps below).
 */
export const devSharedReady: Promise<void> = new Promise<void>((resolve) => {
  _resolve = resolve;
});

/**
 * Call this during app init. In dev mode, it eagerly loads shared deps onto
 * the window. In production, it resolves the gate immediately.
 *
 * @param isDev - Whether the app is running in development mode.
 */
export async function initDevSharedDeps(isDev: boolean): Promise<void> {
  if (_ready) return;
  _ready = true;

  if (isDev) {
    const { exportSharedDepsForDev } = await import('./devSharedExporter');
    await exportSharedDepsForDev();
  }

  _resolve();
}
