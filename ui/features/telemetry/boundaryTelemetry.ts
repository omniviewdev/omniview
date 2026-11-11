import { recordFrontendSpan } from '@omniviewdev/runtime';

export type ErrorBoundaryKind = 'root' | 'app' | 'panel' | 'plugin_surface' | 'global_error' | 'unhandled_rejection';

/**
 * Records one caught render or uncaught error as a `frontend.error.boundary`
 * span. Only the boundary kind and the plugin id are exported: never the error
 * message, stack, component stack or rejection reason.
 */
export function recordErrorBoundary(boundary: ErrorBoundaryKind, pluginId?: string): void {
  const now = Date.now();
  recordFrontendSpan('frontend.error.boundary', {
    boundary,
    ...(pluginId === undefined ? {} : { plugin_id: pluginId }),
  }, now, now, true);
}
