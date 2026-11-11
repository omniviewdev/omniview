import { recordFrontendSpan } from '@omniviewdev/runtime';
import { telemetryWindowKind } from '../windows/identity';

export type RouteCategory = 'home' | 'plugin' | 'resource' | 'settings' | 'extensions' | 'other';

/**
 * Maps a route to a closed category from its first path segment only. The path
 * itself (which may carry resource names, ids or query strings) never leaves
 * this function.
 */
export function routeCategory(path: string): RouteCategory {
  const pathname = path.split(/[?#]/, 1)[0];
  const first = pathname.split('/').find((segment) => segment.length > 0);
  switch (first) {
    case undefined:
      return 'home';
    case 'settings':
      return 'settings';
    case 'plugins':
      return 'plugin';
    case 'resource':
    case 'resources':
      return 'resource';
    case 'extensions':
      return 'extensions';
    case 'developer-tools':
      return pathname.startsWith('/developer-tools/extensions') ? 'extensions' : 'other';
    default:
      // Every remaining route tree is contributed by a plugin.
      return 'plugin';
  }
}

/** Records one completed in-window navigation as a `frontend.navigation` span. */
export function recordNavigation(category: RouteCategory, failed: boolean): void {
  const now = Date.now();
  recordFrontendSpan('frontend.navigation', {
    route_category: category,
    window_kind: telemetryWindowKind(),
    outcome: failed ? 'failure' : 'success',
    ...(failed ? { error_class: 'other' } : {}),
  }, now, now, failed);
}
